import { useState, useEffect, useRef, useCallback } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../i18n/LanguageContext';
import LanguageSelector from './LanguageSelector';
import ThemeToggle from './ThemeToggle';
import FontSizeControl from './FontSizeControl';

export default function Header() {
  const { user, loading, signOut } = useAuth();
  const { t } = useLanguage();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Close menu on route change
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Close menu on Escape key
  useEffect(() => {
    if (!menuOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [menuOpen]);

  // Close menu on outside click
  useEffect(() => {
    if (!menuOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        buttonRef.current && !buttonRef.current.contains(e.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [menuOpen]);

  // Prevent body scroll when menu is open
  useEffect(() => {
    if (menuOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [menuOpen]);

  const toggleMenu = useCallback(() => setMenuOpen(prev => !prev), []);

  return (
    <header className="w-full border-b border-primary-100 dark:border-primary-900/50 bg-white/70 dark:bg-surface-dark/70 backdrop-blur-sm relative z-40">
      <div className="max-w-6xl mx-auto px-4 md:px-8 h-14 flex items-center justify-between">
        {/* Logo — always visible */}
        <Link
          to="/"
          className="text-lg font-extrabold bg-gradient-to-r from-primary-600 to-primary-500 dark:from-primary-400 dark:to-primary-300 bg-clip-text text-transparent hover:opacity-80 transition-opacity"
        >
          {t.appTitle}
        </Link>

        {/* Desktop nav — hidden on mobile */}
        <nav className="hidden md:flex items-center gap-3">
          <ThemeToggle />
          <FontSizeControl />
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
                <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
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

        {/* Mobile hamburger button — visible only on mobile */}
        <button
          ref={buttonRef}
          onClick={toggleMenu}
          className="md:hidden flex items-center justify-center w-10 h-10 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-surface-dark-accent transition-colors"
          aria-label={t.menu}
          aria-expanded={menuOpen}
        >
          {/* Animated hamburger → X icon */}
          <div className="relative w-5 h-4 flex flex-col justify-between">
            <span className={`block h-0.5 w-5 bg-current rounded-full transition-all duration-300 origin-center ${menuOpen ? 'translate-y-[7px] rotate-45' : ''}`} />
            <span className={`block h-0.5 w-5 bg-current rounded-full transition-all duration-300 ${menuOpen ? 'opacity-0 scale-x-0' : ''}`} />
            <span className={`block h-0.5 w-5 bg-current rounded-full transition-all duration-300 origin-center ${menuOpen ? '-translate-y-[7px] -rotate-45' : ''}`} />
          </div>
        </button>
      </div>

      {/* Mobile menu backdrop */}
      <div
        className={`fixed inset-0 top-14 bg-black/30 backdrop-blur-[2px] md:hidden transition-opacity duration-300 ${
          menuOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden="true"
      />

      {/* Mobile menu panel */}
      <div
        ref={menuRef}
        className={`absolute left-0 right-0 top-full md:hidden bg-white dark:bg-surface-dark border-b border-primary-100 dark:border-primary-900/50 shadow-lg transition-all duration-300 origin-top ${
          menuOpen
            ? 'opacity-100 scale-y-100 translate-y-0'
            : 'opacity-0 scale-y-95 -translate-y-2 pointer-events-none'
        }`}
        role="menu"
      >
        <nav className="max-w-6xl mx-auto px-4 py-4 flex flex-col gap-1">
          {/* Explore link */}
          <Link
            to="/explore"
            className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-bold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-surface-dark-accent transition-colors"
            role="menuitem"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            {t.explore}
          </Link>

          {/* Profile / Auth section */}
          {loading ? (
            <div className="flex items-center gap-3 px-3 py-3">
              <div className="w-8 h-8 rounded-full bg-gray-100 dark:bg-surface-dark-accent animate-pulse" />
              <div className="w-24 h-4 bg-gray-100 dark:bg-surface-dark-accent animate-pulse rounded" />
            </div>
          ) : user ? (
            <Link
              to="/profile"
              className="flex items-center gap-3 px-3 py-3 rounded-lg hover:bg-primary-50 dark:hover:bg-surface-dark-accent transition-colors"
              role="menuitem"
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
              <span className="text-sm font-medium text-gray-700 dark:text-gray-200">
                {user.user_metadata?.full_name || user.email || t.profile}
              </span>
            </Link>
          ) : (
            <Link
              to="/login"
              className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-bold text-primary-600 dark:text-primary-400 hover:bg-primary-50 dark:hover:bg-surface-dark-accent transition-colors"
              role="menuitem"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
              </svg>
              {t.login}
            </Link>
          )}

          {/* Divider */}
          <div className="border-t border-gray-100 dark:border-primary-900/30 my-1" />

          {/* Settings section */}
          <div className="px-3 py-3 flex flex-col gap-4">
            {/* Theme */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                {t.language}
              </span>
              <LanguageSelector />
            </div>

            {/* Theme toggle */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                {t.theme}
              </span>
              <ThemeToggle />
            </div>

            {/* Font size */}
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                {t.fontSize}
              </span>
              <FontSizeControl />
            </div>
          </div>

          {/* Sign out button at the bottom */}
          {user && (
            <>
              <div className="border-t border-gray-100 dark:border-primary-900/30 my-1" />
              <button
                onClick={() => {
                  signOut();
                  setMenuOpen(false);
                }}
                className="flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-50 dark:hover:bg-surface-dark-accent transition-colors w-full text-left"
                role="menuitem"
              >
                <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                </svg>
                {t.logout}
              </button>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
