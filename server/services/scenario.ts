import { config } from '../config.js';
import * as gemini from './gemini.js';
import {
  buildDraftScenarioPrompt,
  buildRepairScenarioPrompt,
  buildStoryPromptContext,
  buildStorySystemInstruction,
  type StoryPromptContext,
} from './storyPrompt.js';
import {
  formatScenarioValidationIssues,
  normalizeScenarioWhitespace,
  validateScenario,
} from './scenarioValidation.js';
import {
  reviewScenarioWithModel as runScenarioReviewWithModel,
  rewriteScenarioFromReviewWithModel,
  type ScenarioReviewResult,
} from './scenarioReview.js';
import type { Scenario, ArtStyleKey } from '../../shared/types.js';

const scenarioSchema = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'Story title' },
    targetAge: { type: 'INTEGER', description: 'Target age of the child' },
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
      description: 'Main characters (max 3)',
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

export interface ReviewedScenarioResult {
  scenario: Scenario;
  review: ScenarioReviewResult;
  rewritten: boolean;
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

async function generateDraftScenario(
  context: StoryPromptContext,
  systemInstruction: string,
  generateJSON: GenerateJSONFn,
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
    },
  );
}

async function generateRepairScenario(
  context: StoryPromptContext,
  systemInstruction: string,
  draftScenario: Scenario,
  repairPass: number,
  generateJSON: GenerateJSONFn,
): Promise<Scenario> {
  const issues = validateScenario(draftScenario, context.targetAge);

  return generateJSON<Scenario>(
    buildRepairScenarioPrompt(context, normalizeScenarioWhitespace(draftScenario), issues, repairPass),
    systemInstruction,
    scenarioSchema,
    {
      temperature: config.scenarioReviewTemperature,
      thinkingConfig: {
        thinkingBudget: config.scenarioReviewThinkingBudget,
      },
    },
  );
}

async function enforceHardValidation(
  context: StoryPromptContext,
  systemInstruction: string,
  candidateScenario: Scenario,
  generateJSON: GenerateJSONFn,
): Promise<Scenario> {
  let currentScenario = normalizeScenarioWhitespace(stripPageRuntimeFields(candidateScenario));
  let issues = validateScenario(currentScenario, context.targetAge);

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
    );

    currentScenario = normalizeScenarioWhitespace(stripPageRuntimeFields(currentScenario));
    issues = validateScenario(currentScenario, context.targetAge);
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
): Promise<ReviewedScenarioResult> {
  const normalizedScenario = normalizeScenarioWhitespace(stripPageRuntimeFields(candidateScenario));
  const review = await runScenarioReviewWithModel(context, normalizedScenario, generateJSON);

  if (!review.needsRewrite) {
    return {
      scenario: normalizedScenario,
      review,
      rewritten: false,
    };
  }

  const rewrittenScenario = normalizeScenarioWhitespace(stripPageRuntimeFields(
    await rewriteScenarioFromReviewWithModel(context, normalizedScenario, review, generateJSON),
  ));
  const finalIssues = validateScenario(rewrittenScenario, context.targetAge);
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

export async function generateScenarioWithModel(
  userPrompt: string,
  language: string | undefined,
  age: number | undefined,
  style: ArtStyleKey | undefined,
  generateJSON: GenerateJSONFn,
  onProgress?: ScenarioProgressCallback,
): Promise<Scenario> {
  const context = buildStoryPromptContext(userPrompt, language, age, style);
  const systemInstruction = buildStorySystemInstruction(context);

  const draftScenario = await generateDraftScenario(context, systemInstruction, generateJSON);
  const validatedScenario = await enforceHardValidation(
    context,
    systemInstruction,
    draftScenario,
    generateJSON,
  );

  onProgress?.({
    status: 'reviewing_scenario',
    currentPhase: 'Reviewing script...',
    message: 'Reviewing and refining your story...',
  });

  const reviewedScenario = await applyEditorialReview(context, validatedScenario, generateJSON);

  return finalizeScenario(reviewedScenario.scenario);
}

export async function reviewScenarioWithModel(
  userPrompt: string,
  language: string | undefined,
  age: number | undefined,
  style: ArtStyleKey | undefined,
  scenario: Scenario,
  generateJSON: GenerateJSONFn,
  onProgress?: ScenarioProgressCallback,
): Promise<ReviewedScenarioResult> {
  const context = buildStoryPromptContext(userPrompt, language, age ?? scenario.targetAge, style);
  const systemInstruction = buildStorySystemInstruction(context);
  const validatedScenario = await enforceHardValidation(
    context,
    systemInstruction,
    scenario,
    generateJSON,
  );

  onProgress?.({
    status: 'reviewing_scenario',
    currentPhase: 'Reviewing script...',
    message: 'Reviewing and refining your story...',
  });

  const reviewedScenario = await applyEditorialReview(context, validatedScenario, generateJSON);

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
): Promise<Scenario> {
  return generateScenarioWithModel(userPrompt, language, age, style, gemini.generateJSON, onProgress);
}

export async function reviewScenario(
  userPrompt: string,
  language: string | undefined,
  age: number | undefined,
  style: ArtStyleKey | undefined,
  scenario: Scenario,
  onProgress?: ScenarioProgressCallback,
): Promise<ReviewedScenarioResult> {
  return reviewScenarioWithModel(
    userPrompt,
    language,
    age,
    style,
    scenario,
    gemini.generateJSON,
    onProgress,
  );
}
