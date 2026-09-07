import { AsyncLocalStorage } from 'node:async_hooks';
import { parseTextModelSettings, type TextModelSettings } from '../../shared/textModels.js';

const context = new AsyncLocalStorage<TextModelSettings>();

export function getTextModelSettings(): TextModelSettings {
  return context.getStore() ?? parseTextModelSettings(undefined, undefined);
}

export function withTextModelSettings<T>(settings: TextModelSettings, work: () => T): T {
  return context.run(settings, work);
}
