export const storyScriptSchema = {
  type: 'OBJECT',
  properties: {
    title: { type: 'STRING', description: 'Story title' },
    targetAge: { type: 'INTEGER', description: 'Target age of the reader' },
    characters: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING', description: 'Character name' },
          role: { type: 'STRING', description: 'Character role' },
          appearance: { type: 'STRING', description: 'Detailed physical appearance' },
          clothing: { type: 'STRING', description: 'Detailed clothing and accessories' },
          personality: { type: 'STRING', description: 'Character personality traits' },
          characterSheetPrompt: {
            type: 'STRING',
            description: 'Prompt for generating front and back character reference views',
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
      description: 'Main visual characters used by the story',
    },
    pages: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          pageNumber: { type: 'INTEGER', description: 'Page number starting from 1' },
          text: { type: 'STRING', description: 'Read-aloud script for this page' },
          imagePrompt: { type: 'STRING', description: 'Detailed scene description for illustration' },
          characters: {
            type: 'ARRAY',
            items: { type: 'STRING' },
            description: 'Exact names of characters visible on this page',
          },
        },
        required: ['pageNumber', 'text', 'imagePrompt', 'characters'],
      },
      description: 'The complete page-by-page story script',
    },
  },
  required: ['title', 'targetAge', 'characters', 'pages'],
} as const;

export const storyScriptToolParameters = {
  type: 'OBJECT',
  properties: {
    script: storyScriptSchema,
  },
  required: ['script'],
} as const;
