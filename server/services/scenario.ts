import fs from 'fs/promises';
import path from 'path';
import { generateJSON } from './gemini.js';
import type { Scenario } from '../../shared/types.js';

const STORY_PROMPTS_DIR = path.join(process.cwd(), 'story-prompts');
const FALLBACK_STORY_MD = path.join(process.cwd(), 'STORY.md');

const VALID_LANGUAGES = new Set([
  'ro', 'de', 'es', 'en', 'fr', 'it', 'pt', 'nl', 'hu', 'pl', 'cs', 'sk', 'sv', 'no', 'da', 'fi', 'ja', 'zh', 'ko',
]);

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
          role: { type: 'STRING', description: 'Character role (protagonist, sidekick, mentor, etc.)' },
          appearance: { type: 'STRING', description: 'Hyper-detailed physical appearance description' },
          clothing: { type: 'STRING', description: 'Detailed clothing and accessories description' },
          personality: { type: 'STRING', description: 'Character personality traits' },
          characterSheetPrompt: { type: 'STRING', description: 'Prompt for generating the character reference sheet showing front and back views' },
        },
        required: ['name', 'role', 'appearance', 'clothing', 'personality', 'characterSheetPrompt'],
      },
      description: 'Main characters (max 3)',
    },
    pages: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          pageNumber: { type: 'INTEGER', description: 'Page number starting from 1' },
          text: { type: 'STRING', description: 'Story text for this page (1-2 paragraphs)' },
          imagePrompt: { type: 'STRING', description: 'Detailed scene description for image generation' },
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

async function getStoryPrompt(language: string): Promise<string> {
  // Try language-specific prompt first
  if (VALID_LANGUAGES.has(language)) {
    const langPath = path.join(STORY_PROMPTS_DIR, `${language}.md`);
    try {
      return await fs.readFile(langPath, 'utf-8');
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback to original STORY.md
  return fs.readFile(FALLBACK_STORY_MD, 'utf-8');
}

export async function generateScenario(userPrompt: string, language?: string): Promise<Scenario> {
  const lang = language && VALID_LANGUAGES.has(language) ? language : 'ro';
  const systemInstruction = await getStoryPrompt(lang);

  const scenario = await generateJSON<Scenario>(
    userPrompt,
    systemInstruction,
    scenarioSchema,
  );

  // Ensure all pages have pending status
  scenario.pages = scenario.pages.map(page => ({
    ...page,
    status: page.status ?? 'pending',
  }));

  // Enforce max 3 characters
  if (scenario.characters.length > 3) {
    scenario.characters = scenario.characters.slice(0, 3);
  }

  // Enforce max 20 pages
  if (scenario.pages.length > 20) {
    scenario.pages = scenario.pages.slice(0, 20);
  }

  return scenario;
}
