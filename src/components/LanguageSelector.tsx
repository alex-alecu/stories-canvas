import { useLanguage } from '../i18n/LanguageContext';
import type { Language } from '../i18n/types';

export default function LanguageSelector() {
  const { language, setLanguage, languages } = useLanguage();

  return (
    <select
      value={language}
      onChange={(e) => setLanguage(e.target.value as Language)}
      className="text-sm font-medium text-gray-600 dark:text-gray-300 bg-transparent border border-gray-200 dark:border-gray-700 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-primary-400 focus:border-transparent cursor-pointer hover:border-gray-300 dark:hover:border-gray-600 transition-colors"
      aria-label="Language"
    >
      {languages.map((lang) => (
        <option key={lang.code} value={lang.code} className="bg-white dark:bg-surface-dark-elevated dark:text-gray-200">
          {lang.name}
        </option>
      ))}
    </select>
  );
}
