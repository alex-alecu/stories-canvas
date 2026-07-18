import { config } from '../config.js';
import type {
  ArtStyleKey,
  GenerationActivity,
  Scenario,
  StoryUsageStatus,
} from '../../shared/types.js';
import { runAgent, type AgentModel, type AgentTool } from './agentRuntime.js';
import { createGeminiAgentModel, generateJSON, getMaxThinkingConfig } from './gemini.js';
import {
  buildDraftScenarioPrompt,
  buildStoryAgentSystemInstruction,
  buildStoryPromptContext,
  buildStoryReviewAgentSystemInstruction,
  type StoryPromptContext,
} from './storyPrompt.js';
import {
  formatScenarioValidationIssues,
  MAX_RETELLING_SCENARIO_CHARACTERS,
  normalizeScenarioWhitespace,
  validateScenario,
  type ScenarioValidationOptions,
} from './scenarioValidation.js';
import {
  normalizeScenarioReviewResult,
  scenarioReviewSchema,
  type ScenarioReviewResult,
} from './scenarioReview.js';
import { resolveRetellingSource, type ResolvedRetellingSource } from './storySources.js';
import { storyScriptToolParameters } from './storyScriptSchema.js';

export const MAIN_STORY_AGENT_MAX_TURNS = 50;
export const REVIEW_SUBAGENT_MAX_TURNS = 10;
export const REQUIRED_REVIEW_CYCLES = 2;

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
  modelFactory?: (role: 'main' | 'review', reviewCycle?: number) => AgentModel;
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

function reviewPrompt(
  context: StoryPromptContext,
  scenario: Scenario,
  reviewCycle: number,
  focus: string,
): string {
  return [
    `Review cycle: ${reviewCycle} of ${REQUIRED_REVIEW_CYCLES}`,
    `Requested focus: ${focus || 'Full independent editorial review'}`,
    `Original user request: ${context.userPrompt}`,
    `Target age: ${context.targetAge}`,
    `Language: ${context.language}`,
    '',
    'Story script to review:',
    JSON.stringify(scenario, null, 2),
  ].join('\n');
}

async function runReviewSubagent(
  context: StoryPromptContext,
  scenario: Scenario,
  reviewCycle: number,
  focus: string,
  model: AgentModel,
  onProgress?: (update: StoryAgentProgressUpdate) => void,
): Promise<ScenarioReviewResult> {
  const exitTool: AgentTool<Record<string, never>, ScenarioReviewResult> = {
    name: 'subagent_exit',
    description: 'Close this review-only sub-agent and return its structured editorial findings.',
    parameters: scenarioReviewSchema,
    execute: args => ({
      response: { ok: true, reviewCycle },
      terminalValue: normalizeScenarioReviewResult(args, scenario),
    }),
  };

  return runAgent({
    name: `review sub-agent ${reviewCycle}`,
    systemInstruction: buildStoryReviewAgentSystemInstruction(context),
    initialPrompt: reviewPrompt(context, scenario, reviewCycle, focus),
    maxTurns: REVIEW_SUBAGENT_MAX_TURNS,
    model,
    tools: [exitTool],
    context: {},
    terminalToolNames: ['subagent_exit'],
    onTurn: update => {
      onProgress?.({
        status: 'reviewing_scenario',
        currentPhase: `Reviewing story script (${reviewCycle}/${REQUIRED_REVIEW_CYCLES})...`,
        message: `Independent review ${reviewCycle} is checking the script...`,
        activity: activity(
          `review-${reviewCycle}`,
          'subagent_review',
          update.phase === 'completed' ? 'completed' : 'working',
          `Review agent ${reviewCycle}`,
          {
            detail: update.phase === 'completed' ? 'Review complete' : 'Reviewing the story script',
            turn: update.turn,
            maxTurns: update.maxTurns,
            turnsRemaining: update.turnsRemaining,
            reviewCycle,
          },
        ),
      });
    },
  });
}

export async function generateStoryScriptWithAgents(
  userPrompt: string,
  language?: string,
  age?: number,
  style?: ArtStyleKey,
  onProgress?: (update: StoryAgentProgressUpdate) => void,
  usageCallbacks?: StoryAgentUsageCallbacks,
  dependencies: StoryAgentDependencies = {},
): Promise<StoryAgentResult> {
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
  const context = retellingSource
    ? buildStoryPromptContext(userPrompt, language, age, style, retellingSource)
    : baseContext;
  const state: StoryAgentState = {
    version: 0,
    completedReviews: 0,
    appliedReviews: 0,
  };

  const defaultModelFactory = (role: 'main' | 'review'): AgentModel => createGeminiAgentModel({
    model: config.scenarioModel,
    temperature: role === 'review' ? config.scenarioReviewTemperature : config.scenarioTemperature,
    thinkingConfig: getMaxThinkingConfig(),
    onUsage: role === 'review'
      ? usageCallbacks?.onReviewUsage
      : usage => (
          state.pendingReviewCycle
            ? usageCallbacks?.onRewriteUsage?.(usage)
            : usageCallbacks?.onDraftUsage?.(usage)
        ),
  });
  const modelFactory = dependencies.modelFactory ?? defaultModelFactory;

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
    {
      name: 'spawn_subagent',
      description: 'Spawn a fresh review-only sub-agent for the currently saved script. The main agent must apply the returned review itself.',
      parameters: {
        type: 'OBJECT',
        properties: {
          focus: {
            type: 'STRING',
            description: 'Short review focus. Use a full editorial review unless a narrower second-pass emphasis is useful.',
          },
        },
        required: ['focus'],
      },
      execute: async (args, toolState) => {
        if (!toolState.scenario) {
          return { response: { ok: false, error: 'Save a valid story script before spawning a reviewer.' } };
        }
        if (toolState.pendingReviewCycle) {
          return {
            response: {
              ok: false,
              error: `Apply review ${toolState.pendingReviewCycle} and save the revised script before spawning another reviewer.`,
            },
          };
        }
        if (toolState.completedReviews >= REQUIRED_REVIEW_CYCLES) {
          return { response: { ok: false, error: 'Both required review cycles are already complete.' } };
        }

        const reviewCycle = toolState.completedReviews + 1;
        const review = await runReviewSubagent(
          context,
          toolState.scenario,
          reviewCycle,
          typeof args.focus === 'string' ? args.focus : '',
          modelFactory('review', reviewCycle),
          onProgress,
        );
        toolState.completedReviews = reviewCycle;
        toolState.pendingReviewCycle = reviewCycle;
        return {
          response: {
            ok: true,
            reviewCycle,
            review,
            instruction: 'Apply this review yourself and call save_story_script before continuing.',
          },
        };
      },
    },
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
