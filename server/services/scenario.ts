import { config } from '../config.js';
import * as gemini from './gemini.js';
import {
  buildDraftScenarioPrompt,
  buildRepairScenarioPrompt,
  buildStoryPromptContext,
  buildStorySystemInstruction,
  type StoryPromptContext,
} from './storyPrompt.js';
import { resolveRetellingSource, type ResolvedRetellingSource } from './storySources.js';
import {
  formatScenarioValidationIssues,
  MAX_RETELLING_SCENARIO_CHARACTERS,
  normalizeScenarioWhitespace,
  validateScenario,
  type ScenarioValidationOptions,
} from './scenarioValidation.js';
import {
  reviewScenarioWithModel as runScenarioReviewWithModel,
  rewriteScenarioFromReviewWithModel,
  type ScenarioReviewResult,
} from './scenarioReview.js';
import type { Scenario, ArtStyleKey } from '../../shared/types.js';
import type { StoryUsageStatus } from '../../shared/types.js';

const scenarioSchema = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'Story title' },
    targetAge: { type: 'INTEGER', description: 'Target age of the reader' },
    characters: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Character name' },
          role: {
            type: 'STRING',
            description: 'Character role (protagonist, sidekick, mentor, etc.)',
          },
          appearance: {
            type: 'STRING',
            description: 'Hyper-detailed physical appearance description',
          },
          clothing: {
            type: 'STRING',
            description: 'Detailed clothing and accessories description',
          },
          personality: {
            type: 'STRING',
            description: 'Character personality traits',
          },
          characterSheetPrompt: {
            type: 'STRING',
            description:
              'Prompt for generating the character reference sheet showing front and back views',
          },
        },
        required: [
          'name',
          'role',
          'appearance',
          'clothing',
          'personality',
          'characterSheetPrompt',
        ],
      },
      description:
        'Main visual characters. Keep original stories small; faithful retellings may include required canonical roles.',
    },
    pages: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          pageNumber: {
            type: 'INTEGER',
            description: 'Page number starting from 1',
          },
          text: {
            type: 'STRING',
            description: 'Story text for this page (one short paragraph)',
          },
          imagePrompt: {
            type: 'STRING',
            description: 'Detailed scene description for image generation',
          },
          characters: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Character names appearing in this scene',
          },
        },
        required: ['pageNumber', 'text', 'imagePrompt', 'characters'],
      },
      description: 'Story pages (6-20 pages)',
    },
  },
  required: ['title', 'targetAge', 'characters', 'pages'],
};

type GenerateJSONFn = typeof gemini.generateJSON;

export interface ScenarioProgressUpdate {
  status: 'generating_scenario' | 'reviewing_scenario';
  currentPhase: string;
  message: string;
}

type ScenarioProgressCallback = (update: ScenarioProgressUpdate) => void;

export interface ScenarioUsageCallbacks {
  onSourceAnalysisUsage?: (usage: {
    model: string;
    status: StoryUsageStatus;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    usageDetails: Record<string, unknown>;
  }) => void | Promise<void>;
  onDraftUsage?: (usage: {
    model: string;
    status: StoryUsageStatus;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    usageDetails: Record<string, unknown>;
  }) => void | Promise<void>;
  onValidationRepairUsage?: ScenarioUsageCallbacks['onDraftUsage'];
  onReviewUsage?: ScenarioUsageCallbacks['onDraftUsage'];
  onRewriteUsage?: ScenarioUsageCallbacks['onDraftUsage'];
}

export interface ReviewedScenarioResult {
  scenario: Scenario;
  review: ScenarioReviewResult;
  rewritten: boolean;
}

export interface GeneratedScenarioResult {
  scenario: Scenario;
  retellingMode: 'original' | 'faithful_retelling';
  retellingSource?: ResolvedRetellingSource;
}

function finalizeScenario(scenario: Scenario): Scenario {
  const normalized = normalizeScenarioWhitespace(scenario);

  return {
    ...normalized,
    pages: normalized.pages.map(page => ({
      ...page,
      status: 'pending',
    })),
  };
}

function stripPageRuntimeFields(scenario: Scenario): Scenario {
  return {
    ...scenario,
    pages: scenario.pages.map(page => ({
      pageNumber: page.pageNumber,
      text: page.text,
      imagePrompt: page.imagePrompt,
      characters: [...page.characters],
      status: 'pending',
    })),
  };
}

function getScenarioValidationOptions(context: StoryPromptContext): ScenarioValidationOptions {
  return context.retellingSource
    ? { maxCharacters: MAX_RETELLING_SCENARIO_CHARACTERS }
    : {};
}

async function generateDraftScenario(
  context: StoryPromptContext,
  systemInstruction: string,
  generateJSON: GenerateJSONFn,
  usageCallbacks?: ScenarioUsageCallbacks,
): Promise<Scenario> {
  return generateJSON<Scenario>(
    buildDraftScenarioPrompt(context),
    systemInstruction,
    scenarioSchema,
    {
      temperature: config.scenarioTemperature,
      thinkingConfig: {
        thinkingBudget: config.scenarioThinkingBudget,
      },
      onUsage: usageCallbacks?.onDraftUsage,
    },
  );
}

async function generateRepairScenario(
  context: StoryPromptContext,
  systemInstruction: string,
  draftScenario: Scenario,
  repairPass: number,
  generateJSON: GenerateJSONFn,
  usageCallbacks?: ScenarioUsageCallbacks,
): Promise<Scenario> {
  const issues = validateScenario(draftScenario, context.targetAge, getScenarioValidationOptions(context));

  return generateJSON<Scenario>(
    buildRepairScenarioPrompt(context, normalizeScenarioWhitespace(draftScenario), issues, repairPass),
    systemInstruction,
    scenarioSchema,
    {
      temperature: config.scenarioReviewTemperature,
      thinkingConfig: {
        thinkingBudget: config.scenarioReviewThinkingBudget,
      },
      onUsage: usageCallbacks?.onValidationRepairUsage,
    },
  );
}

async function enforceHardValidation(
  context: StoryPromptContext,
  systemInstruction: string,
  candidateScenario: Scenario,
  generateJSON: GenerateJSONFn,
  usageCallbacks?: ScenarioUsageCallbacks,
): Promise<Scenario> {
  let currentScenario = normalizeScenarioWhitespace(stripPageRuntimeFields(candidateScenario));
  const validationOptions = getScenarioValidationOptions(context);
  let issues = validateScenario(currentScenario, context.targetAge, validationOptions);

  if (issues.length === 0) {
    return currentScenario;
  }

  for (let repairPass = 1; repairPass <= 2; repairPass++) {
    currentScenario = await generateRepairScenario(
      context,
      systemInstruction,
      currentScenario,
      repairPass,
      generateJSON,
      usageCallbacks,
    );

    currentScenario = normalizeScenarioWhitespace(stripPageRuntimeFields(currentScenario));
    issues = validateScenario(currentScenario, context.targetAge, validationOptions);
    if (issues.length === 0) {
      return currentScenario;
    }
  }

  throw new Error(
    `Scenario failed validation after repair: ${formatScenarioValidationIssues(issues)}`,
  );
}

async function applyEditorialReview(
  context: StoryPromptContext,
  candidateScenario: Scenario,
  generateJSON: GenerateJSONFn,
  usageCallbacks?: ScenarioUsageCallbacks,
): Promise<ReviewedScenarioResult> {
  const normalizedScenario = normalizeScenarioWhitespace(stripPageRuntimeFields(candidateScenario));
  const review = await runScenarioReviewWithModel(context, normalizedScenario, generateJSON, usageCallbacks?.onReviewUsage);

  if (!review.needsRewrite) {
    return {
      scenario: normalizedScenario,
      review,
      rewritten: false,
    };
  }

  const rewrittenScenario = normalizeScenarioWhitespace(stripPageRuntimeFields(
    await rewriteScenarioFromReviewWithModel(context, normalizedScenario, review, generateJSON, usageCallbacks?.onRewriteUsage),
  ));
  const finalIssues = validateScenario(
    rewrittenScenario,
    context.targetAge,
    getScenarioValidationOptions(context),
  );
  if (finalIssues.length > 0) {
    throw new Error(
      `Scenario failed final validation after review rewrite: ${formatScenarioValidationIssues(finalIssues)}`,
    );
  }

  return {
    scenario: rewrittenScenario,
    review,
    rewritten: true,
  };
}

export async function generateScenarioWithMetadataWithModel(
  userPrompt: string,
  language: string | undefined,
  age: number | undefined,
  style: ArtStyleKey | undefined,
  generateJSON: GenerateJSONFn,
  _onProgress?: ScenarioProgressCallback,
  usageCallbacks?: ScenarioUsageCallbacks,
): Promise<GeneratedScenarioResult> {
  const baseContext = buildStoryPromptContext(userPrompt, language, age, style);
  const retellingSource = await resolveRetellingSource(baseContext, {
    generateJSON,
    onUsage: usageCallbacks?.onSourceAnalysisUsage,
  });
  const context = retellingSource
    ? buildStoryPromptContext(userPrompt, language, age, style, retellingSource)
    : baseContext;
  const systemInstruction = buildStorySystemInstruction(context);

  const draftScenario = await generateDraftScenario(context, systemInstruction, generateJSON, usageCallbacks);
  const validatedScenario = await enforceHardValidation(
    context,
    systemInstruction,
    draftScenario,
    generateJSON,
    usageCallbacks,
  );

  const reviewedScenario = await applyEditorialReview(context, validatedScenario, generateJSON, usageCallbacks);

  return {
    scenario: finalizeScenario(reviewedScenario.scenario),
    retellingMode: retellingSource ? 'faithful_retelling' : 'original',
    retellingSource,
  };
}

export async function generateScenarioWithModel(
  userPrompt: string,
  language: string | undefined,
  age: number | undefined,
  style: ArtStyleKey | undefined,
  generateJSON: GenerateJSONFn,
  onProgress?: ScenarioProgressCallback,
  usageCallbacks?: ScenarioUsageCallbacks,
): Promise<Scenario> {
  const result = await generateScenarioWithMetadataWithModel(
    userPrompt,
    language,
    age,
    style,
    generateJSON,
    onProgress,
    usageCallbacks,
  );

  return result.scenario;
}

export async function reviewScenarioWithModel(
  userPrompt: string,
  language: string | undefined,
  age: number | undefined,
  style: ArtStyleKey | undefined,
  scenario: Scenario,
  generateJSON: GenerateJSONFn,
  onProgress?: ScenarioProgressCallback,
  usageCallbacks?: ScenarioUsageCallbacks,
): Promise<ReviewedScenarioResult> {
  const context = buildStoryPromptContext(userPrompt, language, age ?? scenario.targetAge, style);
  const systemInstruction = buildStorySystemInstruction(context);
  const validatedScenario = await enforceHardValidation(
    context,
    systemInstruction,
    scenario,
    generateJSON,
    usageCallbacks,
  );

  onProgress?.({
    status: 'reviewing_scenario',
    currentPhase: 'Reviewing script...',
    message: 'Reviewing and refining your story...',
  });

  const reviewedScenario = await applyEditorialReview(context, validatedScenario, generateJSON, usageCallbacks);

  return {
    ...reviewedScenario,
    scenario: finalizeScenario(reviewedScenario.scenario),
  };
}

export async function generateScenario(
  userPrompt: string,
  language?: string,
  age?: number,
  style?: ArtStyleKey,
  onProgress?: ScenarioProgressCallback,
  usageCallbacks?: ScenarioUsageCallbacks,
): Promise<Scenario> {
  return generateScenarioWithModel(userPrompt, language, age, style, gemini.generateJSON, onProgress, usageCallbacks);
}

export async function generateScenarioWithMetadata(
  userPrompt: string,
  language?: string,
  age?: number,
  style?: ArtStyleKey,
  onProgress?: ScenarioProgressCallback,
  usageCallbacks?: ScenarioUsageCallbacks,
): Promise<GeneratedScenarioResult> {
  return generateScenarioWithMetadataWithModel(
    userPrompt,
    language,
    age,
    style,
    gemini.generateJSON,
    onProgress,
    usageCallbacks,
  );
}

export async function reviewScenario(
  userPrompt: string,
  language: string | undefined,
  age: number | undefined,
  style: ArtStyleKey | undefined,
  scenario: Scenario,
  onProgress?: ScenarioProgressCallback,
  usageCallbacks?: ScenarioUsageCallbacks,
): Promise<ReviewedScenarioResult> {
  return reviewScenarioWithModel(
    userPrompt,
    language,
    age,
    style,
    scenario,
    gemini.generateJSON,
    onProgress,
    usageCallbacks,
  );
}
