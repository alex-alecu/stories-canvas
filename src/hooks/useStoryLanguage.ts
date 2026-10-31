import { useLanguage } from '../i18n/LanguageContext';
import { clientSiteConfig } from '../lib/siteConfig';
import { resolveStoryLanguage } from '../lib/storyLanguage';

export function useStoryLanguage() {
  const { language } = useLanguage();
  return resolveStoryLanguage(language, clientSiteConfig.defaultLanguage);
}
