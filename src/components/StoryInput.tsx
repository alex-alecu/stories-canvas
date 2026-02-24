import { useState, type FormEvent } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../i18n/LanguageContext';

interface StoryInputProps {
  onSubmit: (prompt: string) => void;
  isLoading: boolean;
}

export default function StoryInput({ onSubmit, isLoading }: StoryInputProps) {
  const [prompt, setPrompt] = useState('');
  const maxLength = 500;
  const { user, loading } = useAuth();
  const { t } = useLanguage();
  const navigate = useNavigate();
  const location = useLocation();

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
      onSubmit(trimmed);
      setPrompt('');
    }
  };

  return (
    <div className="w-full max-w-2xl mx-auto">
      <div className="text-center mb-8">
        <h1 className="text-4xl md:text-5xl font-extrabold bg-gradient-to-r from-primary-600 via-primary-500 to-warm-500 bg-clip-text text-transparent mb-3">
          {t.appTitle}
        </h1>
        <p className="text-gray-500 text-lg">
          {t.appSubtitle}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="relative">
        <div className="bg-white rounded-2xl shadow-lg shadow-primary-100/50 border border-primary-100 overflow-hidden transition-shadow focus-within:shadow-xl focus-within:shadow-primary-200/50 focus-within:border-primary-200">
          {/* Overlay for guest users: captures clicks/focus on the textarea */}
          {!loading && !user && (
            <div
              onClick={handleGuestClick}
              className="absolute inset-0 z-10 cursor-pointer"
              title={t.storyInputGuestPlaceholder}
            />
          )}
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder={!loading && !user
              ? t.storyInputGuestPlaceholder
              : t.storyInputPlaceholder
            }
            maxLength={maxLength}
            rows={3}
            disabled={isLoading}
            readOnly={!loading && !user}
            className="w-full px-6 pt-5 pb-2 text-gray-700 placeholder-gray-400 resize-none focus:outline-none disabled:opacity-50 text-lg"
          />
          <div className="flex items-center justify-between px-6 pb-4">
            <span className={`text-sm ${prompt.length > maxLength * 0.9 ? 'text-red-400' : 'text-gray-300'}`}>
              {prompt.length}/{maxLength}
            </span>
            <button
              type="submit"
              disabled={user ? (!prompt.trim() || isLoading) : false}
              className="bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 disabled:from-gray-300 disabled:to-gray-300 text-white font-bold py-2.5 px-8 rounded-xl transition-all disabled:cursor-not-allowed transform hover:scale-[1.02] active:scale-[0.98]"
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
