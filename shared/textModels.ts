export type ThinkingLevel = 'low' | 'medium' | 'high' | 'xhigh';

export interface TextModelOption {
  id: string;
  name: string;
  thinkingLevels: readonly ThinkingLevel[];
  maxCompletionTokens: number;
  supportsToolChoice?: boolean;
  pricing: {
    inputUsdPerMillion: number;
    outputUsdPerMillion: number;
    longContext?: { aboveInputTokens: number; inputUsdPerMillion: number; outputUsdPerMillion: number };
  };
}

// Checked against OpenRouter's model catalog on 2026-10-28.
// All selectable models support xhigh reasoning, tools, and structured output.
export const TEXT_MODELS: readonly TextModelOption[] = [
  { id: 'anthropic/claude-opus-5.5', name: 'Claude Opus 5.5', thinkingLevels: ['low', 'medium', 'high', 'xhigh'],
    maxCompletionTokens: 128_000,
    pricing: { inputUsdPerMillion: 4, outputUsdPerMillion: 20 } },
  { id: 'openai/gpt-6-astra', name: 'GPT-6 Astra', thinkingLevels: ['low', 'medium', 'high', 'xhigh'],
    maxCompletionTokens: 128_000,
    pricing: { inputUsdPerMillion: 10, outputUsdPerMillion: 50,
      longContext: { aboveInputTokens: 272_000, inputUsdPerMillion: 20, outputUsdPerMillion: 75 } } },
  { id: 'openai/gpt-6.1-sol', name: 'GPT-6.1 Sol', thinkingLevels: ['low', 'medium', 'high', 'xhigh'],
    maxCompletionTokens: 128_000,
    pricing: { inputUsdPerMillion: 2, outputUsdPerMillion: 10,
      longContext: { aboveInputTokens: 272_000, inputUsdPerMillion: 4, outputUsdPerMillion: 15 } } },
];

// Display-only snapshot: https://openrouter.ai/api/v1/models. Billing uses response costs.
export const TEXT_MODEL_PRICES_CHECKED_AT = '2026-10-28';
export function textModelPriceLevel(model: TextModelOption): '$' | '$$' | '$$$' {
  // Compare the same workload: one million uncached input and one million output tokens.
  const combined = model.pricing.inputUsdPerMillion + model.pricing.outputUsdPerMillion;
  return combined <= 10 ? '$' : combined <= 40 ? '$$' : '$$$';
}

export const DEFAULT_TEXT_MODEL = 'anthropic/claude-opus-5.5';
export const DEFAULT_THINKING_LEVEL: ThinkingLevel = 'xhigh';
export const MINIMUM_STORY_BALANCE_USD = 10;

export interface TextModelSettings {
  textModel: string;
  thinkingLevel?: ThinkingLevel;
}

const STORED_TEXT_MODELS: readonly Pick<TextModelOption, 'id' | 'thinkingLevels' | 'maxCompletionTokens' | 'supportsToolChoice'>[] = [
  { id: 'google/gemini-3.8-flash', thinkingLevels: ['low', 'medium', 'high'], maxCompletionTokens: 65_536 },
  { id: 'anthropic/claude-fable-5.1', thinkingLevels: ['low', 'medium', 'high'], maxCompletionTokens: 128_000, supportsToolChoice: false },
  { id: 'anthropic/claude-opus-5', thinkingLevels: ['low', 'medium', 'high'], maxCompletionTokens: 128_000 },
  { id: 'qwen/qwen3.8-max-0902', thinkingLevels: ['low', 'medium', 'high'], maxCompletionTokens: 131_072 },
  { id: 'x-ai/grok-4.6', thinkingLevels: ['low', 'medium', 'high'], maxCompletionTokens: 450_000 },
  { id: 'openai/gpt-5.6-sol', thinkingLevels: ['low', 'medium', 'high'], maxCompletionTokens: 128_000 },
  { id: 'anthropic/claude-sonnet-5', thinkingLevels: ['low', 'medium', 'high'], maxCompletionTokens: 128_000 },
  { id: 'google/gemini-3.1-pro-preview', thinkingLevels: ['low', 'medium', 'high'], maxCompletionTokens: 65_536 },
];

// Saved stories retain their model's tool support even when it is no longer selectable.
export function supportsTextModelToolChoice(model: string): boolean {
  const option = TEXT_MODELS.find(item => item.id === model) ?? STORED_TEXT_MODELS.find(item => item.id === model);
  return option?.supportsToolChoice !== false;
}

// Output limits were checked against OpenRouter's catalog on 2026-10-28.
// Reasoning and visible output share this per-response allowance.
export function getTextCompletionTokenLimit(model: string): number {
  const option = TEXT_MODELS.find(item => item.id === model) ?? STORED_TEXT_MODELS.find(item => item.id === model);
  if (!option) throw new Error('Select a model from the model list.');
  return Math.min(128_000, option.maxCompletionTokens);
}

export function parseTextModelSettings(model: unknown, level: unknown, allowStoredModel = false): TextModelSettings {
  const storedOption = allowStoredModel ? STORED_TEXT_MODELS.find(item => item.id === model) : undefined;
  const option = TEXT_MODELS.find(item => item.id === (model ?? DEFAULT_TEXT_MODEL)) ?? storedOption;
  if (!option) throw new Error('Select a model from the model list.');
  const defaultLevel = option.thinkingLevels.includes(DEFAULT_THINKING_LEVEL) ? DEFAULT_THINKING_LEVEL : 'medium';
  const thinkingLevel = level ?? (option.thinkingLevels.length ? defaultLevel : undefined);
  if (thinkingLevel !== undefined && !option.thinkingLevels.includes(thinkingLevel as ThinkingLevel)) {
    throw new Error('Select a thinking level for this model.');
  }
  return { textModel: option.id, thinkingLevel: thinkingLevel as ThinkingLevel | undefined };
}
