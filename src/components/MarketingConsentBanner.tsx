import { useEffect, useState } from 'react';
import {
  getMarketingConsent,
  loadMarketingPixels,
  setMarketingConsent,
} from '../lib/marketing';
import { useLanguage } from '../i18n/LanguageContext';

export default function MarketingConsentBanner() {
  const [consent, setConsent] = useState(() => getMarketingConsent());
  const { t } = useLanguage();

  useEffect(() => {
    if (consent?.marketing) {
      loadMarketingPixels();
    }

    const onConsentChanged = () => setConsent(getMarketingConsent());
    window.addEventListener('marketing-consent-changed', onConsentChanged);
    return () => window.removeEventListener('marketing-consent-changed', onConsentChanged);
  }, [consent?.marketing]);

  if (consent) {
    return null;
  }

  return (
    <div className="fixed bottom-3 left-1/2 z-50 w-[calc(100vw-1.5rem)] max-w-md -translate-x-1/2 rounded-2xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-800 dark:bg-surface-dark-elevated md:left-auto md:right-4 md:w-[28rem] md:max-w-[calc(100vw-2rem)] md:translate-x-0">
      <div className="flex flex-col gap-3">
        <div className="text-sm text-gray-600 dark:text-gray-300">
          <p className="font-semibold text-gray-900 dark:text-gray-100">{t.marketingConsentTitle}</p>
          <p className="mt-1">{t.marketingConsentBody}</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            onClick={() => setConsent(setMarketingConsent(false))}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
          >
            {t.marketingConsentReject}
          </button>
          <button
            type="button"
            onClick={() => setConsent(setMarketingConsent(true))}
            className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white"
          >
            {t.marketingConsentAccept}
          </button>
        </div>
      </div>
    </div>
  );
}
