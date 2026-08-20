import type { Character, Page } from '../../shared/types.js';
import { config } from '../config.js';
import {
  generateJSONFromContents,
  type TextContent,
  type TextGenerationOptions,
} from './openai.js';

export const SCENE_IMAGE_REVIEW_ISSUE_CODES = [
  'missing_character',
  'wrong_character_identity',
  'skin_tone_mismatch',
  'hair_mismatch',
  'clothing_mismatch',
  'extra_character',
  'scene_mismatch',
  'unwanted_text_or_symbol',
  'child_safety',
] as const;

export type SceneImageReviewIssueCode = typeof SCENE_IMAGE_REVIEW_ISSUE_CODES[number];

export interface SceneImageReviewIssue {
  code: SceneImageReviewIssueCode;
  severity: 'major' | 'minor';
  characterName: string;
  summary: string;
}

export interface SceneImageReviewResult {
  pass: boolean;
  summary: string;
  retryFeedback: string;
  issues: SceneImageReviewIssue[];
}

interface RawSceneImageReviewResult {
  summary?: unknown;
  retryFeedback?: unknown;
  issues?: unknown;
}

export interface SceneImageReviewOptions {
  generate?: typeof generateJSONFromContents;
  onUsage?: TextGenerationOptions['onUsage'];
  signal?: AbortSignal;
}

const sceneImageReviewSchema = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    retryFeedback: { type: 'STRING' },
    issues: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          code: { type: 'STRING' },
          severity: { type: 'STRING' },
          characterName: { type: 'STRING' },
          summary: { type: 'STRING' },
        },
        required: ['code', 'severity', 'characterName', 'summary'],
      },
    },
  },
  required: ['summary', 'retryFeedback', 'issues'],
} as const;

const SCENE_IMAGE_REVIEW_SYSTEM_INSTRUCTION = [
  'You are the final visual quality inspector for a paid illustrated children\'s story.',
  'Image 1 is the generated page. Later images are definitive character reference sheets in the order described by the text.',
  'Compare each visible named character with its reference sheet. Check face, skin or fur tone, hair, body shape, clothing, and fixed marks.',
  'Check that every character required by the scene is visible unless the scene prompt explicitly uses a canonical transformed form, such as a flame or animal form.',
  'Check that the main action and setting agree with the page text and scene prompt.',
  'Flag unexpected readable text, number-like marks, labels, watermarks, or symbols.',
  'Flag graphic or frightening content that is not suitable for the target age.',
  'Do not flag small pose, lighting, or line-style differences.',
  'Use major severity for a changed identity, changed skin tone, changed hair color, missing main character, wrong scene, unwanted text, or unsafe content.',
  'Use only the listed issue codes. If there is any major issue, give short, exact retry feedback for the image model.',
  'Return JSON only.',
].join('\n');

const ALWAYS_MAJOR_ISSUE_CODES = new Set<SceneImageReviewIssueCode>([
  'missing_character',
  'wrong_character_identity',
  'skin_tone_mismatch',
  'hair_mismatch',
  'clothing_mismatch',
  'extra_character',
  'scene_mismatch',
  'unwanted_text_or_symbol',
  'child_safety',
]);

function normalizeIssueCode(value: unknown): SceneImageReviewIssueCode {
  return typeof value === 'string'
    && (SCENE_IMAGE_REVIEW_ISSUE_CODES as readonly string[]).includes(value)
    ? value as SceneImageReviewIssueCode
    : 'scene_mismatch';
}

function normalizeReview(raw: RawSceneImageReviewResult): SceneImageReviewResult {
  const issues = Array.isArray(raw.issues)
    ? raw.issues.flatMap(entry => {
        if (!entry || typeof entry !== 'object') return [];
        const issue = entry as Record<string, unknown>;
        const summary = typeof issue.summary === 'string' ? issue.summary.trim() : '';
        if (!summary) return [];
        const code = normalizeIssueCode(issue.code);
        return [{
          code,
          severity: ALWAYS_MAJOR_ISSUE_CODES.has(code) || issue.severity !== 'minor'
            ? 'major' as const
            : 'minor' as const,
          characterName: typeof issue.characterName === 'string' ? issue.characterName.trim() : '',
          summary,
        }];
      })
    : [];
  const pass = !issues.some(issue => issue.severity === 'major');
  return {
    pass,
    summary: typeof raw.summary === 'string' && raw.summary.trim()
      ? raw.summary.trim()
      : pass
        ? 'The page image passed visual review.'
        : 'The page image has a material visual error.',
    retryFeedback: typeof raw.retryFeedback === 'string'
      ? raw.retryFeedback.trim()
      : '',
    issues,
  };
}

function characterDescription(character: Character): Record<string, string> {
  return {
    name: character.name,
    appearance: character.appearance,
    clothing: character.clothing,
  };
}

export async function reviewSceneImage(
  page: Page,
  characters: Character[],
  includedCharacterNames: string[],
  generatedImageBase64: string,
  characterSheets: Map<string, string>,
  targetAge: number,
  options: SceneImageReviewOptions = {},
): Promise<SceneImageReviewResult> {
  const generate = options.generate ?? generateJSONFromContents;
  const includedCharacters = includedCharacterNames.flatMap(name => {
    const character = characters.find(candidate => candidate.name === name);
    return character ? [character] : [];
  });
  const referencedCharacters = includedCharacters.filter(character => characterSheets.has(character.name));
  const referenceOrder = referencedCharacters.map((character, index) => ({
    image: index + 2,
    character: characterDescription(character),
  }));
  const parts: TextContent['parts'] = [
    {
      text: JSON.stringify({
        targetAge,
        pageNumber: page.pageNumber,
        pageText: page.text,
        scenePrompt: page.imagePrompt,
        requiredVisibleCharacters: page.characters,
        requiredCharacterDescriptions: page.characters.flatMap(name => {
          const character = characters.find(candidate => candidate.name === name);
          return character ? [characterDescription(character)] : [];
        }),
        referenceOrder,
        allowedIssueCodes: SCENE_IMAGE_REVIEW_ISSUE_CODES,
      }),
    },
    {
      inlineData: {
        data: generatedImageBase64,
        mimeType: 'image/png',
        detail: 'high',
      },
    },
  ];
  for (const character of referencedCharacters) {
    const sheet = characterSheets.get(character.name)!;
    parts.push({
      inlineData: {
        data: sheet,
        mimeType: 'image/png',
        detail: 'high',
      },
    });
  }

  const raw = await generate<RawSceneImageReviewResult>(
    [{ role: 'user', parts }],
    SCENE_IMAGE_REVIEW_SYSTEM_INSTRUCTION,
    sceneImageReviewSchema as unknown as Record<string, unknown>,
    {
      model: config.reviewModel,
      reasoningEffort: 'medium',
      maxRetries: 2,
      signal: options.signal,
      onUsage: options.onUsage,
    },
  );
  return normalizeReview(raw);
}
