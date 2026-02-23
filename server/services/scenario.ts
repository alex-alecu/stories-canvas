import fs from 'fs/promises';
import path from 'path';
import { generateJSON } from './gemini.js';
import type { Scenario } from '../../shared/types.js';

const STORY_MD_PATH = new URL('../../STORY.md', import.meta.url).pathname;

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

export async function generateScenario(userPrompt: string): Promise<Scenario> {
  const systemInstruction = await fs.readFile(STORY_MD_PATH, 'utf-8');

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
