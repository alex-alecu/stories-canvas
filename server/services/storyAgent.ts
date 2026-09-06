import type {
  ArtStyleKey,
  GenerationActivity,
  Scenario,
} from '../../shared/types.js';
import { generateJSON } from './openrouter.js';
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
import { enforceStoryQuality } from './storyQualityGate.js';
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

export interface StoryAgentDependencies {
  runner?: StoryAgentRunnerDependencies;
  resolveSource?: typeof resolveRetellingSource;
  enforceQuality?: typeof enforceStoryQuality;
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

function validateStorySubmission(value: unknown, context: StoryPromptContext): { scenario?: Scenario; error?: string } {
  try {
    const scenario = normalizeScript(value);
    const issues = validateScenario(scenario, context.targetAge, validationOptions(context));
    return issues.length ? { error: formatScenarioValidationIssues(issues) } : { scenario };
  } catch {
    return { error: 'Submit a complete story with title, targetAge, characters, and pages.' };
  }
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

  const agentScenario = await runStoryAgent({
    systemInstruction: buildStoryAgentSystemInstruction(context),
    initialPrompt: buildDraftScenarioPrompt(context),
    validate: value => validateStorySubmission(value, context),
    onProgress,
    usageCallbacks,
    dependencies: dependencies.runner,
    signal,
  });
  signal?.throwIfAborted();
  const enforceQuality = dependencies.enforceQuality ?? enforceStoryQuality;
  onProgress?.({ status: 'reviewing_scenario', currentPhase: 'Reviewing story script...',
    message: 'Checking the story before illustration...',
    activity: activity('story-quality', 'subagent', 'working', 'Story review') });
  const scenario = await enforceQuality(context, agentScenario, {
    onReviewUsage: usageCallbacks?.onReviewUsage,
    onRewriteUsage: usageCallbacks?.onRewriteUsage,
    signal,
  });
  signal?.throwIfAborted();
  onProgress?.({ status: 'reviewing_scenario', currentPhase: 'Story review complete.',
    message: 'The story passed review.',
    activity: activity('story-quality', 'subagent', 'completed', 'Story review') });

  return {
    scenario,
    retellingMode: retellingSource ? 'faithful_retelling' : 'original',
    retellingSource,
    pageCount: context.pageCount,
  };
}
