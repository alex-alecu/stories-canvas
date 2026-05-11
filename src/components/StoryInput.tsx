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
  getStoryModeCredits,
  VOICE_OPTIONS,
  type ArtStyleKey,
  type StoryMode,
  type VoiceKey,
} from '../../shared/types';
import { getRandomStoryIdea } from '../data/storyIdeas';
import { getVoiceOptionText } from '../i18n/storyStatusCopy';
import { formatCredits } from '../i18n/billingCopy';

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
  onSubmit: (prompt: string, age: number, style: ArtStyleKey, storyMode: StoryMode, voice?: VoiceKey) => void;
  isLoading: boolean;
}

export default function StoryInput({ onSubmit, isLoading }: StoryInputProps) {
  const [prompt, setPrompt] = useState('');
  const [age, setAge] = useState<number>(DEFAULT_AGE);
  const [style, setStyle] = useState<ArtStyleKey>(DEFAULT_ART_STYLE);
  const [storyMode, setStoryMode] = useState<StoryMode>('fast');
  const [voice, setVoice] = useState<VoiceKey | ''>(DEFAULT_VOICE_KEY);
  const maxLength = 500;
  const { user, loading } = useAuth();
  const { data: billingOverview } = useBillingOverview(!!user);
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();
  const requiredCredits = getStoryModeCredits(storyMode);
  const availableCredits = billingOverview?.balance.availableCredits ?? 0;
  const hasEnoughCredits = !user || !billingOverview || availableCredits >= requiredCredits;

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
    if (trimmed && !isLoading) {
      onSubmit(trimmed, age, style, storyMode, storyMode === 'pro_audio' ? voice || undefined : undefined);
      setPrompt('');
    }
  };

  const handleIdeaClick = () => {
    setPrompt(getRandomStoryIdea(language));
  };

  const isGuest = !loading && !user;
  const creditsSummary = `${t.creditsRequiredLabel}: ${formatCredits(requiredCredits, t)}${user && billingOverview ? ` · ${t.creditsAvailableLabel}: ${formatCredits(availableCredits, t)}` : ''}`;

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
              alt={t.appTitle}
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

      <form onSubmit={handleSubmit} className="relative">
        <div className="bg-white dark:bg-surface-dark-elevated rounded-2xl shadow-lg shadow-primary-100/50 dark:shadow-primary-900/30 border border-primary-100 dark:border-primary-800/50 overflow-hidden transition-shadow focus-within:shadow-xl focus-within:shadow-primary-200/50 dark:focus-within:shadow-primary-800/40 focus-within:border-primary-200 dark:focus-within:border-primary-700">
          {/* Overlay for guest users: captures clicks/focus on the textarea */}
          {isGuest && (
            <div
              onClick={handleGuestClick}
              className="absolute inset-0 z-10 cursor-pointer"
              title={t.storyInputGuestPlaceholder}
            />
          )}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={isGuest
              ? t.storyInputGuestPlaceholder
              : t.storyInputPlaceholder
            }
            maxLength={maxLength}
            rows={3}
            disabled={isLoading}
            readOnly={isGuest}
            className="w-full px-6 pt-5 pb-2 text-gray-700 dark:text-gray-200 placeholder-gray-400 dark:placeholder-gray-500 bg-transparent resize-none focus:outline-none disabled:opacity-50 text-lg"
          />

          {/* Inspire me button - only for authenticated users */}
          {!isGuest && (
            <div className="px-6 pb-1">
              <button
                type="button"
                onClick={handleIdeaClick}
                disabled={isLoading}
                className="inline-flex items-center gap-1.5 text-sm text-primary-500 dark:text-primary-400 hover:text-primary-600 dark:hover:text-primary-300 disabled:opacity-50 disabled:cursor-not-allowed transition-colors cursor-pointer"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                  <path fillRule="evenodd" d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.625 2.625 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.625 2.625 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5z" clipRule="evenodd" />
                </svg>
                {t.storyIdeaButton}
              </button>
            </div>
          )}

          {/* Age & Style selectors - only for authenticated users */}
          {!isGuest && (
            <div className="px-6 pb-3 space-y-3">
              <div className="grid gap-3 lg:grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] lg:items-center">
                <div className="flex items-center gap-2">
                  <label htmlFor="age-select" className="text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {t.childAge}
                  </label>
                  <select
                    id="age-select"
                    value={age}
                    onChange={(e) => setAge(Number(e.target.value))}
                    disabled={isLoading}
                    className="text-sm bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-primary-300 dark:focus:border-primary-600 disabled:opacity-50 cursor-pointer"
                  >
                    {AGE_RANGES.map(({ value, label }) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center gap-2 min-w-0">
                  <label htmlFor="style-select" className="text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {t.artStyle}
                  </label>
                  <select
                    id="style-select"
                    value={style}
                    onChange={(e) => setStyle(e.target.value as ArtStyleKey)}
                    disabled={isLoading}
                    className="w-full min-w-0 text-sm bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-primary-300 dark:focus:border-primary-600 disabled:opacity-50 cursor-pointer"
                  >
                    {STYLE_KEYS.map((key) => (
                      <option key={key} value={key}>{t[styleTranslationMap[key]]}</option>
                    ))}
                  </select>
                </div>

                {storyMode === 'pro_audio' ? (
                  <div className="flex items-center gap-2 min-w-0 lg:justify-end">
                    <label htmlFor="voice-select" className="text-sm text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {t.narratorVoice}
                    </label>
                    <select
                      id="voice-select"
                      value={voice}
                      onChange={(e) => setVoice(e.target.value as VoiceKey | '')}
                      disabled={isLoading}
                      className="w-full min-w-0 lg:max-w-[220px] text-sm bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-primary-300 dark:focus:border-primary-600 disabled:opacity-50 cursor-pointer"
                    >
                      {VOICE_OPTIONS.map((option) => {
                        const { label } = getVoiceOptionText(option, t);
                        return (
                          <option key={option.key} value={option.key}>
                            {label}
                          </option>
                        );
                      })}
                    </select>
                  </div>
                ) : (
                  <div className="hidden lg:block" />
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {([
                  { key: 'fast', label: t.storyModeFast, detail: formatCredits(1, t) },
                  { key: 'pro', label: t.storyModePro, detail: formatCredits(2, t) },
                  { key: 'pro_audio', label: t.storyModeProAudio, detail: formatCredits(3, t) },
                ] as const).map((option) => (
                  <button
                    key={option.key}
                    type="button"
                    onClick={() => setStoryMode(option.key)}
                    disabled={isLoading}
                    className={`rounded-full border px-3 py-1.5 text-sm font-semibold transition-colors ${
                      storyMode === option.key
                        ? 'border-primary-500 bg-primary-50 text-primary-700 dark:border-primary-400 dark:bg-primary-900/30 dark:text-primary-200'
                        : 'border-gray-200 bg-white text-gray-500 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-300'
                    }`}
                  >
                    {option.label} · {option.detail}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col gap-4 px-6 pb-4 lg:flex-row lg:items-end lg:justify-between">
            {!isGuest ? (
              <div className="flex flex-col gap-2">
                <p className="text-sm text-gray-400 dark:text-gray-500">
                  {creditsSummary}
                </p>
              </div>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={user ? (isLoading || (hasEnoughCredits && !prompt.trim())) : false}
              className="w-full bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 disabled:from-gray-300 disabled:to-gray-300 dark:disabled:from-gray-700 dark:disabled:to-gray-700 text-white font-bold py-2.5 px-8 rounded-xl transition-all disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-[0.98] lg:w-auto lg:min-w-[220px]"
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
    </div>
  );
}
