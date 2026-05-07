import { useEffect, useState } from 'react';
import {
  getMarketingConsent,
  loadMarketingPixels,
  setMarketingConsent,
} from '../lib/marketing';

export default function MarketingConsentBanner() {
  const [consent, setConsent] = useState(() => getMarketingConsent());

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
    <div className="fixed inset-x-3 bottom-3 z-50 mx-auto max-w-3xl rounded-2xl border border-gray-200 bg-white p-4 shadow-lg dark:border-gray-800 dark:bg-surface-dark-elevated">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-gray-600 dark:text-gray-300">
          <p className="font-semibold text-gray-900 dark:text-gray-100">Marketing cookies</p>
          <p className="mt-1">We use marketing pixels only with your consent to measure purchases and improve ads.</p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => setConsent(setMarketingConsent(false))}
            className="rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-gray-700 dark:border-gray-700 dark:text-gray-200"
          >
            Reject
          </button>
          <button
            type="button"
            onClick={() => setConsent(setMarketingConsent(true))}
            className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white"
          >
            Accept
          </button>
        </div>
      </div>
    </div>
  );
}
