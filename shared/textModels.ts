export type ThinkingLevel = 'low' | 'medium' | 'high';

export interface TextModelOption {
  id: string;
  name: string;
  thinkingLevels: readonly ThinkingLevel[];
}

// Curated from OpenRouter's model catalog on 2026-09-06. All support images,
// tool calls, and structured output, including the story image review step.
export const TEXT_MODELS: readonly TextModelOption[] = [
  { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', thinkingLevels: ['low', 'medium', 'high'] },
  { id: 'openai/gpt-5.6-sol', name: 'GPT-5.6 Sol', thinkingLevels: ['low', 'medium', 'high'] },
  { id: 'anthropic/claude-sonnet-5', name: 'Claude Sonnet 5', thinkingLevels: ['low', 'medium', 'high'] },
  { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', thinkingLevels: ['low', 'medium', 'high'] },
  { id: 'qwen/qwen3.8-max-0902', name: 'Qwen 3.8 Max', thinkingLevels: ['low', 'medium', 'high'] },
  { id: 'x-ai/grok-4.6', name: 'Grok 4.6', thinkingLevels: ['low', 'medium', 'high'] },
];

export const DEFAULT_TEXT_MODEL = 'google/gemini-3.8-flash';
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';
export const MINIMUM_STORY_BALANCE_USD = 10;

export interface TextModelSettings {
  textModel: string;
  thinkingLevel?: ThinkingLevel;
}

export function parseTextModelSettings(model: unknown, level: unknown): TextModelSettings {
  const option = TEXT_MODELS.find(item => item.id === (model ?? DEFAULT_TEXT_MODEL));
  if (!option) throw new Error('Select a model from the model list.');
  const thinkingLevel = level ?? (option.thinkingLevels.length ? DEFAULT_THINKING_LEVEL : undefined);
  if (thinkingLevel !== undefined && !option.thinkingLevels.includes(thinkingLevel as ThinkingLevel)) {
    throw new Error('Select a thinking level for this model.');
  }
  return { textModel: option.id, thinkingLevel: thinkingLevel as ThinkingLevel | undefined };
}
