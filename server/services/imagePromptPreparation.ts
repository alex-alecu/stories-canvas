import type { Character, Page } from '../../shared/types.js';

const ORIGINALIZED_DISNEY_PIXAR_STYLE = 'warm family-friendly stylized 3D animation, rounded character shapes, expressive faces, cinematic lighting, richly detailed environments, gentle vibrant colors';

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
    `Professional character reference sheet for ${alias}.
Layout: Front view (left), 3/4 view (center), Back view (right).
Below: Close-up face showing key facial features and expressions.
Color palette swatches at the bottom showing exact colors used for skin/fur, clothing, eyes, and accessories.

${character.appearance}. ${character.clothing}.

${getOriginalizedImageStyleDescription(styleDescription)}.
Pure white background. Clean, professional character model sheet layout.
CRITICAL: Show the EXACT same character in all views - same colors, same proportions, same clothing.
No text or labels in the image.`,
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
    `${referenceLabels.join('\n')}

IMPORTANT: Generate a new illustration. The character reference sheets are the single source of truth for how each character looks. Scene references are provided only for art style and environment continuity.

Scene: ${page.imagePrompt}

Characters in scene:
${charDescriptions}

ENVIRONMENT: This must be a complete, richly detailed scene - like a frame from a richly detailed stylized animated film. Render a full environment with depth, atmospheric lighting, and environmental storytelling details (weather, time of day, objects that tell a story). Do not render characters on a plain or overly simple background. The setting should feel alive and immersive.

BACKGROUND LIFE: Include secondary characters and living details in the background to make the world feel alive - other animals, people, creatures, or environmental activity appropriate to the setting. These background elements should add depth and atmosphere without distracting from the main characters.

COMPOSITION: Position the main characters in the upper two-thirds of the frame. The lower portion of the image will have a text overlay, so keep character faces and critical visual elements out of the bottom third. Place supporting environment details (ground, path, floor, grass) in the lower area instead.

CHARACTER APPEARANCE (HIGHEST PRIORITY):
- The character reference sheets are the absolute authority for character appearance. Always match them exactly.
- Same exact skin/fur colors, eye colors, hair style and color, body proportions, clothing details, and accessories as shown in the character sheets.
- If a scene reference shows a character looking even slightly different from the character sheet (due to accumulated generation drift), ignore the scene reference and follow the character sheet.

STYLE & ENVIRONMENT CONSISTENCY:
- Maintain the same art style across all scenes: same rendering quality, same color saturation, same lighting approach
- Use the same visual language: same line weight, same level of detail, same background style
${hasPreviousScene ? '- ENVIRONMENT SPATIAL CONTINUITY: If this scene takes place in the same location as the previous scene, all furniture, objects, and architectural elements must remain in the exact same positions. Beds, shelves, windows, doors, trees, rocks - everything must stay where it was. Only the characters\' poses and actions should change. Match the camera angle and perspective of the previous scene.\n' : ''}Style: ${getOriginalizedImageStyleDescription(styleDescription)}.
4:3 aspect ratio composition. No text or words in the image.`,
    promptAwareAliasMap,
  );
}
