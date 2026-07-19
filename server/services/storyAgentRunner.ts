import { config } from '../config.js';
import type { GenerationActivity, Scenario, StoryUsageStatus } from '../../shared/types.js';
import {
  runAgent,
  type AgentModel,
  type AgentSubagentOptions,
  type AgentTool,
  type AgentTurnUpdate,
} from './agentRuntime.js';
import { createGeminiAgentModel, getMaxThinkingConfig } from './gemini.js';
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

export interface StoryAgentRunnerDependencies {
  modelFactory?: (role: 'main' | 'subagent', subagentIndex?: number) => AgentModel;
}

interface RunStoryAgentOptions<TContext> {
  systemInstruction: string;
  initialPrompt: string;
  tools: Array<AgentTool<TContext, Scenario>>;
  context: TContext;
  getSavedVersion: () => number;
  onProgress?: (update: StoryAgentProgressUpdate) => void;
  usageCallbacks?: StoryAgentUsageCallbacks;
  dependencies?: StoryAgentRunnerDependencies;
  signal?: AbortSignal;
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

/** Converts parent runtime turns into stable user-facing story progress. */
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

/** Keeps delegated-session mechanics outside the domain-specific story agent. */
function reportIndependentReviewProgress<TContext>(
  onProgress: ((update: StoryAgentProgressUpdate) => void) | undefined,
  update: Parameters<NonNullable<AgentSubagentOptions<TContext, Record<string, never>>['onTurn']>>[0],
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

/** Selects parent and delegated Gemini models while keeping accounting role-aware. */
function createModelFactory<TContext>(
  options: RunStoryAgentOptions<TContext>,
): NonNullable<StoryAgentRunnerDependencies['modelFactory']> {
  if (options.dependencies?.modelFactory) return options.dependencies.modelFactory;
  return role => createGeminiAgentModel({
    model: config.scenarioModel,
    temperature: role === 'subagent' ? config.scenarioReviewTemperature : config.scenarioTemperature,
    thinkingConfig: getMaxThinkingConfig(),
    onUsage: role === 'subagent'
      ? options.usageCallbacks?.onReviewUsage
      : usage => (
          options.getSavedVersion() > 0
            ? options.usageCallbacks?.onRewriteUsage?.(usage)
            : options.usageCallbacks?.onDraftUsage?.(usage)
        ),
  });
}

/** Runs the story task through the generic agent runtime and its optional capabilities. */
export function runStoryAgent<TContext>(options: RunStoryAgentOptions<TContext>): Promise<Scenario> {
  const modelFactory = createModelFactory(options);
  return runAgent({
    name: 'main story agent',
    systemInstruction: options.systemInstruction,
    initialPrompt: options.initialPrompt,
    maxTurns: MAIN_STORY_AGENT_MAX_TURNS,
    model: modelFactory('main'),
    tools: options.tools,
    context: options.context,
    terminalToolNames: ['submit_story_script'],
    subagents: {
      systemInstruction: GENERIC_SUBAGENT_SYSTEM_INSTRUCTION,
      maxTurns: SUBAGENT_MAX_TURNS,
      modelFactory: request => modelFactory('subagent', request.index),
      createContext: () => ({}),
      onTurn: update => reportIndependentReviewProgress(options.onProgress, update),
    },
    signal: options.signal,
    onTurn: update => reportMainAgentProgress(options.onProgress, update),
  });
}
