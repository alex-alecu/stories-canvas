import { AUDIO_MODELS, DEFAULT_AUDIO_MODEL, getAudioVoices, isAudioModelAvailable } from '../../shared/audioModels';
import type { ReactNode } from 'react';

const copyFor = (language: string) => language === 'ro'
  ? { model: 'Model audio', voice: 'Voce', unavailable: 'Indisponibil pentru această limbă' }
  : { model: 'Audio model', voice: 'Voice', unavailable: 'Not available for this language' };

export default function AudioModelPicker({
  model,
  voice,
  language,
  speechLanguage = language,
  onModelChange,
  onVoiceChange,
  disabled,
  dark = false,
  layout = 'stacked',
  defaultVoicePicker,
  modelDisclosure = false,
}: {
  model: string;
  voice?: string;
  language: string;
  speechLanguage?: string;
  onModelChange: (model: string) => void;
  onVoiceChange: (voice?: string) => void;
  disabled: boolean;
  dark?: boolean;
  layout?: 'stacked' | 'columns';
  defaultVoicePicker?: ReactNode;
  modelDisclosure?: boolean;
}) {
  const copy = copyFor(language);
  const isElevenLabs = model === DEFAULT_AUDIO_MODEL;
  const available = isAudioModelAvailable(model, speechLanguage);
  const voices = getAudioVoices(model, speechLanguage);
  const selectClass = dark
    ? 'mt-1.5 min-h-11 w-full min-w-0 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-base text-white focus:border-primary-400 focus:outline-none disabled:opacity-50 sm:min-h-0 sm:text-sm'
    : 'mt-1.5 min-h-11 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-base text-gray-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-50 sm:min-h-0 sm:text-sm dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100';

  const modelPicker = (
      <label className={`block min-w-0 text-sm font-semibold ${dark ? 'text-white/70' : 'text-gray-700 dark:text-gray-200'}`}>
        {copy.model}
        <select value={model} onChange={event => onModelChange(event.target.value)} disabled={disabled} className={selectClass}>
          {AUDIO_MODELS.map(option => (
            <option key={option.id} value={option.id}>
              {option.name}{isAudioModelAvailable(option.id, speechLanguage) ? '' : ` · ${copy.unavailable}`}
            </option>
          ))}
        </select>
      </label>
  );
  const voicePicker = isElevenLabs ? defaultVoicePicker : (
        <label className={`block min-w-0 text-sm font-semibold ${dark ? 'text-white/70' : 'text-gray-700 dark:text-gray-200'}`}>
          {copy.voice}
          <select value={voice ?? ''} onChange={event => onVoiceChange(event.target.value || undefined)} disabled={disabled || !available} className={selectClass}>
            {voices.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
  );

  return (
    <div className={modelDisclosure ? 'min-w-0 space-y-2' : layout === 'columns' ? 'grid min-w-0 gap-4 sm:grid-cols-2' : 'min-w-0 space-y-3'}>
      {modelDisclosure ? <>
        {voicePicker}
        <details className="group/audio">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 rounded-lg text-sm text-gray-500 focus-visible:outline-2 focus-visible:outline-primary-500 dark:text-gray-400 [&::-webkit-details-marker]:hidden">
            <span className="shrink-0">{copy.model}</span>
            <span aria-hidden="true">·</span>
            <span className="min-w-0 truncate text-gray-700 dark:text-gray-200">{AUDIO_MODELS.find(option => option.id === model)?.name ?? model}</span>
            <svg aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 transition-transform group-open/audio:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
            </svg>
          </summary>
          <div className="pb-2">{modelPicker}</div>
        </details>
      </> : <>{modelPicker}{voicePicker}</>}
      {!available && <p className={`${!modelDisclosure && layout === 'columns' ? 'sm:col-span-2 ' : ''}${dark ? 'text-xs text-amber-200' : 'text-xs text-amber-700 dark:text-amber-300'}`}>{copy.unavailable}</p>}
    </div>
  );
}
