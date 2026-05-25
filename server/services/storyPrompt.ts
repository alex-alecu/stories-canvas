import {
  ART_STYLES,
  DEFAULT_AGE,
  DEFAULT_ART_STYLE,
  estimateStoryPageLimit,
  STORY_PAGE_MAX_COUNT,
  type ArtStyleKey,
} from '../../shared/types.js';
import type { Scenario } from '../../shared/types.js';
import type { ScenarioValidationIssue } from './scenarioValidation.js';
import { loadPromptMarkdown, renderPromptTemplate } from './promptFiles.js';

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

export const STORY_GENERATOR_TEMPLATE = loadPromptMarkdown('en/operations/story-generator-template.md');

const SHARED_APPEARANCE_INSTRUCTION_TEMPLATE = loadPromptMarkdown('en/shared/appearance.md');
const SHARED_LANGUAGE_INSTRUCTION_TEMPLATE = loadPromptMarkdown('en/shared/language.md');
const SHARED_RETELLING_INSTRUCTION_TEMPLATE = loadPromptMarkdown('en/shared/retelling.md');
const STORY_SYSTEM_INSTRUCTION_TEMPLATE = loadPromptMarkdown('en/system/story-system.md');
const STORY_REVIEW_SYSTEM_INSTRUCTION_TEMPLATE = loadPromptMarkdown('en/system/story-review-system.md');
const DRAFT_SCENARIO_PROMPT_TEMPLATE = loadPromptMarkdown('en/operations/draft-scenario.md');
const REPAIR_SCENARIO_PROMPT_TEMPLATE = loadPromptMarkdown('en/operations/repair-scenario.md');
const SCENARIO_REVIEW_PROMPT_TEMPLATE = loadPromptMarkdown('en/operations/scenario-review.md');
const SCENARIO_REWRITE_PROMPT_TEMPLATE = loadPromptMarkdown('en/operations/scenario-rewrite.md');

export type ScenarioPromptAgeGroup = '3' | '4' | '5' | '6' | '7-plus';

const SCENARIO_PROMPT_TEMPLATES: Record<ScenarioPromptAgeGroup, string> = {
  '3': loadPromptMarkdown('en/scenario/age-3.md'),
  '4': loadPromptMarkdown('en/scenario/age-4.md'),
  '5': loadPromptMarkdown('en/scenario/age-5.md'),
  '6': loadPromptMarkdown('en/scenario/age-6.md'),
  '7-plus': loadPromptMarkdown('en/scenario/age-7-plus.md'),
};

export interface StoryPromptContext {
  language: SupportedStoryLanguage;
  targetAge: number;
  pageCount: number;
  style: ArtStyleKey;
  styleDescription: string;
  userPrompt: string;
  retellingSource?: RetellingSourcePromptContext;
}

export interface CanonicalBeatSheet {
  sourceAnalysisVersion?: number;
  requiredCharacters: string[];
  requiredLocations: string[];
  magicalObjects: string[];
  identityConstraints?: string[];
  eventOrder: string[];
  canonicalEnding?: string[];
  forbiddenSubstitutions: string[];
  softenableBeats: string[];
  fidelityWarnings: string[];
}

export interface RetellingSourcePromptContext {
  title: string;
  author?: string;
  provider: string;
  sourceUrl: string;
  licenseNote: string;
  canonicalBeatSheet: CanonicalBeatSheet;
}

export function resolveScenarioPageCount(
  userPrompt = '',
  retellingSource?: RetellingSourcePromptContext,
): number {
  return retellingSource ? STORY_PAGE_MAX_COUNT : estimateStoryPageLimit(userPrompt);
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
  retellingSource?: RetellingSourcePromptContext,
): StoryPromptContext {
  const resolvedStyle = style ?? DEFAULT_ART_STYLE;

  return {
    language: resolveStoryLanguage(language),
    targetAge: age ?? DEFAULT_AGE,
    pageCount: resolveScenarioPageCount(userPrompt || '', retellingSource),
    style: resolvedStyle,
    styleDescription: ART_STYLES[resolvedStyle],
    userPrompt: userPrompt.trim(),
    retellingSource,
  };
}

export function resolveScenarioPromptAgeGroup(targetAge: number): ScenarioPromptAgeGroup {
  if (targetAge <= 3) return '3';
  if (targetAge === 4) return '4';
  if (targetAge === 5) return '5';
  if (targetAge === 6) return '6';
  return '7-plus';
}

function buildScenarioInstruction(context: StoryPromptContext): string {
  return renderPromptTemplate(SCENARIO_PROMPT_TEMPLATES[resolveScenarioPromptAgeGroup(context.targetAge)], {
    target_age: context.targetAge,
    page_count: context.pageCount,
  });
}

function buildSharedAppearanceInstruction(context: StoryPromptContext): string {
  return renderPromptTemplate(SHARED_APPEARANCE_INSTRUCTION_TEMPLATE, {
    style_description: context.styleDescription,
  });
}

function buildSharedLanguageInstruction(context: StoryPromptContext): string {
  const config = LANGUAGE_PROMPT_CONFIG[context.language];

  return renderPromptTemplate(SHARED_LANGUAGE_INSTRUCTION_TEMPLATE, {
    language_label: config.label,
    language_sample_names: config.sampleNames,
  });
}

function formatBeatSheetList(label: string, values: string[]): string {
  if (values.length === 0) return `${label}: none specified`;
  return `${label}:\n${values.map(value => `- ${value}`).join('\n')}`;
}

function formatCanonicalBeatSheet(source: RetellingSourcePromptContext): string {
  const beatSheet = source.canonicalBeatSheet;
  return [
    formatBeatSheetList('Required characters/roles', beatSheet.requiredCharacters),
    formatBeatSheetList('Required locations', beatSheet.requiredLocations),
    formatBeatSheetList('Magical objects and mechanics', beatSheet.magicalObjects),
    formatBeatSheetList('Canonical identity constraints', beatSheet.identityConstraints ?? []),
    formatBeatSheetList('Required event order', beatSheet.eventOrder),
    formatBeatSheetList('Canonical ending', beatSheet.canonicalEnding ?? []),
    formatBeatSheetList('Forbidden substitutions', beatSheet.forbiddenSubstitutions),
    formatBeatSheetList('Age-safe softening allowed', beatSheet.softenableBeats),
    formatBeatSheetList('Fidelity warnings', beatSheet.fidelityWarnings),
  ].join('\n\n');
}

function buildSharedRetellingInstruction(context: StoryPromptContext): string | undefined {
  if (!context.retellingSource) return undefined;

  return renderPromptTemplate(SHARED_RETELLING_INSTRUCTION_TEMPLATE, {
    source_title: context.retellingSource.title,
    source_author: context.retellingSource.author ?? 'unknown',
    source_provider: context.retellingSource.provider,
    source_url: context.retellingSource.sourceUrl,
    source_license: context.retellingSource.licenseNote,
    page_count: context.pageCount,
    canonical_beat_sheet: formatCanonicalBeatSheet(context.retellingSource),
  });
}

function buildStoryCommonInstruction(context: StoryPromptContext): string {
  return [
    buildScenarioInstruction(context),
    buildSharedAppearanceInstruction(context),
    buildSharedLanguageInstruction(context),
    buildSharedRetellingInstruction(context),
  ].filter((section): section is string => Boolean(section)).join('\n\n');
}

export function buildStorySystemInstruction(context: StoryPromptContext): string {
  return renderPromptTemplate(STORY_SYSTEM_INSTRUCTION_TEMPLATE, {
    common_instruction: buildStoryCommonInstruction(context),
    page_count: context.pageCount,
  });
}

export function buildStoryReviewSystemInstruction(context: StoryPromptContext): string {
  return renderPromptTemplate(STORY_REVIEW_SYSTEM_INSTRUCTION_TEMPLATE, {
    common_instruction: buildStoryCommonInstruction(context),
    page_count: context.pageCount,
  });
}

export function buildDraftScenarioPrompt(context: StoryPromptContext): string {
  return renderPromptTemplate(DRAFT_SCENARIO_PROMPT_TEMPLATE, {
    target_age: context.targetAge,
    page_count: context.pageCount,
    style_description: context.styleDescription,
    user_prompt: context.userPrompt,
  });
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

  return renderPromptTemplate(REPAIR_SCENARIO_PROMPT_TEMPLATE, {
    repair_pass: repairPass,
    target_age: context.targetAge,
    page_count: context.pageCount,
    style_description: context.styleDescription,
    user_prompt: context.userPrompt,
    validation_issues: issueSection,
    draft_scenario_json: JSON.stringify(draftScenario, null, 2),
  });
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
  return renderPromptTemplate(SCENARIO_REVIEW_PROMPT_TEMPLATE, {
    target_age: context.targetAge,
    page_count: context.pageCount,
    style_description: context.styleDescription,
    user_prompt: context.userPrompt,
    scenario_json: JSON.stringify(scenario, null, 2),
  });
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

  return renderPromptTemplate(SCENARIO_REWRITE_PROMPT_TEMPLATE, {
    target_age: context.targetAge,
    page_count: context.pageCount,
    style_description: context.styleDescription,
    user_prompt: context.userPrompt,
    editorial_summary: summary,
    review_issues: issueSection,
    current_scenario_json: JSON.stringify(scenario, null, 2),
  });
}
