import { useEffect } from 'react';
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
import {
  createMarketingEventId,
  getCheckoutMarketingPayload,
  trackInitiateCheckout,
  trackPurchaseSuccessOnce,
} from '../lib/marketing';
import type { BillingPurchase, StoryPackOffer } from '../types';

function getBannerCopy(
  checkoutState: string | null,
  reason: string | null,
  matchedPurchase: BillingPurchase | undefined,
  t: ReturnType<typeof useLanguage>['t'],
): { tone: string; title: string; body: string } | null {
  if (checkoutState === 'success') {
    if (!matchedPurchase || matchedPurchase.status === 'pending') {
      return {
        tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200',
        title: t.billingBannerPaymentProcessingTitle,
        body: t.billingBannerPaymentProcessingBody,
      };
    }

    if (matchedPurchase.status === 'completed') {
      return {
        tone: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200',
        title: t.billingBannerPaymentConfirmedTitle,
        body: t.billingBannerPaymentConfirmedBody,
      };
    }

    if (matchedPurchase.status === 'failed') {
      return {
        tone: 'border-red-200 bg-red-50 text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200',
        title: t.billingBannerPaymentFailedTitle,
        body: t.billingBannerPaymentFailedBody,
      };
    }

    if (matchedPurchase.status === 'expired') {
      return {
        tone: 'border-gray-200 bg-gray-50 text-gray-700 dark:border-gray-800 dark:bg-surface-dark dark:text-gray-200',
        title: t.billingBannerCheckoutExpiredTitle,
        body: t.billingBannerCheckoutExpiredBody,
      };
    }

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

function getPurchaseStatusTone(status: BillingPurchase['status']): string {
  switch (status) {
    case 'completed':
      return 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300';
    case 'failed':
      return 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300';
    case 'expired':
      return 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300';
    case 'pending':
      return 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300';
  }
}

export default function BillingContent() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [searchParams] = useSearchParams();
  const checkoutState = searchParams.get('checkout');
  const reason = searchParams.get('reason');
  const checkoutSessionId = searchParams.get('session_id');
  const { data: billingOverview, isLoading: overviewLoading } = useBillingOverview(!!user);
  const { data: billingHistory, isLoading: historyLoading, refetch: refetchHistory } = useBillingHistory(!!user);
  const checkout = useCreateCheckoutSession();
  const matchedPurchase = billingHistory?.purchases.find(
    (purchase) => purchase.stripeCheckoutSessionId === checkoutSessionId,
  );

  useEffect(() => {
    if (checkoutState === 'success' && checkoutSessionId && matchedPurchase?.status === 'completed') {
      trackPurchaseSuccessOnce({ checkoutSessionId });
    }
  }, [checkoutState, checkoutSessionId, matchedPurchase?.status]);

  useEffect(() => {
    const shouldPoll = checkoutState === 'success'
      && !!checkoutSessionId
      && (!matchedPurchase || matchedPurchase.status === 'pending');

    if (!shouldPoll) return;

    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      if (Date.now() - startedAt > 60_000) {
        window.clearInterval(interval);
        return;
      }
      void refetchHistory();
    }, 2_000);

    void refetchHistory();
    return () => window.clearInterval(interval);
  }, [checkoutState, checkoutSessionId, matchedPurchase?.status, refetchHistory]);

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

  const banner = getBannerCopy(checkoutState, reason, matchedPurchase, t);
  const historyListClassName = 'mt-4 max-h-96 space-y-3 overflow-y-auto overscroll-contain pr-2';

  const handleCheckout = async (offer: StoryPackOffer) => {
    const eventId = createMarketingEventId('checkout');
    trackInitiateCheckout({
      eventId,
      offer,
      value: offer.priceMinor / 100,
      currency: offer.currency,
    });

    const result = await checkout.mutateAsync({
      offerSlug: offer.slug,
      ...getCheckoutMarketingPayload(eventId),
    });
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
            <p className="mt-1 text-3xl font-extrabold">{formatCredits(billingOverview.balance.availableCredits, t)}</p>
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
                      {formatLocalizedPrice(offer.priceMinor, language, offer.currency)}
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
                      <div className="flex flex-col items-end gap-1">
                        <span className="text-sm font-semibold text-primary-600 dark:text-primary-300">
                          {formatLocalizedPrice(purchase.amountMinor, language, purchase.currency)}
                        </span>
                        <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${getPurchaseStatusTone(purchase.status)}`}>
                          {getPurchaseStatusLabel(purchase.status, t)}
                        </span>
                      </div>
                    </div>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {formatCredits(purchase.creditsGranted, t)}
                    </p>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">
                      {formatLocalizedDate(purchase.fulfilledAt ?? purchase.updatedAt ?? purchase.createdAt, language, t.billingPending)}
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
                      {entry.delta >= 0 ? '+' : '-'}{formatCredits(Math.abs(entry.delta), t)}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{t.billingBalanceAfter}: {formatCredits(entry.balanceAfter, t)}</p>
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
