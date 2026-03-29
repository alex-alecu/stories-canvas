import { GoogleGenAI, type ThinkingConfig } from '@google/genai';
import { config } from '../config.js';

const ai = new GoogleGenAI({ apiKey: config.geminiApiKey });

export { ai };

export interface JSONGenerationOptions {
  temperature?: number;
  thinkingConfig?: ThinkingConfig;
  maxRetries?: number;
}

function shouldRetryWithoutThinking(error: Error): boolean {
  const message = error.message.toLowerCase();
  const mentionsThinking = message.includes('thinking')
    || message.includes('thinkingconfig')
    || message.includes('thinkingbudget');

  if (!mentionsThinking) {
    return false;
  }

  return message.includes('unsupported')
    || message.includes('not supported')
    || message.includes('unknown field')
    || message.includes('unknown name')
    || message.includes('cannot find field')
    || message.includes('invalid argument')
    || message.includes('not available');
}

export async function generateJSON<T>(
  prompt: string,
  systemInstruction: string,
  schema: Record<string, unknown>,
  options: JSONGenerationOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? config.maxRetries;
  let lastError: Error | null = null;
  let thinkingConfig = options.thinkingConfig;
  let thinkingFallbackUsed = false;
  let remainingRetries = maxRetries;

  while (remainingRetries > 0) {
    try {
      const response = await ai.models.generateContent({
        model: config.scenarioModel,
        contents: prompt,
        config: {
          systemInstruction,
          temperature: options.temperature,
          responseMimeType: 'application/json',
          responseSchema: schema as any,
          thinkingConfig,
        },
      });

      const text = response.text;
      if (!text) {
        throw new Error('Empty response from Gemini');
      }

      const parsed = JSON.parse(text) as T;
      return parsed;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      console.error(`Attempt ${maxRetries - remainingRetries + 1}/${maxRetries} failed:`, lastError.message);

      if (thinkingConfig && !thinkingFallbackUsed && shouldRetryWithoutThinking(lastError)) {
        thinkingFallbackUsed = true;
        thinkingConfig = undefined;
        console.warn('Retrying JSON generation without thinkingConfig after unsupported-model error');
        continue;
      }

      remainingRetries--;

      if (remainingRetries > 0) {
        const failedAttempts = maxRetries - remainingRetries;
        const delay = Math.pow(2, failedAttempts - 1) * 1000 + Math.random() * 1000;
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(`Failed after ${maxRetries} attempts: ${lastError?.message}`);
}

export async function generateImage(
  prompt: string,
  referenceImages: Array<{ data: string; mimeType: string }> = [],
  pro?: boolean,
): Promise<string> {
  const contents: Array<{ inlineData?: { data: string; mimeType: string }; text?: string }> = [];

  for (const img of referenceImages) {
    contents.push({ inlineData: { data: img.data, mimeType: img.mimeType } });
  }
  contents.push({ text: prompt });

  const response = await ai.models.generateContent({
    model: pro ? config.imageModelPro : config.imageModel,
    contents,
    config: {
      responseModalities: ['IMAGE'],
      imageGenerationConfig: { aspectRatio: '4:3' },
    } as any,
  });

  const parts = response.candidates?.[0]?.content?.parts;
  if (!parts) {
    throw new Error('No parts in image generation response');
  }

  for (const part of parts) {
    if (part.inlineData?.data) {
      return part.inlineData.data;
    }
  }

  throw new Error('No image data in response');
}
