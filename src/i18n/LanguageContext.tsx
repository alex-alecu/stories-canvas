import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import type { Language, Translations } from './types';
import { translations, languageList } from './translations';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';

const LANGUAGE_STORAGE_KEY = 'stories-canvas:language';
const VALID_LANGUAGES = new Set<string>(Object.keys(translations));

function isValidLanguage(lang: string): lang is Language {
  return VALID_LANGUAGES.has(lang);
}

function detectBrowserLanguage(): Language {
  try {
    const browserLang = navigator.language?.split('-')[0];
    if (browserLang && isValidLanguage(browserLang)) {
      return browserLang;
    }
    // Check navigator.languages for fallback
    for (const lang of navigator.languages ?? []) {
      const code = lang.split('-')[0];
      if (isValidLanguage(code)) {
        return code;
      }
    }
  } catch {
    // Ignore errors in SSR or restricted environments
  }
  return 'en';
}

function getStoredLanguage(): Language | null {
  try {
    const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (stored && isValidLanguage(stored)) {
      return stored;
    }
  } catch {
    // localStorage unavailable
  }
  return null;
}

function storeLanguage(lang: Language): void {
  try {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, lang);
  } catch {
    // localStorage unavailable
  }
}

interface LanguageContextValue {
  language: Language;
  t: Translations;
  setLanguage: (lang: Language) => void;
  languages: typeof languageList;
}

const LanguageContext = createContext<LanguageContextValue | undefined>(undefined);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const { user, session } = useAuth();
  const [language, setLanguageState] = useState<Language>(() => {
    return getStoredLanguage() || detectBrowserLanguage();
  });
  const [loadedFromServer, setLoadedFromServer] = useState(false);

  // On mount / user change, try to load language preference from Supabase
  useEffect(() => {
    if (!user || !session) {
      setLoadedFromServer(false);
      return;
    }

    let cancelled = false;

    async function loadPreference() {
      try {
        const res = await fetch('/api/user/preferences', {
          headers: {
            Authorization: `Bearer ${session!.access_token}`,
          },
        });
        if (res.ok) {
          const data = await res.json();
          if (!cancelled && data.language && isValidLanguage(data.language)) {
            setLanguageState(data.language);
            storeLanguage(data.language);
          }
        }
      } catch {
        // Silently fail - will use localStorage/browser default
      } finally {
        if (!cancelled) setLoadedFromServer(true);
      }
    }

    loadPreference();
    return () => { cancelled = true; };
  }, [user, session]);

  const setLanguage = useCallback(async (lang: Language) => {
    setLanguageState(lang);
    storeLanguage(lang);

    // Persist to Supabase if logged in
    if (session?.access_token) {
      try {
        await fetch('/api/user/preferences', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${session.access_token}`,
          },
          body: JSON.stringify({ language: lang }),
        });
      } catch {
        // Silently fail
      }
    }
  }, [session]);

  const t = translations[language];

  return (
    <LanguageContext.Provider value={{ language, t, setLanguage, languages: languageList }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (!context) {
    throw new Error('useLanguage must be used within a LanguageProvider');
  }
  return context;
}
