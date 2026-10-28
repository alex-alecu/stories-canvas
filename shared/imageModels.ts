export type ImageModelTier = 'fast' | 'pro';

export interface ImageModelOption {
  id: string;
  family: string;
  name: string;
  tier: ImageModelTier;
  maxReferences: number;
  resolution?: '1K' | '2K';
}

// Supported image parameters checked in OpenRouter's Image API on 2026-10-28.
export const IMAGE_MODELS: readonly ImageModelOption[] = [
  { id: 'google/gemini-nano-banana-2.1', family: 'Google', name: 'Nano Banana 2.1', tier: 'fast', maxReferences: 14, resolution: '1K' },
  { id: 'openai/gpt-image-2.5-sunburst', family: 'OpenAI', name: 'GPT Image 2.5 Sunburst', tier: 'pro', maxReferences: 16 },
  { id: 'openai/gpt-image-2.5-flare', family: 'OpenAI', name: 'GPT Image 2.5 Flare', tier: 'fast', maxReferences: 16 },
  { id: 'microsoft/mai-image-2.6', family: 'Microsoft AI', name: 'MAI-Image-2.6', tier: 'pro', maxReferences: 5 },
];

export const DEFAULT_IMAGE_MODEL = 'google/gemini-nano-banana-2.1';
export const DEFAULT_IMAGE_MODEL_PRO = DEFAULT_IMAGE_MODEL;

const LEGACY_IMAGE_MODELS: readonly ImageModelOption[] = [
  { id: 'google/gemini-3.1-flash-image', family: 'Google', name: 'Gemini 3.1 Flash Image', tier: 'fast', maxReferences: 14, resolution: '1K' },
  { id: 'google/gemini-3-pro-image', family: 'Google', name: 'Gemini 3 Pro Image', tier: 'pro', maxReferences: 14, resolution: '1K' },
  { id: 'bytedance-seed/seedream-5-0-lite', family: 'ByteDance Seed', name: 'Seedream 5.0 Lite', tier: 'fast', maxReferences: 14, resolution: '2K' },
  { id: 'bytedance-seed/seedream-5-0-pro', family: 'ByteDance Seed', name: 'Seedream 5.0 Pro', tier: 'pro', maxReferences: 14, resolution: '1K' },
  { id: 'black-forest-labs/flux.2-klein-4b', family: 'Black Forest Labs', name: 'FLUX.2 Klein 4B', tier: 'fast', maxReferences: 4 },
  { id: 'black-forest-labs/flux.2-pro', family: 'Black Forest Labs', name: 'FLUX.2 Pro', tier: 'pro', maxReferences: 8 },
  { id: 'google/gemini-3.1-flash-image-preview', family: 'Google', name: 'Gemini 3.1 Flash Image Preview', tier: 'fast', maxReferences: 14, resolution: '1K' },
  { id: 'google/gemini-3-pro-image-preview', family: 'Google', name: 'Gemini 3 Pro Image Preview', tier: 'pro', maxReferences: 14, resolution: '1K' },
];

function normalizeLegacyId(value: unknown): unknown {
  return typeof value === 'string' && value.startsWith('gemini-') ? `google/${value}` : value;
}

export function parseImageModel(value: unknown, allowStoredModel = false): ImageModelOption {
  const id = normalizeLegacyId(value ?? DEFAULT_IMAGE_MODEL);
  const model = IMAGE_MODELS.find(item => item.id === id)
    ?? (allowStoredModel ? LEGACY_IMAGE_MODELS.find(item => item.id === id) : undefined);
  if (!model) throw new Error('Select an image model from the model list.');
  return model;
}

export function getStoredImageModel(inputs: {
  imageModel?: string;
  imageModelPro?: string;
  proModel?: boolean;
} | undefined, pro = inputs?.proModel ?? false): ImageModelOption {
  const stored = pro && inputs?.imageModelPro ? inputs.imageModelPro : inputs?.imageModel;
  return parseImageModel(stored ?? (pro ? DEFAULT_IMAGE_MODEL_PRO : DEFAULT_IMAGE_MODEL), true);
}

export function getSelectableImageModelId(value: string): string {
  const stored = parseImageModel(value, true);
  return IMAGE_MODELS.some(model => model.id === stored.id) ? stored.id : DEFAULT_IMAGE_MODEL;
}
