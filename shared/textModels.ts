export type ThinkingLevel = 'low' | 'medium' | 'high';

export interface TextModelOption {
  id: string;
  name: string;
  thinkingLevels: readonly ThinkingLevel[];
  supportsToolChoice?: boolean;
  pricing: {
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
    longContext?: { aboveInputTokens: number; inputUsdPerMillion: number; outputUsdPerMillion: number };
  };
}

// Curated from OpenRouter's model catalog on 2026-09-06. All support images,
// tool calls, and structured output, including the story image review step.
export const TEXT_MODELS: readonly TextModelOption[] = [
  { id: 'google/gemini-3.8-flash', name: 'Gemini 3.8 Flash', thinkingLevels: ['low', 'medium', 'high'],
    pricing: { inputUsdPerMillion: 0.75, outputUsdPerMillion: 3.75 } },
  { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', thinkingLevels: ['low', 'medium', 'high'],
    pricing: { inputUsdPerMillion: 10, outputUsdPerMillion: 50,
      longContext: { aboveInputTokens: 272_000, inputUsdPerMillion: 20, outputUsdPerMillion: 75 } } },
  { id: 'anthropic/claude-fable-5.1', name: 'Claude Fable 5.1', thinkingLevels: ['low', 'medium', 'high'], supportsToolChoice: false,
    pricing: { inputUsdPerMillion: 10, outputUsdPerMillion: 50 } },
  { id: 'anthropic/claude-opus-5', name: 'Claude Opus 5', thinkingLevels: ['low', 'medium', 'high'],
    pricing: { inputUsdPerMillion: 5, outputUsdPerMillion: 25 } },
  { id: 'qwen/qwen3.8-max-0902', name: 'Qwen 3.8 Max', thinkingLevels: ['low', 'medium', 'high'],
    pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 6 } },
  { id: 'x-ai/grok-4.6', name: 'Grok 4.6', thinkingLevels: ['low', 'medium', 'high'],
    pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 6,
      longContext: { aboveInputTokens: 200_000, inputUsdPerMillion: 4, outputUsdPerMillion: 12 } } },
];

// Display-only snapshot: https://openrouter.ai/api/v1/models. Billing uses response costs.
export const TEXT_MODEL_PRICES_CHECKED_AT = '2026-09-06';
export function textModelPriceLevel(model: TextModelOption): '$' | '$$' | '$$$' {
  // Compare the same workload: one million uncached input and one million output tokens.
  const combined = model.pricing.inputUsdPerMillion + model.pricing.outputUsdPerMillion;
  return combined <= 10 ? '$' : combined <= 40 ? '$$' : '$$$';
}

export const DEFAULT_TEXT_MODEL = 'google/gemini-3.8-flash';
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'medium';
export const MINIMUM_STORY_BALANCE_USD = 10;

export interface TextModelSettings {
  textModel: string;
  thinkingLevel?: ThinkingLevel;
}

export function parseTextModelSettings(model: unknown, level: unknown, allowStoredModel = false): TextModelSettings {
  const storedOption = allowStoredModel && (model === 'openai/gpt-5.6-sol' || model === 'anthropic/claude-sonnet-5')
    ? { id: model, thinkingLevels: ['low', 'medium', 'high'] as readonly ThinkingLevel[] } : undefined;
  const option = TEXT_MODELS.find(item => item.id === (model ?? DEFAULT_TEXT_MODEL)) ?? storedOption;
  if (!option) throw new Error('Select a model from the model list.');
  const thinkingLevel = level ?? (option.thinkingLevels.length ? DEFAULT_THINKING_LEVEL : undefined);
  if (thinkingLevel !== undefined && !option.thinkingLevels.includes(thinkingLevel as ThinkingLevel)) {
    throw new Error('Select a thinking level for this model.');
  }
  return { textModel: option.id, thinkingLevel: thinkingLevel as ThinkingLevel | undefined };
}
