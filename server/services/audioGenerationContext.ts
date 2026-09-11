import { AsyncLocalStorage } from 'node:async_hooks';
import { DEFAULT_AUDIO_MODEL, type AudioModelSettings } from '../../shared/audioModels.js';

const context = new AsyncLocalStorage<AudioModelSettings>();

export function getAudioModelSettings(): AudioModelSettings {
  return context.getStore() ?? { audioModel: DEFAULT_AUDIO_MODEL };
}

export function withAudioModelSettings<T>(settings: AudioModelSettings, work: () => T): T {
  return context.run(settings, work);
}
