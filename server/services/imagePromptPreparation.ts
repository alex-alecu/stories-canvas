import type { Character, Page } from '../../shared/types.js';
import { loadPromptMarkdown, renderPromptTemplate } from './promptFiles.js';

const ORIGINALIZED_DISNEY_PIXAR_STYLE = 'warm family-friendly stylized 3D animation, rounded character shapes, expressive faces, cinematic lighting, richly detailed environments, gentle vibrant colors';
const CHARACTER_SHEET_IMAGE_PROMPT_TEMPLATE = loadPromptMarkdown('en/images/character-sheet.md');
const SCENE_IMAGE_PROMPT_TEMPLATE = loadPromptMarkdown('en/images/scene.md');

const CHARACTER_ALIAS_WORDS = [
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
] as const;

const DISNEY_PIXAR_STYLE_PATTERNS: Array<[RegExp, string]> = [
  [
    /Disney\s*\/\s*Pixar 3D animation style with warm,\s*vibrant colors,\s*round and friendly character designs/giu,
    ORIGINALIZED_DISNEY_PIXAR_STYLE,
  ],
  [
    /Disney\s*\/\s*Pixar 3D animation style with warm,\s*round,\s*and friendly character designs/giu,
    ORIGINALIZED_DISNEY_PIXAR_STYLE,
  ],
  [
    /frame from a Pixar\s*\/\s*Disney animated movie/giu,
    'frame from a richly detailed stylized animated film',
  ],
  [
    /frame from a Disney\s*\/\s*Pixar animated movie/giu,
    'frame from a richly detailed stylized animated film',
  ],
  [
    /scene from Pixar'?s best movies/giu,
    'scene from the best stylized animated films',
  ],
  [
    /Disney\s*\/\s*Pixar/giu,
    ORIGINALIZED_DISNEY_PIXAR_STYLE,
  ],
  [
    /Pixar\s*\/\s*Disney/giu,
    ORIGINALIZED_DISNEY_PIXAR_STYLE,
  ],
  [
    /\bDisney\b/giu,
    'family-friendly animated',
  ],
  [
    /\bPixar\b/giu,
    'stylized animated',
  ],
];
const ICONIC_STORY_MOTIF_PATTERNS: Array<[RegExp, string]> = [
  [
    /\bgently sliding the (?:glass|crystal) slipper onto ([^.?!]+?)'s foot\b/giu,
    'helping $1 try on an elegant shoe',
  ],
  [
    /\bsparkling,\s*voluminous light blue ballgown\b/giu,
    'sparkling, flowing formal gown',
  ],
  [
    /\bsparkling light blue ballgown\b/giu,
    'sparkling formal gown',
  ],
  [
    /\bvoluminous light blue ballgown\b/giu,
    'flowing formal gown',
  ],
  [
    /\blight blue ballgown\b/giu,
    'formal gown',
  ],
  [
    /\bblue ballgown\b/giu,
    'formal gown',
  ],
  [
    /\bballgown\b/giu,
    'formal gown',
  ],
  [
    /\belegant glass slippers\b/giu,
    'elegant dress shoes',
  ],
  [
    /\belegant crystal slippers\b/giu,
    'elegant dress shoes',
  ],
  [
    /\bglass slippers\b/giu,
    'dress shoes',
  ],
  [
    /\bcrystal slippers\b/giu,
    'dress shoes',
  ],
  [
    /\bglass slipper\b/giu,
    'dress shoe',
  ],
  [
    /\bcrystal slipper\b/giu,
    'dress shoe',
  ],
  [
    /\bslippers of glass\b/giu,
    'dress shoes',
  ],
  [
    /\bshows midnight\b/giu,
    'shows a late hour',
  ],
  [
    /\bmidnight\b/giu,
    'a late hour of the night',
  ],
  [
    /\bpatched brown dress and white apron\b/giu,
    'simple worn dress and apron',
  ],
];
const PROMPT_NAME_STOP_WORDS = new Set([
  'Image',
  'Later',
]) as ReadonlySet<string>;
const PROMPT_NAME_PATTERNS = [
  /((?:The\s+)?\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){0,3})(?=\s+(?:and|,)\s+(?:The\s+)?\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){0,3}\s+(?:is|are|was|were|smile|smiles|smiling|look|looks|looking|run|runs|running|walk|walks|walking|spin|spins|spinning|kneel|kneels|kneeling|stand|stands|standing|hold|holds|holding|wear|wears|wearing|slide|slides|sliding|touch|touches|touching|sit|sits|sitting|laugh|laughs|laughing|cry|cries|crying|dance|dances|dancing|nearby|towards|toward|into|onto|from|on|at|in|through)\b)/gu,
  /((?:The\s+)?\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){0,3})(?=(?:'s)?\s+(?:is|are|was|were|smile|smiles|smiling|look|looks|looking|run|runs|running|walk|walks|walking|spin|spins|spinning|kneel|kneels|kneeling|stand|stands|standing|hold|holds|holding|wear|wears|wearing|slide|slides|sliding|touch|touches|touching|sit|sits|sitting|laugh|laughs|laughing|cry|cries|crying|dance|dances|dancing|nearby|towards|toward|into|onto|from|on|at|in|through)\b|'s)/gu,
  /\bhelping\s+((?:The\s+)?\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){0,3})(?=\s+(?:try|tries|trying|wear|wears|wearing|look|looks|looking|run|runs|running|walk|walks|walking)\b)/gu,
  /\bfor\s+((?:The\s+)?\p{Lu}[\p{L}'’-]+(?:\s+\p{Lu}[\p{L}'’-]+){0,3})(?=$|[,.!?:;]|\s+(?:in|with|on|at|style)\b)/gu,
] as const;

interface PromptNameMention {
  count: number;
  firstIndex: number;
  name: string;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildCharacterAlias(index: number): string {
  const word = CHARACTER_ALIAS_WORDS[index];
  return word ? `character ${word}` : `character ${index + 1}`;
}

function normalizeAliasCandidate(value: string): string {
  return value
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function originalizeStyleText(text: string): string {
  let result = text;

  for (const [pattern, replacement] of DISNEY_PIXAR_STYLE_PATTERNS) {
    result = result.replace(pattern, replacement);
  }

  for (const [pattern, replacement] of ICONIC_STORY_MOTIF_PATTERNS) {
    result = result.replace(pattern, replacement);
  }

  return result;
}

function collectPromptNameMentions(
  text: string,
  aliasMap: ReadonlyMap<string, string>,
): PromptNameMention[] {
  const mentions = new Map<string, PromptNameMention>();
  const cleanedText = originalizeStyleText(text);

  for (const pattern of PROMPT_NAME_PATTERNS) {
    for (const match of cleanedText.matchAll(pattern)) {
      const rawCandidate = match[1] ?? '';
      const candidate = normalizeAliasCandidate(rawCandidate);

      if (!candidate) continue;
      if (PROMPT_NAME_STOP_WORDS.has(candidate)) continue;
      if (/\b(?:Disney|Pixar)\b/iu.test(candidate)) continue;
      if (aliasMap.has(candidate)) continue;

      const firstIndex = match.index ?? cleanedText.indexOf(rawCandidate);
      const existing = mentions.get(candidate);
      if (existing) {
        existing.count += 1;
        existing.firstIndex = Math.min(existing.firstIndex, firstIndex);
      } else {
        mentions.set(candidate, { name: candidate, count: 1, firstIndex });
      }
    }
  }

  return [...mentions.values()]
    .sort((left, right) => right.count - left.count || left.firstIndex - right.firstIndex);
}

function buildPromptAwareAliasMap(
  text: string,
  characterNamesInPriorityOrder: string[],
  aliasMap: ReadonlyMap<string, string>,
): Map<string, string> {
  const promptAwareAliasMap = new Map(aliasMap);
  const mentions = collectPromptNameMentions(text, promptAwareAliasMap);

  if (mentions.length === 0 || characterNamesInPriorityOrder.length === 0) {
    return promptAwareAliasMap;
  }

  mentions.slice(0, characterNamesInPriorityOrder.length).forEach((mention, index) => {
    const alias = promptAwareAliasMap.get(characterNamesInPriorityOrder[index]);
    if (!alias) {
      return;
    }

    promptAwareAliasMap.set(mention.name, alias);
    if (mention.name.startsWith('The ')) {
      promptAwareAliasMap.set(normalizeAliasCandidate(mention.name.slice(4)), alias);
    } else {
      promptAwareAliasMap.set(`The ${mention.name}`, alias);
    }
  });

  return promptAwareAliasMap;
}

function replaceCharacterNames(text: string, aliasMap: ReadonlyMap<string, string>): string {
  let result = text;
  const entries = [...aliasMap.entries()].sort((left, right) => right[0].length - left[0].length);

  for (const [name, alias] of entries) {
    const pattern = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(name)})(?=$|[^\\p{L}\\p{N}])`, 'giu');
    result = result.replace(pattern, `$1${alias}`);
  }

  return result;
}

function normalizePromptWhitespace(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/ \./g, '.')
    .trim();
}

export function buildCharacterAliasMap(
  characters: ReadonlyArray<Pick<Character, 'name'>>,
): Map<string, string> {
  const aliasMap = new Map<string, string>();

  characters.forEach((character, index) => {
    if (!aliasMap.has(character.name)) {
      aliasMap.set(character.name, buildCharacterAlias(index));
    }
  });

  return aliasMap;
}

export function sanitizeImagePromptText(
  text: string,
  aliasMap: ReadonlyMap<string, string>,
): string {
  return normalizePromptWhitespace(
    replaceCharacterNames(originalizeStyleText(text), aliasMap),
  );
}

export function getOriginalizedImageStyleDescription(styleDescription?: string): string {
  return sanitizeImagePromptText(styleDescription || ORIGINALIZED_DISNEY_PIXAR_STYLE, new Map());
}

export function prepareCharacterSheetImagePrompt(
  character: Character,
  aliasMap: ReadonlyMap<string, string>,
  styleDescription?: string,
): string {
  const promptAwareAliasMap = buildPromptAwareAliasMap(
    character.characterSheetPrompt,
    [character.name],
    aliasMap,
  );
  const alias = promptAwareAliasMap.get(character.name) ?? 'the character';

  return sanitizeImagePromptText(
    renderPromptTemplate(CHARACTER_SHEET_IMAGE_PROMPT_TEMPLATE, {
      character_alias: alias,
      appearance: character.appearance,
      clothing: character.clothing,
      style_description: getOriginalizedImageStyleDescription(styleDescription),
    }),
    promptAwareAliasMap,
  );
}

export function prepareSceneImagePrompt(
  page: Page,
  characters: Character[],
  hasPreviousScene: boolean,
  includedCharacterNames: string[],
  styleDescription?: string,
): string {
  const aliasMap = buildCharacterAliasMap(characters);
  const promptAwareAliasMap = buildPromptAwareAliasMap(page.imagePrompt, page.characters, aliasMap);
  const charDescriptions = page.characters
    .map(name => {
      const character = characters.find(candidate => candidate.name === name);
      if (!character) return '';
      const alias = promptAwareAliasMap.get(name) ?? 'the character';
      return `- ${alias}: ${character.appearance}. ${character.clothing}.`;
    })
    .filter(Boolean)
    .join('\n');

  let imageIndex = 1;
  const referenceLabels: string[] = [];

  referenceLabels.push(
    ...includedCharacterNames.map((name, offset) => {
      const alias = promptAwareAliasMap.get(name) ?? 'the character';
      return `Image ${imageIndex + offset}: reference sheet for ${alias} - This reference sheet is the definitive source for this character's appearance. Every detail (skin/fur color, eye color, body proportions, clothing, accessories) must match this sheet exactly in the generated scene.`;
    }),
  );
  imageIndex += includedCharacterNames.length;

  if (hasPreviousScene) {
    referenceLabels.push(
      `Image ${imageIndex}: style and environment continuity reference - This is the previous scene. Match its art style, color palette, and lighting quality. If the location is the same, keep all objects and furniture in the exact same positions. For character appearance, always defer to the character reference sheets above.`,
    );
  }

  return sanitizeImagePromptText(
    renderPromptTemplate(SCENE_IMAGE_PROMPT_TEMPLATE, {
      reference_labels: referenceLabels.join('\n'),
      scene_prompt: page.imagePrompt,
      character_descriptions: charDescriptions,
      previous_scene_continuity: hasPreviousScene
        ? '- ENVIRONMENT SPATIAL CONTINUITY: If this scene takes place in the same location as the previous scene, all furniture, objects, and architectural elements must remain in the exact same positions. Beds, shelves, windows, doors, trees, rocks - everything must stay where it was. Only the characters\' poses and actions should change. Match the camera angle and perspective of the previous scene.\n'
        : '',
      style_description: getOriginalizedImageStyleDescription(styleDescription),
    }),
    promptAwareAliasMap,
  );
}
