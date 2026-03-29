import {
  ART_STYLES,
  DEFAULT_AGE,
  DEFAULT_ART_STYLE,
  type ArtStyleKey,
} from '../../shared/types.js';
import type { Scenario } from '../../shared/types.js';
import type { ScenarioValidationIssue } from './scenarioValidation.js';

export const SUPPORTED_STORY_LANGUAGES = [
  'ro',
  'de',
  'es',
  'en',
  'fr',
  'it',
  'pt',
  'nl',
  'hu',
  'pl',
  'cs',
  'sk',
  'sv',
  'no',
  'da',
  'fi',
  'ja',
  'zh',
  'ko',
] as const;

export type SupportedStoryLanguage = typeof SUPPORTED_STORY_LANGUAGES[number];

const SUPPORTED_LANGUAGE_SET = new Set<SupportedStoryLanguage>(SUPPORTED_STORY_LANGUAGES);

interface LanguagePromptConfig {
  label: string;
  sampleNames: string;
}

const LANGUAGE_PROMPT_CONFIG: Record<SupportedStoryLanguage, LanguagePromptConfig> = {
  ro: { label: 'Romanian', sampleNames: 'Mustacila, Mia' },
  de: { label: 'German', sampleNames: 'Mimi Haeschen, Baerchen Fritz' },
  es: { label: 'Spanish', sampleNames: 'Conejita Lola, Osito Nico' },
  en: { label: 'English', sampleNames: 'Bunny Pip, Little Bear Ollie' },
  fr: { label: 'French', sampleNames: 'Lapinou Lili, Petit Ours Malo' },
  it: { label: 'Italian', sampleNames: 'Coniglietta Lila, Orsetto Teo' },
  pt: { label: 'Portuguese', sampleNames: 'Coelhinho Leo, Ursinha Mimi' },
  nl: { label: 'Dutch', sampleNames: 'Konijntje Puk, Beertje Ole' },
  hu: { label: 'Hungarian', sampleNames: 'Nyuszika Mici, Macko Marci' },
  pl: { label: 'Polish', sampleNames: 'Kroliczka Lila, Misio Olek' },
  cs: { label: 'Czech', sampleNames: 'Zajicek Misa, Medvidek Kuba' },
  sk: { label: 'Slovak', sampleNames: 'Zajacik Misko, Medvedik Oliver' },
  sv: { label: 'Swedish', sampleNames: 'Kaninen Maja, Lilla Bjoern Olle' },
  no: { label: 'Norwegian', sampleNames: 'Kaninen Milla, Lille Bjoern Ola' },
  da: { label: 'Danish', sampleNames: 'Kanin Mille, Lille Bjoern Oskar' },
  fi: { label: 'Finnish', sampleNames: 'Pupu Pihla, Pikku Karhu Oiva' },
  ja: { label: 'Japanese', sampleNames: 'うさぎのミミちゃん, くまのコロくん' },
  zh: { label: 'Chinese', sampleNames: '小兔米米, 小熊奥利' },
  ko: { label: 'Korean', sampleNames: '토끼 미미, 꼬마 곰 올리' },
};

const SHARED_STORY_SYSTEM_PROMPT = `# Story Generation Core Rules

You are an elite children's story writer and illustration director. Produce emotionally warm, visually coherent stories that are easy to follow page by page.

## Narrative Goals

- Build a real story arc, not a collection of cute moments.
- Keep every page causally connected to the previous page.
- Make the emotional progression obvious through actions, choices, and consequences.
- Keep the tone gentle, wholesome, and reassuring.
- Show the lesson through the ending; do not preach it directly.

## Required Story Shape

Every story must satisfy this progression:

1. Introduce the hero in a familiar setting and establish a small wish, worry, or vulnerability children can relate to.
2. Trigger an inciting problem within the first third of the pages.
3. Give the hero at least one meaningful failed attempt, setback, or misunderstanding before the solution works.
4. Place the true climax before the final page. The hero must solve the problem through courage, kindness, honesty, teamwork, or cleverness.
5. Use the final page as the warm resolution in the "new normal" after the problem is solved.

## Page Writing Rules

- Each page must advance the story with a clear beat.
- Keep page text short enough to fit comfortably as an image overlay. Use one short paragraph per page.
- Age 3: use 2-4 short sentences, simple rhythm, onomatopoeia, and hyper-familiar situations.
- Ages 4-5: use 2-4 short sentences, keep cause and effect explicit, and use simple dialogue sparingly.
- Ages 6-8: use 3-5 concise sentences, allow richer conflict, and keep the paragraph compact enough to read quickly on a phone.
- Ages 9-12: use 3-6 concise sentences and allow more layered emotions without becoming novelistic.
- Avoid filler pages where nothing changes.

## Character Rules

- Maximum 3 main characters.
- Prefer anthropomorphic animals, vehicles with faces, or fantastical creatures because they stay more visually consistent in generated art.
- Make each main character visually distinctive and easy to track.
- Keep character names warm, simple, and natural for the target language.

## Image Prompt Rules

- Every imagePrompt and characterSheetPrompt must be written in English.
- Every page text must stay aligned with its page's imagePrompt and characters array.
- If a page text changes during revision, update that page's imagePrompt and characters list to match.
- Every imagePrompt must fully restate the visible characters and describe a complete environment, not a blank backdrop.
- Do not put text, letters, symbols, or readable words inside the image description.
- Avoid very complex physical interactions such as tight hugs or precise hand-holding; prefer simpler staging and proximity.
- Include camera framing, lighting, rich environmental detail, and lower-frame-safe composition for text overlay.
- Compose the scene so the main characters stay in the upper two-thirds of the frame and the lower portion carries supporting environment details for the text overlay.
- For ages 3-5, include gentle living background details such as birds, butterflies, pets, or other soft ambient activity.
- For ages 6-12, include richer environmental storytelling and a few brief background extras so the world feels alive without distracting from the main action.
- Maintain location layout consistency across consecutive pages set in the same place.
- The first page in a location must establish a concrete spatial layout using explicit left/right/center/background directions.
- Later pages in the same location must repeat that spatial layout faithfully, changing only character action and small foreground details.
- Keep the camera angle and perspective stable across consecutive pages in the same location unless the story truly needs a deliberate reveal.

## Output Contract

- Return valid JSON matching the provided schema exactly.
- Do not output markdown, explanations, beat sheets, thoughts, or notes.
- Think through the structure silently, then output only the final JSON.`;

export interface StoryPromptContext {
  language: SupportedStoryLanguage;
  targetAge: number;
  style: ArtStyleKey;
  styleDescription: string;
  userPrompt: string;
}

export function resolveStoryLanguage(language?: string): SupportedStoryLanguage {
  if (language && SUPPORTED_LANGUAGE_SET.has(language as SupportedStoryLanguage)) {
    return language as SupportedStoryLanguage;
  }

  return 'ro';
}

export function buildStoryPromptContext(
  userPrompt: string,
  language?: string,
  age?: number,
  style?: ArtStyleKey,
): StoryPromptContext {
  const resolvedStyle = style ?? DEFAULT_ART_STYLE;

  return {
    language: resolveStoryLanguage(language),
    targetAge: age ?? DEFAULT_AGE,
    style: resolvedStyle,
    styleDescription: ART_STYLES[resolvedStyle],
    userPrompt: userPrompt.trim(),
  };
}

export function buildStorySystemInstruction(context: StoryPromptContext): string {
  const config = LANGUAGE_PROMPT_CONFIG[context.language];

  return `${SHARED_STORY_SYSTEM_PROMPT}

## Target Language Rules

- Write every field in ${config.label} unless it is explicitly listed below as English-only.
- Keep only these fields in English: appearance, clothing, characterSheetPrompt, imagePrompt.
- Use warm, natural ${config.label} names. Example style: ${config.sampleNames}.

## Illustration Style Rules

- The selected illustration style for this story is: "${context.styleDescription}".
- Every imagePrompt and characterSheetPrompt must include that exact style wording so repaired scenarios do not drift to a different look.`;
}

export function buildDraftScenarioPrompt(context: StoryPromptContext): string {
  return [
    'Mode: Draft the first complete scenario.',
    `Target age: ${context.targetAge}`,
    `Art style for illustrations: ${context.styleDescription}`,
    'Before answering, silently plan the beat sheet page by page so the arc lands cleanly.',
    'Make the inciting problem happen early, include at least one failed attempt, and reserve the last page for the emotional resolution.',
    'Output only the final JSON.',
    '',
    'User story request:',
    context.userPrompt,
  ].join('\n');
}

export function buildRepairScenarioPrompt(
  context: StoryPromptContext,
  draftScenario: Scenario,
  issues: ScenarioValidationIssue[],
  repairPass: number,
): string {
  const issueSection = issues.length > 0
    ? issues.map(issue => `- ${issue.path}: ${issue.message}`).join('\n')
    : '- No hard validation issues were found. Strengthen pacing, causality, and emotional payoff without making pages longer.';

  return [
    `Mode: Repair pass ${repairPass}. Rewrite the full scenario JSON so it is publication-ready.`,
    `Target age: ${context.targetAge}`,
    `Art style for illustrations: ${context.styleDescription}`,
    'Preserve the core idea from the user request while improving structure and clarity.',
    'If you rewrite any page text, you must also update that page\'s imagePrompt and characters array so they stay aligned.',
    'Do not explain the fixes. Output only the corrected full JSON object.',
    '',
    'Original user story request:',
    context.userPrompt,
    '',
    'Validation issues to fix:',
    issueSection,
    '',
    'Draft scenario JSON:',
    JSON.stringify(draftScenario, null, 2),
  ].join('\n');
}
