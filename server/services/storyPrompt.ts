import {
  ART_STYLES,
  DEFAULT_AGE,
  DEFAULT_ART_STYLE,
  type ArtStyleKey,
} from '../../shared/types.js';
import type { Scenario } from '../../shared/types.js';
import type { ScenarioValidationIssue } from './scenarioValidation.js';
import { STORY_WRITING_RUBRIC } from './storyRubric.js';

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

export const STORY_GENERATOR_TEMPLATE = [
  'Write an original {{language}} story for children age {{age}}.',
  'Center it on one clear problem, quest, or test.',
  'Use a small, lovable protagonist with a child-readable motivation.',
  'Keep the cast small, the plot linear, and the scenes easy to picture.',
  'Open on a memorable image, use repetition or a rule-of-three pattern, and make the emotional arc easy to follow.',
  'Let the hero solve the problem actively through kindness, courage, honesty, teamwork, or cleverness.',
  'Keep danger gentle and non-graphic, preserve wonder with one or two magical elements, and end with comfort, fairness, or belonging.',
  'Use concrete language, visible action, and a read-aloud rhythm children will want to hear again.',
  '',
  'Story premise:',
  '{{user_prompt}}',
  '',
  'Output contract:',
  '{{output_contract}}',
].join('\n');

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

function buildStoryCommonInstruction(context: StoryPromptContext): string {
  const config = LANGUAGE_PROMPT_CONFIG[context.language];

  return `${STORY_WRITING_RUBRIC}

## Target Language Rules

- Write every field in ${config.label} unless it is explicitly listed below as English-only.
- Keep only these fields in English: appearance, clothing, characterSheetPrompt, imagePrompt.
- Inside appearance, clothing, characterSheetPrompt, and imagePrompt, keep the exact spelling from characters[].name whenever you mention a character. Do not translate, anglicize, or swap those names for franchise or canonical variants.
- Use warm, natural ${config.label} names. Example style: ${config.sampleNames}.

## Illustration Style Rules

- The selected illustration style for this story is: "${context.styleDescription}".
- Every imagePrompt and characterSheetPrompt must include that exact style wording so repaired scenarios do not drift to a different look.`;
}

export function buildStorySystemInstruction(context: StoryPromptContext): string {
  return `${buildStoryCommonInstruction(context)}

## Output Contract

- Return valid JSON matching the provided schema exactly.
- Do not output markdown, explanations, beat sheets, thoughts, or notes.
- Think through the structure silently, then output only the final JSON.`;
}

export function buildStoryReviewSystemInstruction(context: StoryPromptContext): string {
  return `${buildStoryCommonInstruction(context)}

## Review Contract

- You are reviewing a structured story scenario before illustration generation.
- Evaluate prompt fidelity, story arc, continuity, and page alignment with editorial rigor.
- Output only JSON matching the provided schema exactly.
- Do not output markdown, explanations, or notes outside the JSON.`;
}

export function buildDraftScenarioPrompt(context: StoryPromptContext): string {
  return [
    'Mode: Draft the first complete scenario.',
    `Target age: ${context.targetAge}`,
    `Art style for illustrations: ${context.styleDescription}`,
    'Write an original story unless the user explicitly asks for a retelling.',
    'Prioritize one clear goal, a small cast, visible action, gentle tension, and a comforting ending.',
    'Open on a memorable image, use repetition or a rule-of-three pattern, and let the hero solve the problem actively.',
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
    'Keep the cast small, the problem clear, the tension gentle, and the ending emotionally complete.',
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

export interface ScenarioReviewPromptIssue {
  code: string;
  summary: string;
  pageNumbers?: number[];
}

export function buildScenarioReviewPrompt(
  context: StoryPromptContext,
  scenario: Scenario,
): string {
  return [
    'Mode: Review this scenario before illustration generation.',
    `Target age: ${context.targetAge}`,
    `Art style for illustrations: ${context.styleDescription}`,
    'Judge the scenario against the user prompt and the full story-writing rubric.',
    'Only ask for a rewrite when the scenario materially misses prompt fidelity, story arc, continuity, emotional payoff, or page alignment.',
    'Flag moral muddle, passive protagonists, cruelty spikes, or cluttered subplots when they materially weaken the story.',
    'Changed page numbers should include only the pages that would need rewritten text or imagePrompt updates.',
    '',
    'Original user story request:',
    context.userPrompt,
    '',
    'Scenario JSON to review:',
    JSON.stringify(scenario, null, 2),
  ].join('\n');
}

export function buildScenarioRewritePrompt(
  context: StoryPromptContext,
  scenario: Scenario,
  summary: string,
  issues: ScenarioReviewPromptIssue[],
): string {
  const issueSection = issues.length > 0
    ? issues.map(issue => {
        const pages = issue.pageNumbers && issue.pageNumbers.length > 0
          ? ` (pages: ${issue.pageNumbers.join(', ')})`
          : '';
        return `- ${issue.code}${pages}: ${issue.summary}`;
      }).join('\n')
    : '- No specific issues were listed. Tighten the scenario conservatively while preserving the prompt.';

  return [
    'Mode: Rewrite the full scenario JSON after editorial review.',
    `Target age: ${context.targetAge}`,
    `Art style for illustrations: ${context.styleDescription}`,
    'Preserve the prompt\'s core idea and keep revisions conservative.',
    'Preserve page count, page numbers, and the main character set unless a change is truly required to fix prompt fidelity or validation.',
    'Keep scenes vivid, the conflict child-readable, the danger gentle, and the ending comforting.',
    'If you rewrite any page text, you must also update that page\'s imagePrompt and characters array so they stay aligned.',
    'Return the full corrected scenario JSON only.',
    '',
    'Original user story request:',
    context.userPrompt,
    '',
    'Editorial summary:',
    summary,
    '',
    'Issues to fix:',
    issueSection,
    '',
    'Current scenario JSON:',
    JSON.stringify(scenario, null, 2),
  ].join('\n');
}
