import { config } from '../config.js';
import { isDeepStrictEqual } from 'node:util';
import type {
  ArtStyleKey,
  GenerationActivity,
  Scenario,
  StoryUsageStatus,
} from '../../shared/types.js';
import {
  createSpawnSubagentTool,
  runAgent,
  type AgentModel,
  type AgentTool,
} from './agentRuntime.js';
import { createGeminiAgentModel, generateJSON, getMaxThinkingConfig } from './gemini.js';
import {
  buildDraftScenarioPrompt,
  buildStoryAgentSystemInstruction,
  buildStoryPromptContext,
  type StoryPromptContext,
} from './storyPrompt.js';
import {
  formatScenarioValidationIssues,
  MAX_RETELLING_SCENARIO_CHARACTERS,
  normalizeScenarioWhitespace,
  validateScenario,
  type ScenarioValidationOptions,
} from './scenarioValidation.js';
import { resolveRetellingSource, type ResolvedRetellingSource } from './storySources.js';
import { storyScriptToolParameters } from './storyScriptSchema.js';
import { loadMarkdownFile } from './promptFiles.js';

export const MAIN_STORY_AGENT_MAX_TURNS = 50;
export const SUBAGENT_MAX_TURNS = 10;
export const REQUIRED_REVIEW_CYCLES = 2;
export const REVIEW_SCRIPT_START_MARKER = '---BEGIN CURRENT STORY SCRIPT JSON---';
export const REVIEW_SCRIPT_END_MARKER = '---END CURRENT STORY SCRIPT JSON---';
const GENERIC_SUBAGENT_SYSTEM_INSTRUCTION = loadMarkdownFile('agent-prompts/system/subagent-system.md');

interface UsageEvent {
  model: string;
  status: StoryUsageStatus;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  usageDetails: Record<string, unknown>;
}

export interface StoryAgentUsageCallbacks {
  onSourceAnalysisUsage?: (usage: UsageEvent) => void | Promise<void>;
  onDraftUsage?: (usage: UsageEvent) => void | Promise<void>;
  onReviewUsage?: (usage: UsageEvent) => void | Promise<void>;
  onRewriteUsage?: (usage: UsageEvent) => void | Promise<void>;
}

export interface StoryAgentProgressUpdate {
  status: 'generating_scenario' | 'reviewing_scenario';
  currentPhase: string;
  message: string;
  activity: GenerationActivity;
}

export interface StoryAgentResult {
  scenario: Scenario;
  retellingMode: 'original' | 'faithful_retelling';
  retellingSource?: ResolvedRetellingSource;
  pageCount: number;
}

interface StoryAgentState {
  scenario?: Scenario;
  version: number;
  completedReviews: number;
  appliedReviews: number;
  pendingReviewCycle?: number;
}

export interface StoryAgentDependencies {
  modelFactory?: (role: 'main' | 'subagent', subagentIndex?: number) => AgentModel;
  resolveSource?: typeof resolveRetellingSource;
}

function validationOptions(context: StoryPromptContext): ScenarioValidationOptions {
  return context.retellingSource
    ? { maxCharacters: MAX_RETELLING_SCENARIO_CHARACTERS, pageCount: context.pageCount }
    : { pageCount: context.pageCount };
}

function normalizeScript(value: unknown): Scenario {
  if (!value || typeof value !== 'object') {
    throw new Error('script must be a complete story object');
  }

  const scenario = normalizeScenarioWhitespace(value as Scenario);
  return {
    ...scenario,
    pages: scenario.pages.map(page => ({
      ...page,
      status: 'pending',
    })),
  };
}

function activity(
  id: string,
  kind: GenerationActivity['kind'],
  status: GenerationActivity['status'],
  label: string,
  extras: Partial<GenerationActivity> = {},
): GenerationActivity {
  return { id, kind, status, label, ...extras };
}

function parseReviewHandoffScript(handoff: string): Scenario {
  const start = handoff.indexOf(REVIEW_SCRIPT_START_MARKER);
  const end = handoff.indexOf(REVIEW_SCRIPT_END_MARKER, start + REVIEW_SCRIPT_START_MARKER.length);
  if (start < 0 || end < 0) {
    throw new Error('The handoff must include the complete current story script and results so far.');
  }

  const json = handoff.slice(start + REVIEW_SCRIPT_START_MARKER.length, end).trim();
  try {
    return normalizeScript(JSON.parse(json));
  } catch {
    throw new Error('The handoff must include the complete current story script as valid JSON.');
  }
}

export async function generateStoryScriptWithAgents(
  userPrompt: string,
  language?: string,
  age?: number,
  style?: ArtStyleKey,
  onProgress?: (update: StoryAgentProgressUpdate) => void,
  usageCallbacks?: StoryAgentUsageCallbacks,
  dependencies: StoryAgentDependencies = {},
  signal?: AbortSignal,
): Promise<StoryAgentResult> {
  signal?.throwIfAborted();
  const baseContext = buildStoryPromptContext(userPrompt, language, age, style);
  onProgress?.({
    status: 'generating_scenario',
    currentPhase: 'Preparing story context...',
    message: 'Preparing the story brief...',
    activity: activity('script-context', 'script', 'working', 'Preparing story context'),
  });

  const resolveSource = dependencies.resolveSource ?? resolveRetellingSource;
  const retellingSource = await resolveSource(baseContext, {
    generateJSON,
    onUsage: usageCallbacks?.onSourceAnalysisUsage,
  });
  signal?.throwIfAborted();
  const context = retellingSource
    ? buildStoryPromptContext(userPrompt, language, age, style, retellingSource)
    : baseContext;
  const state: StoryAgentState = {
    version: 0,
    completedReviews: 0,
    appliedReviews: 0,
  };

  const defaultModelFactory = (role: 'main' | 'subagent'): AgentModel => createGeminiAgentModel({
    model: config.scenarioModel,
    temperature: role === 'subagent' ? config.scenarioReviewTemperature : config.scenarioTemperature,
    thinkingConfig: getMaxThinkingConfig(),
    onUsage: role === 'subagent'
      ? usageCallbacks?.onReviewUsage
      : usage => (
          state.pendingReviewCycle
            ? usageCallbacks?.onRewriteUsage?.(usage)
            : usageCallbacks?.onDraftUsage?.(usage)
        ),
  });
  const modelFactory = dependencies.modelFactory ?? defaultModelFactory;

  const spawnSubagentTool = createSpawnSubagentTool<
    StoryAgentState,
    Scenario,
    Record<string, never>
  >({
    parentName: 'main-story-agent',
    systemInstruction: GENERIC_SUBAGENT_SYSTEM_INSTRUCTION,
    maxTurns: SUBAGENT_MAX_TURNS,
    modelFactory: request => modelFactory('subagent', request.index),
    createContext: () => ({}),
    beforeSpawn: (request, toolState) => {
      if (!toolState.scenario) {
        throw new Error('Save a valid story script before spawning a sub-agent.');
      }
      if (toolState.pendingReviewCycle) {
        throw new Error(
          `Apply review ${toolState.pendingReviewCycle} and save the revised script before spawning another sub-agent.`,
        );
      }
      if (toolState.completedReviews >= REQUIRED_REVIEW_CYCLES) {
        throw new Error('Both required review sessions are already complete.');
      }
      if (!request.handoff.includes(context.userPrompt)) {
        throw new Error('The handoff must include the original user request.');
      }
      const handedOffScenario = parseReviewHandoffScript(request.handoff);
      if (!isDeepStrictEqual(handedOffScenario, toolState.scenario)) {
        throw new Error('The handoff must include the complete current story script and results so far.');
      }
      if (!request.handoff.includes(`Target age: ${context.targetAge}`)) {
        throw new Error('The handoff must include the target age.');
      }
      if (!request.handoff.includes(`Language: ${context.language}`)) {
        throw new Error('The handoff must include the story language.');
      }
    },
    afterSpawn: (_request, _result, toolState) => {
      const reviewCycle = toolState.completedReviews + 1;
      toolState.completedReviews = reviewCycle;
      toolState.pendingReviewCycle = reviewCycle;
    },
    onTurn: update => {
      onProgress?.({
        status: 'reviewing_scenario',
        currentPhase: `Reviewing story script (${update.index}/${REQUIRED_REVIEW_CYCLES})...`,
        message: `Independent review ${update.index} is checking the handed-off script...`,
        activity: activity(
          `subagent-${update.index}`,
          'subagent',
          update.phase === 'completed' ? 'completed' : 'working',
          `Sub-agent session ${update.index}`,
          {
            detail: update.phase === 'completed' ? 'Review handoff complete' : 'Reviewing the handed-off story script',
            turn: update.turn,
            maxTurns: update.maxTurns,
            turnsRemaining: update.turnsRemaining,
            reviewCycle: update.index,
          },
        ),
      });
    },
    signal,
  });

  const tools: Array<AgentTool<StoryAgentState, Scenario>> = [
    {
      name: 'save_story_script',
      description: 'Validate and save the complete current story script. Call this for the draft and after applying each review.',
      parameters: storyScriptToolParameters,
      execute: (args, toolState) => {
        const candidate = normalizeScript(args.script);
        const issues = validateScenario(candidate, context.targetAge, validationOptions(context));
        if (issues.length > 0) {
          return {
            response: {
              ok: false,
              error: `Script validation failed: ${formatScenarioValidationIssues(issues)}`,
              validationIssues: issues,
            },
          };
        }

        toolState.scenario = candidate;
        toolState.version += 1;
        if (toolState.pendingReviewCycle) {
          toolState.appliedReviews = toolState.pendingReviewCycle;
          toolState.pendingReviewCycle = undefined;
        }
        onProgress?.({
          status: 'generating_scenario',
          currentPhase: 'Writing story script...',
          message: `Story script version ${toolState.version} passed validation.`,
          activity: activity(
            `script-v${toolState.version}`,
            'script',
            'completed',
            `Script version ${toolState.version}`,
            { detail: 'Saved and validated' },
          ),
        });
        return {
          response: {
            ok: true,
            scriptVersion: toolState.version,
            completedReviews: toolState.completedReviews,
            appliedReviews: toolState.appliedReviews,
          },
        };
      },
    },
    spawnSubagentTool,
    {
      name: 'submit_story_script',
      description: 'Submit the final validated script after both independent reviews have been applied and saved.',
      parameters: { type: 'OBJECT', properties: {} },
      execute: (_args, toolState) => {
        if (!toolState.scenario) {
          return { response: { ok: false, error: 'No valid story script has been saved.' } };
        }
        if (toolState.completedReviews !== REQUIRED_REVIEW_CYCLES) {
          return {
            response: {
              ok: false,
              error: `Complete ${REQUIRED_REVIEW_CYCLES} independent review cycles before submission.`,
            },
          };
        }
        if (toolState.appliedReviews !== REQUIRED_REVIEW_CYCLES || toolState.pendingReviewCycle) {
          return { response: { ok: false, error: 'Apply and save the latest review before submission.' } };
        }

        const finalIssues = validateScenario(
          toolState.scenario,
          context.targetAge,
          validationOptions(context),
        );
        if (finalIssues.length > 0) {
          return {
            response: {
              ok: false,
              error: `Final script validation failed: ${formatScenarioValidationIssues(finalIssues)}`,
              validationIssues: finalIssues,
            },
          };
        }

        return {
          response: { ok: true, scriptVersion: toolState.version },
          terminalValue: toolState.scenario,
        };
      },
    },
  ];

  const scenario = await runAgent({
    name: 'main story agent',
    systemInstruction: buildStoryAgentSystemInstruction(context),
    initialPrompt: buildDraftScenarioPrompt(context),
    maxTurns: MAIN_STORY_AGENT_MAX_TURNS,
    model: modelFactory('main'),
    tools,
    context: state,
    terminalToolNames: ['submit_story_script'],
    signal,
    onTurn: update => {
      const isComplete = update.phase === 'completed';
      onProgress?.({
        status: 'generating_scenario',
        currentPhase: isComplete ? 'Story script complete.' : 'Main story agent working...',
        message: isComplete ? 'The final story script is ready.' : 'Writing and refining the story script...',
        activity: activity(
          'main-agent',
          'main_agent',
          isComplete ? 'completed' : 'working',
          'Main story agent',
          {
            detail: update.toolName ? `Using ${update.toolName}` : 'Working on the story',
            turn: update.turn,
            maxTurns: update.maxTurns,
            turnsRemaining: update.turnsRemaining,
          },
        ),
      });
    },
  });

  return {
    scenario,
    retellingMode: retellingSource ? 'faithful_retelling' : 'original',
    retellingSource,
    pageCount: context.pageCount,
  };
}
