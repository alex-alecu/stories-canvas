import {
  STORY_PAGE_DEFAULT_MAX_COUNT,
  STORY_PAGE_MAX_COUNT,
  type Scenario,
} from '../../shared/types.js';

export interface ScenarioValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface ScenarioTextRules {
  maxChars: number;
  maxSentences: number;
}

export const REQUIRED_SCENARIO_PAGES = STORY_PAGE_DEFAULT_MAX_COUNT;
export const MIN_SCENARIO_PAGES = 1;
export const MAX_SCENARIO_PAGES = STORY_PAGE_MAX_COUNT;
export const MAX_ORIGINAL_SCENARIO_CHARACTERS = 3;
export const MAX_RETELLING_SCENARIO_CHARACTERS = 14;
export const MAX_SCENARIO_CHARACTERS = MAX_ORIGINAL_SCENARIO_CHARACTERS;
export const OVERLAY_SAFE_MAX_CHARS = 320;

export interface ScenarioValidationOptions {
  maxCharacters?: number;
  pageCount?: number;
}

function normalizeWhitespace(value: string | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

function countSentences(text: string): number {
  const normalized = normalizeWhitespace(text);
  if (!normalized) return 0;

  const segments = normalized
    .split(/[.!?。！？]+/u)
    .map(segment => segment.trim())
    .filter(Boolean);

  return segments.length > 0 ? segments.length : 1;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function containsExactName(text: string, name: string): boolean {
  return new RegExp(
    `(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}])`,
    'iu',
  ).test(text);
}

export function getScenarioTextRules(targetAge: number): ScenarioTextRules {
  if (targetAge <= 3) {
    return { maxChars: 160, maxSentences: 4 };
  }

  if (targetAge <= 5) {
    return { maxChars: 200, maxSentences: 4 };
  }

  if (targetAge <= 8) {
    return { maxChars: 280, maxSentences: 5 };
  }

  return { maxChars: 320, maxSentences: 6 };
}

export function normalizeScenarioWhitespace(scenario: Scenario): Scenario {
  const characters = Array.isArray(scenario.characters) ? scenario.characters : [];
  const pages = Array.isArray(scenario.pages) ? scenario.pages : [];

  return {
    ...scenario,
    title: normalizeWhitespace(scenario.title),
    characters: characters.map(character => ({
      ...character,
      name: normalizeWhitespace(character.name),
      role: normalizeWhitespace(character.role),
      appearance: normalizeWhitespace(character.appearance),
      clothing: normalizeWhitespace(character.clothing),
      personality: normalizeWhitespace(character.personality),
      characterSheetPrompt: normalizeWhitespace(character.characterSheetPrompt),
    })),
    pages: pages.map(page => ({
      ...page,
      text: normalizeWhitespace(page.text),
      imagePrompt: normalizeWhitespace(page.imagePrompt),
      characters: Array.isArray(page.characters)
        ? page.characters.map(characterName => normalizeWhitespace(characterName))
        : [],
    })),
  };
}

export function validateScenario(
  rawScenario: Scenario,
  expectedAge: number,
  options: ScenarioValidationOptions = {},
): ScenarioValidationIssue[] {
  const scenario = normalizeScenarioWhitespace(rawScenario);
  const issues: ScenarioValidationIssue[] = [];
  const textRules = getScenarioTextRules(expectedAge);
  const maxCharacters = options.maxCharacters ?? MAX_SCENARIO_CHARACTERS;
  const maxPageCount = options.pageCount ?? REQUIRED_SCENARIO_PAGES;
  const characters = Array.isArray(scenario.characters) ? scenario.characters : [];
  const pages = Array.isArray(scenario.pages) ? scenario.pages : [];

  if (!scenario.title) {
    issues.push({
      code: 'title.empty',
      path: 'title',
      message: 'title must not be empty',
    });
  }

  if (!Number.isInteger(scenario.targetAge) || scenario.targetAge < 1 || scenario.targetAge > 12) {
    issues.push({
      code: 'targetAge.invalid',
      path: 'targetAge',
      message: 'targetAge must be an integer between 1 and 12',
    });
  } else if (scenario.targetAge !== expectedAge) {
    issues.push({
      code: 'targetAge.mismatch',
      path: 'targetAge',
      message: `targetAge must match the requested age of ${expectedAge}`,
    });
  }

  if (characters.length === 0) {
    issues.push({
      code: 'characters.empty',
      path: 'characters',
      message: 'at least one main character is required',
    });
  }

  if (characters.length > maxCharacters) {
    issues.push({
      code: 'characters.max',
      path: 'characters',
      message: `no more than ${maxCharacters} main characters are allowed`,
    });
  }

  const characterNames = new Map<string, string>();
  for (let index = 0; index < characters.length; index++) {
    const character = characters[index];
    const pathPrefix = `characters[${index}]`;
    const normalizedName = normalizeWhitespace(character.name);

    if (!normalizedName) {
      issues.push({
        code: 'character.name.empty',
        path: `${pathPrefix}.name`,
        message: 'character name must not be empty',
      });
    } else {
      const key = normalizedName.toLocaleLowerCase();
      if (characterNames.has(key)) {
        issues.push({
          code: 'character.name.duplicate',
          path: `${pathPrefix}.name`,
          message: `character name "${normalizedName}" is duplicated`,
        });
      } else {
        characterNames.set(key, normalizedName);
      }
    }

    const requiredFields: Array<keyof typeof character> = [
      'role',
      'appearance',
      'clothing',
      'personality',
      'characterSheetPrompt',
    ];

    for (const field of requiredFields) {
      if (!normalizeWhitespace(character[field])) {
        issues.push({
          code: `character.${field}.empty`,
          path: `${pathPrefix}.${field}`,
          message: `${field} must not be empty`,
        });
      }
    }
  }

  if (pages.length < MIN_SCENARIO_PAGES) {
    issues.push({
      code: 'pages.empty',
      path: 'pages',
      message: 'at least one page is required',
    });
  } else if (pages.length > maxPageCount) {
    issues.push({
      code: 'pages.range',
      path: 'pages',
      message: `page count must be ${maxPageCount} or fewer`,
    });
  }

  const referencedCharacters = new Set<string>();

  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const expectedPageNumber = index + 1;
    const pathPrefix = `pages[${index}]`;

    if (page.pageNumber !== expectedPageNumber) {
      issues.push({
        code: 'page.number.sequence',
        path: `${pathPrefix}.pageNumber`,
        message: `pageNumber must be ${expectedPageNumber}`,
      });
    }

    if (!page.text) {
      issues.push({
        code: 'page.text.empty',
        path: `${pathPrefix}.text`,
        message: 'page text must not be empty',
      });
    } else {
      if (page.text.length > textRules.maxChars) {
        issues.push({
          code: 'page.text.ageLength',
          path: `${pathPrefix}.text`,
          message: `page text is too long for age ${expectedAge}; keep it at or below ${textRules.maxChars} characters`,
        });
      }

      if (page.text.length > OVERLAY_SAFE_MAX_CHARS) {
        issues.push({
          code: 'page.text.overlayLength',
          path: `${pathPrefix}.text`,
          message: `page text must stay within ${OVERLAY_SAFE_MAX_CHARS} characters so it fits the image overlay`,
        });
      }

      const sentenceCount = countSentences(page.text);
      if (sentenceCount > textRules.maxSentences) {
        issues.push({
          code: 'page.text.sentences',
          path: `${pathPrefix}.text`,
          message: `page text uses too many sentences for age ${expectedAge}; keep it at or below ${textRules.maxSentences} sentences`,
        });
      }
    }

    if (!page.imagePrompt) {
      issues.push({
        code: 'page.imagePrompt.empty',
        path: `${pathPrefix}.imagePrompt`,
        message: 'imagePrompt must not be empty',
      });
    }

    if (!Array.isArray(page.characters) || page.characters.length === 0) {
      issues.push({
        code: 'page.characters.empty',
        path: `${pathPrefix}.characters`,
        message: 'each page must reference at least one declared main character',
      });
      continue;
    }

    const pageCharacterSet = new Set<string>();

    for (let charIndex = 0; charIndex < page.characters.length; charIndex++) {
      const rawName = page.characters[charIndex];
      const normalizedName = normalizeWhitespace(rawName);
      const characterPath = `${pathPrefix}.characters[${charIndex}]`;

      if (!normalizedName) {
        issues.push({
          code: 'page.characters.blank',
          path: characterPath,
          message: 'page character names must not be blank',
        });
        continue;
      }

      const normalizedKey = normalizedName.toLocaleLowerCase();
      if (pageCharacterSet.has(normalizedKey)) {
        issues.push({
          code: 'page.characters.duplicate',
          path: characterPath,
          message: `page character "${normalizedName}" is duplicated`,
        });
        continue;
      }

      pageCharacterSet.add(normalizedKey);

      if (!characterNames.has(normalizedKey)) {
        issues.push({
          code: 'page.characters.unknown',
          path: characterPath,
          message: `page character "${normalizedName}" is not declared in characters`,
        });
        continue;
      }

      referencedCharacters.add(normalizedKey);
    }

    for (const [normalizedKey, characterName] of characterNames.entries()) {
      if (containsExactName(page.imagePrompt, characterName) && !pageCharacterSet.has(normalizedKey)) {
        issues.push({
          code: 'page.characters.missingVisible',
          path: `${pathPrefix}.characters`,
          message: `imagePrompt names visible character "${characterName}", so the page characters list must include it`,
        });
      }
    }
  }

  for (const [normalizedKey, characterName] of characterNames.entries()) {
    if (!referencedCharacters.has(normalizedKey)) {
      issues.push({
        code: 'character.unused',
        path: 'characters',
        message: `declared character "${characterName}" must appear in at least one page`,
      });
    }
  }

  return issues;
}

export function formatScenarioValidationIssues(issues: ScenarioValidationIssue[]): string {
  return issues.map(issue => `${issue.path}: ${issue.message}`).join('; ');
}
