import type { Language } from '../i18n/types';

const CLIENT_DEFAULT_LANGUAGE = 'ro' satisfies Language;
type SiteLanguage = Extract<Language, 'ro' | 'en'>;
const VALID_SITE_LANGUAGES = new Set<SiteLanguage>(['ro', 'en']);

const SITE_COPY: Record<'ro' | 'en', { name: string; shortName: string; description: string }> = {
  ro: {
    name: 'Povești Magice',
    shortName: 'Povești Magice',
    description: 'Creează povești ilustrate personalizate pentru copii, cu imagini, narațiune și povești publice de explorat.',
  },
  en: {
    name: 'Magic Stories',
    shortName: 'Magic Stories',
    description: 'Create personalized illustrated stories for children with images, narration, and public stories to explore.',
  },
};

function compactValue(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed || undefined;
}

export function resolveClientDefaultLanguage(): Language {
  const configuredLanguage = (
    compactValue(import.meta.env.VITE_APP_DEFAULT_LANGUAGE)
    ?? compactValue(import.meta.env.VITE_DEFAULT_LANGUAGE)
  )?.toLowerCase();

  if (configuredLanguage && VALID_SITE_LANGUAGES.has(configuredLanguage as SiteLanguage)) {
    return configuredLanguage as Language;
  }
  return CLIENT_DEFAULT_LANGUAGE;
}

const defaultLanguage = resolveClientDefaultLanguage();
const defaultSiteCopy = defaultLanguage === 'ro' ? SITE_COPY.ro : SITE_COPY.en;

export const clientSiteConfig = {
  defaultLanguage,
  siteName: compactValue(import.meta.env.VITE_APP_SITE_NAME) ?? defaultSiteCopy.name,
  siteShortName: compactValue(import.meta.env.VITE_APP_SITE_SHORT_NAME)
    ?? compactValue(import.meta.env.VITE_APP_SITE_NAME)
    ?? defaultSiteCopy.shortName,
  siteDescription: compactValue(import.meta.env.VITE_APP_SITE_DESCRIPTION) ?? defaultSiteCopy.description,
} as const;
