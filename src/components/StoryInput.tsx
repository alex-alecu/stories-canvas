import { useState, useEffect, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../i18n/LanguageContext';
import { AGE_RANGES, DEFAULT_AGE, DEFAULT_ART_STYLE, getAgeGroup, type ArtStyleKey } from '../../shared/types';

const STYLE_KEYS: ArtStyleKey[] = ['disney-pixar', 'watercolor', 'storybook', 'anime', 'colored-pencil', 'paper-cutout'];

const styleTranslationMap: Record<ArtStyleKey, keyof ReturnType<typeof useLanguage>['t']> = {
  'disney-pixar': 'styleDisneyPixar',
  'watercolor': 'styleWatercolor',
  'storybook': 'styleStorybook',
  'anime': 'styleAnime',
  'colored-pencil': 'styleColoredPencil',
  'paper-cutout': 'stylePaperCutout',
};

interface StoryInputProps {
  onSubmit: (prompt: string, age: number, style: ArtStyleKey, pro: boolean) => void;
  isLoading: boolean;
}

export default function StoryInput({ onSubmit, isLoading }: StoryInputProps) {
  const [prompt, setPrompt] = useState('');
  const [age, setAge] = useState<number>(DEFAULT_AGE);
  const [style, setStyle] = useState<ArtStyleKey>(DEFAULT_ART_STYLE);
  const [pro, setPro] = useState(false);
  const maxLength = 500;
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

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
    const trimmed = prompt.trim();
    if (trimmed && !isLoading) {
      onSubmit(trimmed, age, style, pro);
      setPrompt('');
    }
  };

  const isGuest = !loading && !user;

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-extrabold bg-gradient-to-r from-primary-600 via-primary-500 to-warm-500 dark:from-primary-400 dark:via-primary-300 dark:to-warm-400 bg-clip-text text-transparent mb-3">
          {t.appTitle}
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

          {/* Age & Style selectors - only for authenticated users */}
          {!isGuest && (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-6 pb-3">
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
                  className="text-sm bg-gray-50 dark:bg-surface-dark border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1.5 text-gray-700 dark:text-gray-300 focus:outline-none focus:border-primary-300 dark:focus:border-primary-600 disabled:opacity-50 cursor-pointer min-w-0"
                >
                  {STYLE_KEYS.map((key) => (
                    <option key={key} value={key}>{t[styleTranslationMap[key]]}</option>
                  ))}
                </select>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between px-6 pb-4">
            {!isGuest ? (
              <div className="flex items-center gap-2 select-none">
                <span className="text-sm text-gray-400 dark:text-gray-500">Pro</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={pro}
                  aria-label="Pro"
                  onClick={() => setPro(!pro)}
                  disabled={isLoading}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 cursor-pointer ${
                    pro
                      ? 'bg-gradient-to-r from-primary-500 to-primary-600'
                      : 'bg-gray-200 dark:bg-gray-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform ${
                      pro ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            ) : (
              <span />
            )}
            <button
              type="submit"
              disabled={user ? (!prompt.trim() || isLoading) : false}
              className="bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 disabled:from-gray-300 disabled:to-gray-300 dark:disabled:from-gray-700 dark:disabled:to-gray-700 text-white font-bold py-2.5 px-8 rounded-xl transition-all disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-[0.98]"
            >
              {isLoading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  {t.creating}
                </span>
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
