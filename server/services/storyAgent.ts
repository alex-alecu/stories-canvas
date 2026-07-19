import { config } from '../config.js';
import type {
  ArtStyleKey,
  GenerationActivity,
  Scenario,
  StoryUsageStatus,
} from '../../shared/types.js';
import {
  runAgent,
  type AgentModel,
  type AgentSubagentOptions,
  type AgentTool,
  type AgentTurnUpdate,
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

/** Reports parent-agent work without mixing progress formatting into orchestration. */
function reportMainAgentProgress(
  onProgress: ((update: StoryAgentProgressUpdate) => void) | undefined,
  update: AgentTurnUpdate,
): void {
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
}

/** Maps generic delegated-session activity onto the story progress feed. */
function reportIndependentReviewProgress(
  onProgress: ((update: StoryAgentProgressUpdate) => void) | undefined,
  update: Parameters<NonNullable<AgentSubagentOptions<StoryAgentState, Record<string, never>>['onTurn']>>[0],
): void {
  onProgress?.({
    status: 'reviewing_scenario',
    currentPhase: 'Reviewing story script...',
    message: 'An independent review is checking the current script...',
    activity: activity(
      `subagent-${update.index}`,
      'subagent',
      update.phase === 'completed' ? 'completed' : 'working',
      `Independent review ${update.index}`,
      {
        detail: update.phase === 'completed' ? 'Review complete' : 'Reviewing the handed-off work',
        turn: update.turn,
        maxTurns: update.maxTurns,
        turnsRemaining: update.turnsRemaining,
        reviewCycle: update.index,
      },
    ),
  });
}

/** Creates the validated story tools; agent-session mechanics remain in the generic runtime. */
function createStoryTools(
  context: StoryPromptContext,
  onProgress?: (update: StoryAgentProgressUpdate) => void,
): Array<AgentTool<StoryAgentState, Scenario>> {
  return [
    {
      name: 'save_story_script',
      description: 'Validate and save the complete current story script after drafting or revising it.',
      parameters: storyScriptToolParameters,
      execute: (args, state) => saveStoryScript(args, state, context, onProgress),
    },
    {
      name: 'submit_story_script',
      description: 'Submit the final validated script after completing the requested independent review passes.',
      parameters: { type: 'OBJECT', properties: {} },
      execute: (_args, state) => submitStoryScript(state, context),
    },
  ];
}

/** Normalizes and validates one complete script revision before storing it in agent state. */
function saveStoryScript(
  args: Record<string, unknown>,
  state: StoryAgentState,
  context: StoryPromptContext,
  onProgress?: (update: StoryAgentProgressUpdate) => void,
) {
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

  state.scenario = candidate;
  state.version += 1;
  onProgress?.({
    status: 'generating_scenario',
    currentPhase: 'Writing story script...',
    message: `Story script version ${state.version} passed validation.`,
    activity: activity(
      `script-v${state.version}`,
      'script',
      'completed',
      `Script version ${state.version}`,
      { detail: 'Saved and validated' },
    ),
  });
  return { response: { ok: true, scriptVersion: state.version } };
}

/** Returns the saved script only after a final hard-validation pass. */
function submitStoryScript(state: StoryAgentState, context: StoryPromptContext) {
  if (!state.scenario) {
    return { response: { ok: false, error: 'No valid story script has been saved.' } };
  }

  const issues = validateScenario(state.scenario, context.targetAge, validationOptions(context));
  if (issues.length > 0) {
    return {
      response: {
        ok: false,
        error: `Final script validation failed: ${formatScenarioValidationIssues(issues)}`,
        validationIssues: issues,
      },
    };
  }

  return {
    response: { ok: true, scriptVersion: state.version },
    terminalValue: state.scenario,
  };
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
  };

  const defaultModelFactory = (role: 'main' | 'subagent'): AgentModel => createGeminiAgentModel({
    model: config.scenarioModel,
    temperature: role === 'subagent' ? config.scenarioReviewTemperature : config.scenarioTemperature,
    thinkingConfig: getMaxThinkingConfig(),
    onUsage: role === 'subagent'
      ? usageCallbacks?.onReviewUsage
      : usage => (
          state.version > 0
            ? usageCallbacks?.onRewriteUsage?.(usage)
            : usageCallbacks?.onDraftUsage?.(usage)
        ),
  });
  const modelFactory = dependencies.modelFactory ?? defaultModelFactory;
  const tools = createStoryTools(context, onProgress);

  const scenario = await runAgent({
    name: 'main story agent',
    systemInstruction: buildStoryAgentSystemInstruction(context),
    initialPrompt: buildDraftScenarioPrompt(context),
    maxTurns: MAIN_STORY_AGENT_MAX_TURNS,
    model: modelFactory('main'),
    tools,
    context: state,
    terminalToolNames: ['submit_story_script'],
    subagents: {
      systemInstruction: GENERIC_SUBAGENT_SYSTEM_INSTRUCTION,
      maxTurns: SUBAGENT_MAX_TURNS,
      modelFactory: request => modelFactory('subagent', request.index),
      createContext: () => ({}),
      onTurn: update => reportIndependentReviewProgress(onProgress, update),
    },
    signal,
    onTurn: update => reportMainAgentProgress(onProgress, update),
  });

  return {
    scenario,
    retellingMode: retellingSource ? 'faithful_retelling' : 'original',
    retellingSource,
    pageCount: context.pageCount,
  };
}
