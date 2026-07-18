import { config } from '../config.js';
import type { Scenario } from '../../shared/types.js';
import {
  buildScenarioReviewPrompt,
  buildScenarioRewritePrompt,
  buildStoryReviewSystemInstruction,
  buildStorySystemInstruction,
  type StoryPromptContext,
} from './storyPrompt.js';
import { normalizeScenarioWhitespace } from './scenarioValidation.js';
import { getMaxThinkingConfig } from './gemini.js';
import type { JSONGenerationOptions } from './gemini.js';
import type { StoryUsageStatus } from '../../shared/types.js';

export const SCENARIO_REVIEW_ISSUE_CODES = [
  'prompt_fidelity',
  'story_arc',
  'continuity',
  'character_consistency',
  'page_alignment',
  'ending_payoff',
  'language_quality',
  'antagonist_payoff',
] as const;

export type ScenarioReviewIssueCode = typeof SCENARIO_REVIEW_ISSUE_CODES[number];

export interface ScenarioReviewIssue {
  code: ScenarioReviewIssueCode;
  summary: string;
  pageNumbers: number[];
}

export interface ScenarioReviewResult {
  needsRewrite: boolean;
  summary: string;
  changedPageNumbers: number[];
  issues: ScenarioReviewIssue[];
}

type GenerateJSONFn = <T>(
  prompt: string,
  systemInstruction: string,
  schema: Record<string, unknown>,
  options?: JSONGenerationOptions,
) => Promise<T>;

type GenerateJSONFromContentsFn = <T>(
  contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>,
  systemInstruction: string,
  schema: Record<string, unknown>,
  options?: JSONGenerationOptions,
) => Promise<T>;

function userContent(text: string) {
  return { role: 'user' as const, parts: [{ text }] };
}

function modelContent(text: string) {
  return { role: 'model' as const, parts: [{ text }] };
}

function renderContentsAsPrompt(contents: Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>): string {
  return contents
    .map(content => {
      const text = content.parts.map(part => part.text).join('\n');
      return `${content.role.toUpperCase()}:\n${text}`;
    })
    .join('\n\n');
}

function resolveGenerateJSONFromContents(
  generateJSON: GenerateJSONFn,
  generateJSONFromContents?: GenerateJSONFromContentsFn,
): GenerateJSONFromContentsFn {
  return generateJSONFromContents ?? ((contents, systemInstruction, schema, options) => (
    generateJSON(renderContentsAsPrompt(contents), systemInstruction, schema, options)
  ));
}

interface RawScenarioReviewResult {
  needsRewrite?: unknown;
  summary?: unknown;
  changedPageNumbers?: unknown;
  issues?: unknown;
}

function toModelScenarioInput(scenario: Scenario) {
  return {
    title: scenario.title,
    targetAge: scenario.targetAge,
    characters: scenario.characters.map(character => ({
      name: character.name,
      role: character.role,
      appearance: character.appearance,
      clothing: character.clothing,
      personality: character.personality,
      characterSheetPrompt: character.characterSheetPrompt,
    })),
    pages: scenario.pages.map(page => ({
      pageNumber: page.pageNumber,
      text: page.text,
      imagePrompt: page.imagePrompt,
      characters: page.characters,
    })),
  };
}

function normalizePageNumbers(value: unknown, maxPageNumber: number): number[] {
  if (!Array.isArray(value)) return [];

  const unique = new Set<number>();
  for (const entry of value) {
    if (typeof entry !== 'number' || !Number.isInteger(entry)) continue;
    if (entry < 1 || entry > maxPageNumber) continue;
    unique.add(entry);
  }

  return [...unique].sort((a, b) => a - b);
}

function normalizeIssueCode(value: unknown): ScenarioReviewIssueCode {
  if (typeof value === 'string' && (SCENARIO_REVIEW_ISSUE_CODES as readonly string[]).includes(value)) {
    return value as ScenarioReviewIssueCode;
  }

  return 'story_arc';
}

export function normalizeScenarioReviewResult(
  raw: RawScenarioReviewResult,
  scenario: Scenario,
): ScenarioReviewResult {
  const maxPageNumber = scenario.pages.length;
  const issues = Array.isArray(raw.issues)
    ? raw.issues
      .map(issue => {
        if (!issue || typeof issue !== 'object') return null;
        const typedIssue = issue as Record<string, unknown>;
        const summary = typeof typedIssue.summary === 'string' ? typedIssue.summary.trim() : '';
        if (!summary) return null;

        return {
          code: normalizeIssueCode(typedIssue.code),
          summary,
          pageNumbers: normalizePageNumbers(typedIssue.pageNumbers, maxPageNumber),
        } satisfies ScenarioReviewIssue;
      })
      .filter((issue): issue is ScenarioReviewIssue => issue !== null)
    : [];

  const changedPageNumbers = normalizePageNumbers(raw.changedPageNumbers, maxPageNumber);
  const summary = typeof raw.summary === 'string' && raw.summary.trim().length > 0
    ? raw.summary.trim()
    : issues.length > 0
      ? 'Editorial review found issues that require rewriting before illustration.'
      : 'Editorial review found no material issues.';

  const needsRewrite = Boolean(raw.needsRewrite) || issues.length > 0 || changedPageNumbers.length > 0;

  return {
    needsRewrite,
    summary,
    changedPageNumbers,
    issues,
  };
}

export const scenarioReviewSchema = {
  type: 'OBJECT',
  properties: {
    needsRewrite: {
      type: 'BOOLEAN',
      description: 'Whether the scenario must be rewritten before illustration.',
    },
    summary: {
      type: 'STRING',
      description: 'One concise editorial summary.',
    },
    changedPageNumbers: {
      type: 'ARRAY',
      description: 'Page numbers that need rewritten text or prompt alignment changes.',
      items: {
        type: 'INTEGER',
      },
    },
    issues: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          code: {
            type: 'STRING',
            description: `Stable issue code. Allowed values: ${SCENARIO_REVIEW_ISSUE_CODES.join(', ')}`,
          },
          summary: {
            type: 'STRING',
            description: 'Concise description of the issue.',
          },
          pageNumbers: {
            type: 'ARRAY',
            items: {
              type: 'INTEGER',
            },
            description: 'Relevant page numbers for the issue.',
          },
        },
        required: ['code', 'summary', 'pageNumbers'],
      },
    },
  },
  required: ['needsRewrite', 'summary', 'changedPageNumbers', 'issues'],
};

export async function reviewScenarioWithModel(
  context: StoryPromptContext,
  scenario: Scenario,
  generateJSON: GenerateJSONFn,
  onUsage?: (usage: {
    model: string;
    status: StoryUsageStatus;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    usageDetails: Record<string, unknown>;
  }) => void | Promise<void>,
  generateJSONFromContents?: GenerateJSONFromContentsFn,
): Promise<ScenarioReviewResult> {
  const normalizedScenario = normalizeScenarioWhitespace(scenario);
  const prompt = buildScenarioReviewPrompt(context, toModelScenarioInput(normalizedScenario) as Scenario);
  const generateFromContents = resolveGenerateJSONFromContents(generateJSON, generateJSONFromContents);
  const rawResult = await generateFromContents<RawScenarioReviewResult>(
    [userContent(prompt)],
    buildStoryReviewSystemInstruction(context),
    scenarioReviewSchema,
    {
      temperature: config.scenarioReviewTemperature,
      thinkingConfig: getMaxThinkingConfig(),
      onUsage,
    },
  );

  return normalizeScenarioReviewResult(rawResult, normalizedScenario);
}

export async function rewriteScenarioFromReviewWithModel(
  context: StoryPromptContext,
  scenario: Scenario,
  review: ScenarioReviewResult,
  generateJSON: GenerateJSONFn,
  onUsage?: (usage: {
    model: string;
    status: StoryUsageStatus;
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    usageDetails: Record<string, unknown>;
  }) => void | Promise<void>,
  generateJSONFromContents?: GenerateJSONFromContentsFn,
): Promise<Scenario> {
  const normalizedScenario = normalizeScenarioWhitespace(scenario);
  const reviewPrompt = buildScenarioReviewPrompt(
    context,
    toModelScenarioInput(normalizedScenario) as Scenario,
  );
  const rewritePrompt = buildScenarioRewritePrompt(
    context,
    toModelScenarioInput(normalizedScenario) as Scenario,
    review.summary,
    review.issues,
  );
  const generateFromContents = resolveGenerateJSONFromContents(generateJSON, generateJSONFromContents);

  return generateFromContents<Scenario>(
    [
      userContent(reviewPrompt),
      modelContent(JSON.stringify(review, null, 2)),
      userContent(rewritePrompt),
    ],
    buildStorySystemInstruction(context),
    {
      type: 'OBJECT',
      properties: {
        title: { type: 'STRING', description: 'Story title' },
        targetAge: { type: 'INTEGER', description: 'Target age of the reader' },
        characters: {
          type: 'ARRAY',
          description:
            'Main visual characters. Keep original stories small; faithful retellings may include required canonical roles.',
          items: {
            type: 'OBJECT',
            properties: {
              name: { type: 'STRING', description: 'Character name' },
              role: { type: 'STRING', description: 'Character role' },
              appearance: { type: 'STRING', description: 'Detailed appearance description' },
              clothing: { type: 'STRING', description: 'Detailed clothing description' },
              personality: { type: 'STRING', description: 'Character personality traits' },
              characterSheetPrompt: {
                type: 'STRING',
                description: 'Prompt for generating the character reference sheet',
              },
            },
            required: ['name', 'role', 'appearance', 'clothing', 'personality', 'characterSheetPrompt'],
          },
        },
        pages: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              pageNumber: { type: 'INTEGER', description: 'Page number starting from 1' },
              text: { type: 'STRING', description: 'Story text for this page' },
              imagePrompt: { type: 'STRING', description: 'Scene description for image generation' },
              characters: {
                type: 'ARRAY',
                items: { type: 'STRING' },
                description: 'Character names appearing in this scene',
              },
            },
            required: ['pageNumber', 'text', 'imagePrompt', 'characters'],
          },
        },
      },
      required: ['title', 'targetAge', 'characters', 'pages'],
    },
    {
      temperature: config.scenarioReviewTemperature,
      thinkingConfig: getMaxThinkingConfig(),
      onUsage,
    },
  );
}
