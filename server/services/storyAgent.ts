import type {
  ArtStyleKey,
  GenerationActivity,
  Scenario,
} from '../../shared/types.js';
import {
  type AgentTool,
} from './agentRuntime.js';
import { generateJSON } from './openai.js';
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
import {
  runStoryAgent,
  type StoryAgentProgressUpdate,
  type StoryAgentRunnerDependencies,
  type StoryAgentUsageCallbacks,
} from './storyAgentRunner.js';

export type { StoryAgentProgressUpdate, StoryAgentUsageCallbacks } from './storyAgentRunner.js';

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
  runner?: StoryAgentRunnerDependencies;
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
    signal,
  });
  signal?.throwIfAborted();
  const context = retellingSource
    ? buildStoryPromptContext(userPrompt, language, age, style, retellingSource)
    : baseContext;
  const state: StoryAgentState = {
    version: 0,
  };

  const tools = createStoryTools(context, onProgress);

  const scenario = await runStoryAgent({
    systemInstruction: buildStoryAgentSystemInstruction(context),
    initialPrompt: buildDraftScenarioPrompt(context),
    tools,
    context: state,
    getSavedVersion: () => state.version,
    onProgress,
    usageCallbacks,
    dependencies: dependencies.runner,
    signal,
  });

  return {
    scenario,
    retellingMode: retellingSource ? 'faithful_retelling' : 'original',
    retellingSource,
    pageCount: context.pageCount,
  };
}
