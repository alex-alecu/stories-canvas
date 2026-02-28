import fs from 'fs/promises';
import path from 'path';
import { generateJSON } from './gemini.js';
import type { Scenario, ArtStyleKey } from '../../shared/types.js';
import { ART_STYLES, DEFAULT_ART_STYLE, DEFAULT_AGE } from '../../shared/types.js';

const STORY_PROMPTS_DIR = path.join(process.cwd(), 'story-prompts');

const VALID_LANGUAGES = new Set([
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
          role: {
            type: 'STRING',
            description: 'Character role (protagonist, sidekick, mentor, etc.)',
          },
          appearance: {
            type: 'STRING',
            description: 'Hyper-detailed physical appearance description',
          },
          clothing: {
            type: 'STRING',
            description: 'Detailed clothing and accessories description',
          },
          personality: {
            type: 'STRING',
            description: 'Character personality traits',
          },
          characterSheetPrompt: {
            type: 'STRING',
            description:
              'Prompt for generating the character reference sheet showing front and back views',
          },
        },
        required: [
          'name',
          'role',
          'appearance',
          'clothing',
          'personality',
          'characterSheetPrompt',
        ],
      },
      description: 'Main characters (max 3)',
    },
    pages: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          pageNumber: {
            type: 'INTEGER',
            description: 'Page number starting from 1',
          },
          text: {
            type: 'STRING',
            description: 'Story text for this page (1-2 paragraphs)',
          },
          imagePrompt: {
            type: 'STRING',
            description: 'Detailed scene description for image generation',
          },
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

  // Fallback to Romanian
  return fs.readFile(path.join(STORY_PROMPTS_DIR, `ro.md`), 'utf-8');
}

export async function generateScenario(
  userPrompt: string,
  language?: string,
  age?: number,
  style?: ArtStyleKey,
): Promise<Scenario> {
  const lang = language && VALID_LANGUAGES.has(language) ? language : 'ro';
  let systemInstruction = await getStoryPrompt(lang);

  // Replace the default Disney/Pixar style in the system prompt with the user-selected style
  const styleDesc = style ? ART_STYLES[style] : ART_STYLES[DEFAULT_ART_STYLE];
  systemInstruction = systemInstruction.replace(
    /Disney\/Pixar 3D animation style with warm, round, and friendly character designs/g,
    styleDesc,
  );

  // Build enhanced prompt with age context
  const targetAge = age ?? DEFAULT_AGE;
  const enhancedPrompt = `[Target age: ${targetAge} years old]\n[Art style: ${styleDesc}]\n\n${userPrompt}`;

  const scenario = await generateJSON<Scenario>(
    enhancedPrompt,
    systemInstruction,
    scenarioSchema,
  );

  // Ensure all pages have pending status
  scenario.pages = scenario.pages.map((page) => ({
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
