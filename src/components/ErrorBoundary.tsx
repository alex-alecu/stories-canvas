import { Component, type ReactNode, type ErrorInfo } from 'react';
import { translations } from '../i18n/translations';
import type { Language, Translations } from '../i18n/types';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function getErrorTranslations(): Translations {
  try {
    const stored = localStorage.getItem('stories-canvas:language');
    if (stored && stored in translations) {
      return translations[stored as Language];
    }
  } catch {
    // localStorage unavailable
  }
  return translations.en;
}

function isDarkMode(): boolean {
  try {
    const theme = localStorage.getItem('stories-canvas:theme') || 'system';
    if (theme === 'dark') return true;
    if (theme === 'light') return false;
    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false;
  } catch {
    return false;
  }
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('ErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      const t = getErrorTranslations();
      const dark = isDarkMode();
      return (
        <div className={`min-h-screen flex items-center justify-center p-4 ${
          dark
            ? 'bg-gradient-to-br from-[#0f0a1a] via-[#120e24] to-[#0f0a1a]'
            : 'bg-gradient-to-br from-primary-50 via-warm-50 to-primary-100'
        }`}>
          <div className={`rounded-2xl shadow-xl p-8 max-w-md w-full text-center ${
            dark ? 'bg-surface-dark-elevated' : 'bg-white'
          }`}>
            <div className="text-5xl mb-4">oops!</div>
            <h1 className={`text-2xl font-bold mb-2 ${dark ? 'text-gray-100' : 'text-gray-800'}`}>
              {t.somethingWentWrong}
            </h1>
            <p className={`mb-6 ${dark ? 'text-gray-400' : 'text-gray-600'}`}>
              {this.state.error?.message || t.unexpectedError}
            </p>
            <button
              onClick={() => {
                this.setState({ hasError: false, error: null });
                window.location.href = '/';
              }}
              className="bg-primary-500 hover:bg-primary-600 text-white font-bold py-3 px-6 rounded-xl transition-colors"
            >
              {t.home}
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
