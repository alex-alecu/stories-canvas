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

export async function generateScenarioWithModel(
  userPrompt: string,
  language: string | undefined,
  age: number | undefined,
  style: ArtStyleKey | undefined,
  generateJSON: GenerateJSONFn,
): Promise<Scenario> {
  const context = buildStoryPromptContext(userPrompt, language, age, style);
  const systemInstruction = buildStorySystemInstruction(context);

  const draftScenario = await generateDraftScenario(context, systemInstruction, generateJSON);
  const repairedScenario = await generateRepairScenario(
    context,
    systemInstruction,
    draftScenario,
    1,
    generateJSON,
  );

  const repairIssues = validateScenario(repairedScenario, context.targetAge);
  if (repairIssues.length === 0) {
    return finalizeScenario(repairedScenario);
  }

  const secondRepairScenario = await generateJSON<Scenario>(
    buildRepairScenarioPrompt(context, normalizeScenarioWhitespace(repairedScenario), repairIssues, 2),
    systemInstruction,
    scenarioSchema,
    {
      temperature: config.scenarioReviewTemperature,
      thinkingConfig: {
        thinkingBudget: config.scenarioReviewThinkingBudget,
      },
    },
  );

  const secondRepairIssues = validateScenario(secondRepairScenario, context.targetAge);
  if (secondRepairIssues.length > 0) {
    throw new Error(
      `Scenario failed validation after repair: ${formatScenarioValidationIssues(secondRepairIssues)}`,
    );
  }

  return finalizeScenario(secondRepairScenario);
}

export async function generateScenario(
  userPrompt: string,
  language?: string,
  age?: number,
  style?: ArtStyleKey,
): Promise<Scenario> {
  return generateScenarioWithModel(userPrompt, language, age, style, gemini.generateJSON);
}
