import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../i18n/LanguageContext';
import LanguageSelector from './LanguageSelector';
import ThemeToggle from './ThemeToggle';

export default function Header() {
  const { user, loading, signOut } = useAuth();
  const { t } = useLanguage();

  return (
    <header className="w-full border-b border-primary-100 dark:border-primary-900/50 bg-white/70 dark:bg-surface-dark/70 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-4 md:px-8 h-14 flex items-center justify-between">
        <Link
          to="/"
          className="text-lg font-extrabold bg-gradient-to-r from-primary-600 to-primary-500 dark:from-primary-400 dark:to-primary-300 bg-clip-text text-transparent hover:opacity-80 transition-opacity"
        >
          {t.appTitle}
        </Link>

        <nav className="flex items-center gap-3">
          <ThemeToggle />
          <LanguageSelector />
          <Link
            to="/explore"
            className="text-sm font-bold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
          >
            {t.explore}
          </Link>
          {loading ? (
            <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-surface-dark-accent animate-pulse" />
          ) : user ? (
            <>
              <Link
                to="/profile"
                className="flex items-center gap-2 hover:opacity-80 transition-opacity"
              >
                {user.user_metadata?.avatar_url ? (
                  <img
                    src={user.user_metadata.avatar_url}
                    alt={user.user_metadata?.full_name || t.profile}
                    className="w-8 h-8 rounded-full border-2 border-primary-200 dark:border-primary-700"
                    referrerPolicy="no-referrer"
                  />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-400 to-primary-600 flex items-center justify-center text-white text-sm font-bold">
                    {(user.user_metadata?.full_name || user.email || 'U').charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200 hidden sm:inline">
                  {user.user_metadata?.full_name || user.email || t.profile}
                </span>
              </Link>
              <button
                onClick={signOut}
                className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 font-medium transition-colors ml-2"
              >
                {t.logout}
              </button>
            </>
          ) : (
            <Link
              to="/login"
              className="text-sm font-bold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 transition-colors"
            >
              {t.login}
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
