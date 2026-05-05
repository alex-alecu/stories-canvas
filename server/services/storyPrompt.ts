import {
  ART_STYLES,
  DEFAULT_AGE,
  DEFAULT_ART_STYLE,
  type ArtStyleKey,
} from '../../shared/types.js';
import type { Scenario } from '../../shared/types.js';
import type { ScenarioValidationIssue } from './scenarioValidation.js';
import { loadPromptMarkdown, renderPromptTemplate } from './promptFiles.js';
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

export const STORY_GENERATOR_TEMPLATE = loadPromptMarkdown('story-generator-template.md');

const STORY_COMMON_INSTRUCTION_TEMPLATE = loadPromptMarkdown('story-common-instruction.md');
const STORY_SYSTEM_INSTRUCTION_TEMPLATE = loadPromptMarkdown('story-system-instruction.md');
const STORY_REVIEW_SYSTEM_INSTRUCTION_TEMPLATE = loadPromptMarkdown('story-review-system-instruction.md');
const DRAFT_SCENARIO_PROMPT_TEMPLATE = loadPromptMarkdown('draft-scenario.md');
const REPAIR_SCENARIO_PROMPT_TEMPLATE = loadPromptMarkdown('repair-scenario.md');
const SCENARIO_REVIEW_PROMPT_TEMPLATE = loadPromptMarkdown('scenario-review.md');
const SCENARIO_REWRITE_PROMPT_TEMPLATE = loadPromptMarkdown('scenario-rewrite.md');

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

  return renderPromptTemplate(STORY_COMMON_INSTRUCTION_TEMPLATE, {
    story_writing_rubric: STORY_WRITING_RUBRIC,
    language_label: config.label,
    language_sample_names: config.sampleNames,
    style_description: context.styleDescription,
  });
}

export function buildStorySystemInstruction(context: StoryPromptContext): string {
  return renderPromptTemplate(STORY_SYSTEM_INSTRUCTION_TEMPLATE, {
    common_instruction: buildStoryCommonInstruction(context),
  });
}

export function buildStoryReviewSystemInstruction(context: StoryPromptContext): string {
  return renderPromptTemplate(STORY_REVIEW_SYSTEM_INSTRUCTION_TEMPLATE, {
    common_instruction: buildStoryCommonInstruction(context),
  });
}

export function buildDraftScenarioPrompt(context: StoryPromptContext): string {
  return renderPromptTemplate(DRAFT_SCENARIO_PROMPT_TEMPLATE, {
    target_age: context.targetAge,
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
    style_description: context.styleDescription,
    user_prompt: context.userPrompt,
    editorial_summary: summary,
    review_issues: issueSection,
    current_scenario_json: JSON.stringify(scenario, null, 2),
  });
}
