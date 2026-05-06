import { Link, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  useBillingHistory,
  useBillingOverview,
  useCreateCheckoutSession,
} from '../hooks/useBilling';
import { useLanguage } from '../i18n/LanguageContext';
import {
  formatCredits,
  formatLocalizedDate,
  formatLocalizedPrice,
  getLedgerReasonLabel,
  getOfferCopy,
  getPurchaseStatusLabel,
} from '../i18n/billingCopy';
import type { StoryPackOffer } from '../types';

function getBannerCopy(
  checkoutState: string | null,
  reason: string | null,
  t: ReturnType<typeof useLanguage>['t'],
): { tone: string; title: string; body: string } | null {
  if (checkoutState === 'success') {
    return {
      tone: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200',
      title: t.billingBannerCheckoutCompletedTitle,
      body: t.billingBannerCheckoutCompletedBody,
    };
  }

  if (checkoutState === 'cancelled') {
    return {
      tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200',
      title: t.billingBannerCheckoutCancelledTitle,
      body: t.billingBannerCheckoutCancelledBody,
    };
  }

  if (reason === 'insufficient-credits') {
    return {
      tone: 'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-900/40 dark:bg-primary-950/30 dark:text-primary-200',
      title: t.billingBannerMoreCreditsTitle,
      body: t.billingBannerMoreCreditsBody,
    };
  }

  return null;
}

export default function BillingContent() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [searchParams] = useSearchParams();
  const checkoutState = searchParams.get('checkout');
  const reason = searchParams.get('reason');
  const { data: billingOverview, isLoading: overviewLoading } = useBillingOverview(!!user);
  const { data: billingHistory, isLoading: historyLoading } = useBillingHistory(!!user);
  const checkout = useCreateCheckoutSession();

  if (overviewLoading || historyLoading) {
    return (
      <div className="rounded-3xl border border-primary-100 bg-white p-8 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
        <div className="mx-auto h-12 w-12 rounded-full border-4 border-primary-300 border-t-primary-600 dark:border-primary-700 dark:border-t-primary-400 animate-spin" />
      </div>
    );
  }

  if (!user || !billingOverview) {
    return null;
  }

  const banner = getBannerCopy(checkoutState, reason, t);
  const historyListClassName = 'mt-4 max-h-96 space-y-3 overflow-y-auto overscroll-contain pr-2';

  const handleCheckout = async (offer: StoryPackOffer) => {
    const result = await checkout.mutateAsync({ offerSlug: offer.slug });
    window.location.assign(result.checkoutUrl);
  };

  return (
    <div className="space-y-8">
      <section className="rounded-3xl border border-primary-100 bg-white p-6 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.22em] text-primary-500">{t.billingLabel}</p>
            <h2 className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">{t.billingTitle}</h2>
            <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
              {t.billingDescription}
            </p>
          </div>
          <div className="rounded-2xl bg-primary-50 px-5 py-4 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200">
            <p className="text-xs uppercase tracking-[0.2em]">{t.availableCredits}</p>
            <p className="mt-1 text-3xl font-extrabold">{billingOverview.balance.availableCredits}</p>
          </div>
        </div>
      </section>

      {banner && (
        <section className={`rounded-2xl border p-4 ${banner.tone}`}>
          <h3 className="text-sm font-bold uppercase tracking-[0.18em]">{banner.title}</h3>
          <p className="mt-1 text-sm">{banner.body}</p>
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
        <div className="rounded-3xl border border-primary-100 bg-white p-6 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t.billingStoryPacksTitle}</h3>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {t.billingStoryPacksDescription}
              </p>
            </div>
            {checkout.isPending && (
              <span className="text-sm text-primary-600 dark:text-primary-300">{t.billingRedirectingToStripe}</span>
            )}
          </div>

          <div className="mt-6 grid gap-4 md:grid-cols-3">
            {billingOverview.offers.map((offer) => {
              const offerCopy = getOfferCopy(offer, t);
              return (
                <div
                  key={offer.slug}
                  className="rounded-2xl border border-gray-100 bg-gray-50 p-5 dark:border-gray-800 dark:bg-surface-dark"
                >
                  <div className="flex flex-col gap-3 min-w-0">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{offerCopy.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-primary-500">{formatCredits(offer.credits, t)}</p>
                    </div>
                    <p className="text-2xl font-extrabold leading-none text-gray-900 break-words dark:text-gray-100">
                      {formatLocalizedPrice(offer.priceMinor, language)}
                    </p>
                  </div>
                  <p className="mt-3 min-h-16 text-sm text-gray-500 dark:text-gray-400">{offerCopy.description}</p>
                  <button
                    type="button"
                    disabled={!offer.isActive || checkout.isPending}
                    onClick={() => handleCheckout(offer)}
                    className="mt-4 w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {offer.isActive ? t.billingBuyPack : t.billingUnavailable}
                  </button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-3xl border border-primary-100 bg-white p-6 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t.billingCreationModesTitle}</h3>
          <div className="mt-4 space-y-3">
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-surface-dark">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.storyModeFast}</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t.storyModeFastSummary}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-surface-dark">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.storyModePro}</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t.storyModeProSummary}</p>
            </div>
            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-surface-dark">
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.storyModeProAudio}</p>
              <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t.storyModeProAudioSummary}</p>
            </div>
          </div>

          <Link
            to="/"
            className="mt-6 inline-flex rounded-xl border border-primary-200 px-4 py-2 text-sm font-semibold text-primary-700 dark:border-primary-800 dark:text-primary-200"
          >
            {t.createAStory}
          </Link>
        </div>
      </section>

      <section className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-3xl border border-primary-100 bg-white p-6 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t.billingPurchasesTitle}</h3>
          <div className={historyListClassName}>
            {(billingHistory?.purchases ?? []).length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t.billingNoPurchases}</p>
            ) : (
              billingHistory?.purchases.map((purchase) => {
                const offer = billingOverview.offers.find((item) => item.slug === purchase.offerSlug);
                const offerName = offer ? getOfferCopy(offer, t).name : purchase.offerSlug;
                return (
                  <div key={purchase.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-surface-dark">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{offerName}</p>
                      <span className="text-sm font-semibold text-primary-600 dark:text-primary-300">
                        {formatLocalizedPrice(purchase.amountMinor, language)}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {formatCredits(purchase.creditsGranted, t)} · {getPurchaseStatusLabel(purchase.status, t)}
                    </p>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      {formatLocalizedDate(purchase.fulfilledAt ?? purchase.createdAt, language, t.billingPending)}
                    </p>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <div className="rounded-3xl border border-primary-100 bg-white p-6 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
          <h3 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t.billingCreditHistoryTitle}</h3>
          <div className={historyListClassName}>
            {(billingHistory?.ledger ?? []).length === 0 ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t.billingNoCreditActivity}</p>
            ) : (
              billingHistory?.ledger.map((entry) => (
                <div key={entry.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-surface-dark">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{getLedgerReasonLabel(entry.reason, t)}</p>
                    <span className={`text-sm font-semibold ${entry.delta >= 0 ? 'text-green-600 dark:text-green-300' : 'text-red-600 dark:text-red-300'}`}>
                      {entry.delta >= 0 ? '+' : ''}{entry.delta}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t.billingBalanceAfter}: {entry.balanceAfter}</p>
                  {entry.note && (
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{entry.note}</p>
                  )}
                  <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                    {formatLocalizedDate(entry.createdAt, language, t.billingPending)}
                  </p>
                </div>
              ))
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
