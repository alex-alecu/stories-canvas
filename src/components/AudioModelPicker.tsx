import { AUDIO_MODELS, DEFAULT_AUDIO_MODEL, getAudioVoices, isAudioModelAvailable } from '../../shared/audioModels';

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
}: {
  model: string;
  voice?: string;
  language: string;
  speechLanguage?: string;
  onModelChange: (model: string) => void;
  onVoiceChange: (voice?: string) => void;
  disabled: boolean;
  dark?: boolean;
}) {
  const copy = copyFor(language);
  const isElevenLabs = model === DEFAULT_AUDIO_MODEL;
  const available = isAudioModelAvailable(model, speechLanguage);
  const voices = getAudioVoices(model, speechLanguage);
  const selectClass = dark
    ? 'mt-1.5 w-full min-w-0 rounded-lg border border-white/10 bg-black/25 px-3 py-2 text-sm text-white focus:border-primary-400 focus:outline-none disabled:opacity-50'
    : 'mt-1.5 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-50 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100';

  return (
    <div className="min-w-0 space-y-3">
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
      {!isElevenLabs && (
        <label className={`block min-w-0 text-sm font-semibold ${dark ? 'text-white/70' : 'text-gray-700 dark:text-gray-200'}`}>
          {copy.voice}
          <select value={voice ?? ''} onChange={event => onVoiceChange(event.target.value || undefined)} disabled={disabled || !available} className={selectClass}>
            {voices.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
          </select>
        </label>
      )}
      {!available && <p className={dark ? 'text-xs text-amber-200' : 'text-xs text-amber-700 dark:text-amber-300'}>{copy.unavailable}</p>}
    </div>
  );
}
