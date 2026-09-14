import TextModelPicker from './TextModelPicker';
import ImageModelPicker from './ImageModelPicker';
import AudioModelPicker from './AudioModelPicker';
import { DEFAULT_IMAGE_MODEL } from '../../shared/imageModels';
import { DEFAULT_AUDIO_MODEL, getAudioVoices, isAudioModelAvailable } from '../../shared/audioModels';
import { MINIMUM_STORY_BALANCE_USD, parseTextModelSettings } from '../../shared/textModels';
import { getWalletCopy } from '../i18n/walletCopy';
import { getStoryInputCopy } from '../i18n/storyInputCopy';
import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useBillingOverview } from '../hooks/useBilling';
import { useLanguage } from '../i18n/LanguageContext';
import {
  AGE_RANGES,
  DEFAULT_AGE,
  DEFAULT_ART_STYLE,
  DEFAULT_VOICE_KEY,
  getAgeGroup,
  VOICE_OPTIONS,
  type ArtStyleKey,
  type VoiceKey,
  type CreateStoryRequest,
} from '../../shared/types';
import { getRandomStoryIdea } from '../data/storyIdeas';
import { getVoiceOptionText } from '../i18n/storyStatusCopy';
import { formatCredits } from '../i18n/billingCopy';
import { clientSiteConfig } from '../lib/siteConfig';

const STYLE_KEYS = ['storybook', 'disney-pixar', 'anime', 'colored-pencil', 'paper-cutout'] as const satisfies ReadonlyArray<ArtStyleKey>;
type SelectableArtStyleKey = (typeof STYLE_KEYS)[number];

const styleTranslationMap: Record<SelectableArtStyleKey, keyof ReturnType<typeof useLanguage>['t']> = {
  'storybook': 'styleStorybook',
  'disney-pixar': 'styleDisneyPixar',
  'anime': 'styleAnime',
  'colored-pencil': 'styleColoredPencil',
  'paper-cutout': 'stylePaperCutout',
};

interface StoryInputProps {
  onSubmit: (request: CreateStoryRequest) => void;
  isLoading: boolean;
  isOffline?: boolean;
}

export default function StoryInput({ onSubmit, isLoading, isOffline = false }: StoryInputProps) {
  const [prompt, setPrompt] = useState('');
  const [age, setAge] = useState<number>(DEFAULT_AGE);
  const [style, setStyle] = useState<ArtStyleKey>(DEFAULT_ART_STYLE);
  const [settings, setSettings] = useState(() => parseTextModelSettings(undefined, undefined));
  const [imageModel, setImageModel] = useState(DEFAULT_IMAGE_MODEL);
  const [audioEnabled, setAudioEnabled] = useState(false);
  const [voice, setVoice] = useState<VoiceKey | ''>(DEFAULT_VOICE_KEY);
  const [audioModel, setAudioModel] = useState(DEFAULT_AUDIO_MODEL);
  const [audioVoice, setAudioVoice] = useState<string | undefined>();
  const maxLength = 500;
  const { user, loading } = useAuth();
  const { data: billingOverview } = useBillingOverview(!!user);
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const copy = getWalletCopy(language);
  const formCopy = getStoryInputCopy(language);
  const requiredCredits = MINIMUM_STORY_BALANCE_USD;
  const availableCredits = billingOverview?.balance.availableCredits ?? 0;
  const hasEnoughCredits = !user || (!!billingOverview && availableCredits >= requiredCredits);

  // Set data-age-group on <html> for CSS-driven background animations
  useEffect(() => {
    document.documentElement.dataset.ageGroup = getAgeGroup(age);
    return () => {
      delete document.documentElement.dataset.ageGroup;
    };
  }, [age]);

  const handleGuestClick = () => {
    if (!loading && !user) {
      navigate(`/login?returnTo=${encodeURIComponent(location.pathname)}`);
    }
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!user) {
      handleGuestClick();
      return;
    }

    if (!hasEnoughCredits) {
      navigate('/profile?reason=insufficient-credits');
      return;
    }

    const trimmed = prompt.trim();
    if (trimmed && !isLoading && (!audioEnabled || isAudioModelAvailable(audioModel, language))) {
      onSubmit({
        prompt: trimmed,
        age,
        style,
        ...settings,
        imageModel,
        audioEnabled,
        ...(audioEnabled ? {
          audioModel,
          ...(audioModel === DEFAULT_AUDIO_MODEL
            ? { voice: voice || undefined }
            : { audioVoice }),
        } : {}),
      });
    }
  };

  const handleAudioModelChange = (nextModel: string) => {
    setAudioModel(nextModel);
    const nextVoice = getAudioVoices(nextModel, language)[0]?.id;
    setAudioVoice(nextVoice);
  };

  useEffect(() => {
    if (audioModel === DEFAULT_AUDIO_MODEL || !isAudioModelAvailable(audioModel, language)) return;
    const voices = getAudioVoices(audioModel, language);
    if (!voices.some(option => option.id === audioVoice)) setAudioVoice(voices[0]?.id);
  }, [audioModel, audioVoice, language]);

  const handleIdeaClick = () => {
    setPrompt(getRandomStoryIdea(language));
  };

  const isGuest = !loading && !user;
  const defaultSettings = parseTextModelSettings(undefined, undefined);
  const hasCustomSettings = settings.textModel !== defaultSettings.textModel
    || settings.thinkingLevel !== defaultSettings.thinkingLevel
    || imageModel !== DEFAULT_IMAGE_MODEL;
  const selectClass = 'mt-2 min-h-13 w-full min-w-0 rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-base text-gray-800 focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-50 sm:text-sm dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100';

  return (
    <div className="w-full max-w-5xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="mb-4 flex justify-center">
          <picture>
            <source
              type="image/avif"
              srcSet="/logo-big-256.avif 256w, /logo-big-384.avif 384w, /logo-big-512.avif 512w"
              sizes="(min-width: 1024px) 384px, (min-width: 768px) 320px, 78vw"
            />
            <source
              type="image/webp"
              srcSet="/logo-big-256.webp 256w, /logo-big-384.webp 384w, /logo-big-512.webp 512w"
              sizes="(min-width: 1024px) 384px, (min-width: 768px) 320px, 78vw"
            />
            <img
              src="/logo-big-384.png"
              srcSet="/logo-big-256.png 256w, /logo-big-384.png 384w, /logo-big-512.png 512w"
              sizes="(min-width: 1024px) 384px, (min-width: 768px) 320px, 78vw"
              alt={clientSiteConfig.siteName}
              width={720}
              height={497}
              className="w-64 max-w-[78vw] md:w-80 lg:w-96"
              decoding="async"
              fetchPriority="high"
            />
          </picture>
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-lg">
          {t.appSubtitle}
        </p>
      </div>

      {isOffline ? (
        <div className="bg-white dark:bg-surface-dark-elevated rounded-2xl shadow-lg shadow-primary-100/50 dark:shadow-primary-900/30 border border-primary-100 dark:border-primary-800/50 p-6 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300" aria-hidden="true">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 18.75h.01M8.25 15.75a5.25 5.25 0 0 1 7.5 0M5.25 12.75a9.75 9.75 0 0 1 13.5 0M2.25 9.75a14.25 14.25 0 0 1 19.5 0" />
              <path strokeLinecap="round" d="m4.5 4.5 15 15" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-800 dark:text-gray-100">
            {t.offlineHomeTitle}
          </h2>
          <p className="mx-auto mt-2 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
            {t.offlineHomeDescription}
          </p>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="relative mx-auto max-w-3xl">
        <div className="overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-xl shadow-primary-900/5 dark:border-white/10 dark:bg-surface-dark-elevated sm:rounded-3xl">
          {/* Overlay for guest users: captures clicks/focus on the textarea */}
          {isGuest && (
            <div
              onClick={handleGuestClick}
              className="absolute inset-0 z-10 cursor-pointer"
              title={t.storyInputGuestPlaceholder}
            />
          )}
          <div className="px-4 pt-4 sm:px-6 sm:pt-6">
            <label htmlFor="story-prompt" className="block text-xl font-bold tracking-tight text-gray-800 dark:text-gray-100 sm:text-2xl">
              {formCopy.prompt}
            </label>
            <textarea
              id="story-prompt"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder={isGuest ? t.storyInputGuestPlaceholder : t.storyInputPlaceholder}
              maxLength={maxLength}
              rows={3}
              disabled={isLoading}
              readOnly={isGuest}
              className="mt-3 block w-full rounded-xl border border-gray-200 bg-gray-50/70 px-4 py-3 text-base leading-relaxed text-gray-700 placeholder-gray-400 focus:border-primary-400 focus:outline-none focus:ring-2 focus:ring-primary-100 disabled:opacity-50 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-200 dark:placeholder-gray-500 dark:focus:ring-primary-900"
            />
            {!isGuest && (
              <div className="mt-2 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={handleIdeaClick}
                  disabled={isLoading}
                  className="inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-md py-1 text-sm font-semibold text-primary-600 transition-colors hover:text-primary-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed disabled:opacity-50 sm:min-h-0 dark:text-primary-300 dark:hover:text-primary-200"
                >
                  <svg aria-hidden="true" className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5L12 3ZM20 3v4m-2-2h4" />
                  </svg>
                  {t.storyIdeaButton}
                </button>
                <span className="text-xs tabular-nums text-gray-400 dark:text-gray-500">{prompt.length}/{maxLength}</span>
              </div>
            )}
          </div>

          {!isGuest && (
            <div className="space-y-5 px-4 py-4 sm:px-6 sm:py-6">
              <div className="grid grid-cols-1 gap-5 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                <fieldset disabled={isLoading} className="min-w-0">
                  <legend className="text-sm font-semibold text-gray-700 dark:text-gray-200">{t.childAge}</legend>
                  <div className="mt-2 grid grid-cols-5 gap-1 rounded-xl bg-gray-100 p-1 dark:bg-surface-dark">
                    {AGE_RANGES.map(({ value, label }) => (
                      <label key={value} className="relative min-w-0 cursor-pointer">
                        <input
                          type="radio"
                          name="child-age"
                          value={value}
                          checked={age === value}
                          onChange={() => setAge(value)}
                          className="peer sr-only"
                        />
                        <span className="flex min-h-11 items-center justify-center rounded-lg text-base font-semibold text-gray-500 transition-colors peer-checked:bg-white peer-checked:text-primary-700 peer-checked:shadow-sm peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-primary-500 peer-disabled:cursor-not-allowed peer-disabled:opacity-50 dark:text-gray-400 dark:peer-checked:bg-surface-dark-accent dark:peer-checked:text-primary-200">{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label htmlFor="style-select" className="min-w-0 text-sm font-semibold text-gray-700 dark:text-gray-200">
                  {t.artStyle}
                  <select
                    id="style-select"
                    value={style}
                    onChange={(e) => setStyle(e.target.value as ArtStyleKey)}
                    disabled={isLoading}
                    className={selectClass}
                  >
                    {STYLE_KEYS.map((key) => (
                      <option key={key} value={key}>{t[styleTranslationMap[key]]}</option>
                    ))}
                  </select>
                </label>
              </div>

              <section aria-labelledby="narration-label" className="border-t border-gray-100 pt-5 dark:border-gray-700">
                <label className="flex min-h-11 cursor-pointer items-center justify-between gap-4 sm:min-h-0">
                  <span className="flex min-w-0 items-center gap-3">
                    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary-50 text-primary-600 dark:bg-primary-900/30 dark:text-primary-300">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M4 14v-3a8 8 0 0 1 16 0v3M4 13H3v6h4v-6H4Zm16 0h1v6h-4v-6h3Z" />
                      </svg>
                    </span>
                    <span className="min-w-0">
                      <span id="narration-label" className="block text-sm font-bold text-gray-800 dark:text-gray-100">{copy.narration}</span>
                      <span id="narration-hint" className="mt-0.5 block text-sm text-gray-500 dark:text-gray-400">{formCopy.narrationHint}</span>
                    </span>
                  </span>
                  <span className="relative inline-flex shrink-0">
                    <input
                      type="checkbox"
                      role="switch"
                      aria-labelledby="narration-label"
                      aria-describedby="narration-hint"
                      aria-controls="narration-options"
                      checked={audioEnabled}
                      onChange={event => setAudioEnabled(event.target.checked)}
                      disabled={isLoading}
                      className="peer sr-only"
                    />
                    <span aria-hidden="true" className="h-6 w-11 rounded-full bg-gray-300 transition-colors peer-checked:bg-primary-600 peer-focus-visible:ring-2 peer-focus-visible:ring-primary-500 peer-focus-visible:ring-offset-2 peer-disabled:opacity-50 dark:bg-gray-600" />
                    <span aria-hidden="true" className="pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-full bg-white shadow-sm transition-transform peer-checked:translate-x-5 peer-disabled:opacity-50" />
                  </span>
                </label>
                <div id="narration-options" hidden={!audioEnabled}>
                  {audioEnabled && (
                    <div className="mt-4">
                      <AudioModelPicker
                        model={audioModel}
                        voice={audioVoice}
                        language={language}
                        onModelChange={handleAudioModelChange}
                        onVoiceChange={setAudioVoice}
                        disabled={isLoading}
                        modelDisclosure
                        defaultVoicePicker={
                          <label htmlFor="voice-select" className="block min-w-0 text-sm font-semibold text-gray-700 dark:text-gray-200">
                            {t.narratorVoice}
                            <select
                              id="voice-select"
                              value={voice}
                              onChange={(e) => setVoice(e.target.value as VoiceKey | '')}
                              disabled={isLoading}
                              className={selectClass}
                            >
                              {VOICE_OPTIONS.map((option) => (
                                <option key={option.key} value={option.key}>{getVoiceOptionText(option, t).label}</option>
                              ))}
                            </select>
                          </label>
                        }
                      />
                    </div>
                  )}
                </div>
              </section>

              <details className="group border-t border-gray-100 pt-4 dark:border-gray-700">
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-3 rounded-md text-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary-500 sm:min-h-0 [&::-webkit-details-marker]:hidden">
                  <span className="min-w-0">
                    <span className="block font-semibold text-gray-700 dark:text-gray-200">{formCopy.advanced}</span>
                    <span className={`mt-0.5 block text-xs ${hasCustomSettings ? 'text-primary-600 dark:text-primary-300' : 'text-gray-500 dark:text-gray-400'}`}>
                      {hasCustomSettings ? formCopy.settingsCustom : formCopy.settingsDefault}
                    </span>
                  </span>
                  <svg aria-hidden="true" className="ml-auto h-4 w-4 shrink-0 text-gray-400 transition-transform group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m6 9 6 6 6-6" />
                  </svg>
                </summary>
                <div className="mt-4 space-y-4">
                  <TextModelPicker value={settings} onChange={next => setSettings(current => ({ ...current, ...next }))} disabled={isLoading} />
                  <div>
                    <ImageModelPicker value={imageModel} onChange={setImageModel} disabled={isLoading} language={language} />
                  </div>
                  {hasCustomSettings && (
                    <div className="flex justify-end">
                      <button type="button" disabled={isLoading}
                        onClick={() => { setSettings(defaultSettings); setImageModel(DEFAULT_IMAGE_MODEL); }}
                        className="min-h-11 rounded-lg px-3 text-sm font-semibold text-primary-600 hover:bg-primary-50 focus-visible:outline-2 focus-visible:outline-primary-500 disabled:opacity-50 dark:text-primary-300 dark:hover:bg-white/5">
                        {formCopy.resetSettings}
                      </button>
                    </div>
                  )}
                </div>
              </details>
            </div>
          )}

          <div className="flex flex-col gap-4 border-t border-gray-100 bg-gray-50/70 px-4 py-4 sm:px-6 sm:py-5 sm:flex-row sm:items-center sm:justify-between dark:border-gray-700 dark:bg-white/[0.02]">
            {!isGuest ? (
              <div className="min-w-0 space-y-1.5">
                {billingOverview ? (
                  <p className="flex flex-wrap items-baseline gap-x-2 text-sm text-gray-500 dark:text-gray-400">
                    <span>{t.creditsAvailableLabel}</span>
                    <strong className="text-lg font-bold tabular-nums text-gray-800 dark:text-gray-100">{formatCredits(availableCredits, t)}</strong>
                  </p>
                ) : <p className="text-sm text-gray-500 dark:text-gray-400">{copy.minimum}</p>}
                {billingOverview && !hasEnoughCredits && <p className="text-sm font-medium text-amber-800 dark:text-amber-300">{copy.minimum}</p>}
                <p className="text-xs leading-relaxed text-gray-500 dark:text-gray-400">{copy.actualCost}</p>
              </div>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={user ? (isLoading || !billingOverview || (hasEnoughCredits && (!prompt.trim() || (audioEnabled && !isAudioModelAvailable(audioModel, language))))) : false}
              className="min-h-12 w-full bg-primary-600 hover:bg-primary-700 disabled:bg-gray-300 dark:disabled:bg-gray-700 text-white font-bold py-2.5 px-8 rounded-xl transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary-500 disabled:cursor-not-allowed shrink-0 sm:w-auto sm:min-w-[180px]"
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {t.creating}
                </span>
              ) : user && !hasEnoughCredits ? (
                t.getCredits
              ) : (
                t.createStory
              )}
            </button>
          </div>
        </div>
        </form>
      )}
    </div>
  );
}
