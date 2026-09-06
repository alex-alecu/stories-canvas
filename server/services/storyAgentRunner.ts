import { Agent, Runner, retryPolicies, tool, type Model } from '@openai/agents';
import type { Scenario, GenerationActivity } from '../../shared/types.js';
import { createOpenRouterAgentModel } from './openrouterAgentModel.js';
import { toJSONSchema, type TextUsageEvent } from './openrouter.js';
import { storyScriptToolParameters } from './storyScriptSchema.js';

export const MAIN_STORY_AGENT_MAX_TURNS = 6;
type StoryTextUsage = Omit<TextUsageEvent, 'usageAvailable'> & { usageAvailable?: boolean };

export interface StoryAgentUsageCallbacks {
  onSourceAnalysisUsage?: (usage: StoryTextUsage) => void | Promise<void>;
  onDraftUsage?: (usage: StoryTextUsage) => void | Promise<void>;
  onReviewUsage?: (usage: StoryTextUsage) => void | Promise<void>;
  onRewriteUsage?: (usage: StoryTextUsage) => void | Promise<void>;
}

export interface StoryAgentProgressUpdate {
  status: 'generating_scenario' | 'reviewing_scenario';
  currentPhase: string;
  message: string;
  activity: GenerationActivity;
}

export interface StoryAgentRunnerDependencies { model?: Model }

interface RunStoryAgentOptions {
  systemInstruction: string;
  initialPrompt: string;
  validate: (value: unknown) => { scenario?: Scenario; error?: string };
  onProgress?: (update: StoryAgentProgressUpdate) => void;
  usageCallbacks?: StoryAgentUsageCallbacks;
  dependencies?: StoryAgentRunnerDependencies;
  signal?: AbortSignal;
}

export async function runStoryAgent(options: RunStoryAgentOptions): Promise<Scenario> {
  let submitted: Scenario | undefined;
  let turn = 0;
  const model = options.dependencies?.model ?? createOpenRouterAgentModel({
    onUsage: usage => turn > 1
      ? options.usageCallbacks?.onRewriteUsage?.(usage)
      : options.usageCallbacks?.onDraftUsage?.(usage),
    onRequest: () => {
      turn++;
      options.onProgress?.({ status: 'generating_scenario', currentPhase: 'Writing story script...',
        message: turn === 1 ? 'Writing the story...' : 'Correcting the story script...',
        activity: { id: 'main-agent', kind: 'main_agent', status: 'working', label: 'Story writer',
          turn, maxTurns: MAIN_STORY_AGENT_MAX_TURNS, turnsRemaining: MAIN_STORY_AGENT_MAX_TURNS - turn } });
    },
  });
  const submit = tool({
    name: 'submit_story_script',
    description: 'Submit the complete story. If validation fails, correct the listed errors and submit the complete story again.',
    parameters: toJSONSchema(storyScriptToolParameters) as {
      type: 'object'; properties: Record<string, Record<string, unknown>>; required: string[]; additionalProperties: false;
    },
    execute: async (args) => {
      options.signal?.throwIfAborted();
      const result = options.validate((args as { script?: unknown }).script);
      if (!result.scenario) return { ok: false, error: result.error };
      submitted = result.scenario;
      return { ok: true };
    },
    errorFunction: null,
  });
  const writer = new Agent({
    name: 'Story writer', instructions: options.systemInstruction, model, tools: [submit],
    modelSettings: { toolChoice: 'required', parallelToolCalls: false,
      retry: { maxRetries: 2, policy: retryPolicies.providerSuggested() } },
    resetToolChoice: false,
    toolUseBehavior: () => submitted
      ? { isFinalOutput: true, isInterrupted: undefined, finalOutput: 'Story validated.' }
      : { isFinalOutput: false, isInterrupted: undefined },
  });
  // Story content stays with OpenRouter and our own cost records. No OpenAI trace export.
  const runner = new Runner({ tracingDisabled: true });
  await runner.run(writer, options.initialPrompt, { maxTurns: MAIN_STORY_AGENT_MAX_TURNS, signal: options.signal });
  options.signal?.throwIfAborted();
  if (!submitted) throw new Error('The writer did not submit a valid story script.');
  options.onProgress?.({ status: 'generating_scenario', currentPhase: 'Story script complete.',
    message: 'The story is ready for review.',
    activity: { id: 'main-agent', kind: 'main_agent', status: 'completed', label: 'Story writer' } });
  return submitted;
}
