import { useEffect } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  useBillingHistory,
  useBillingOverview,
  useCreateCheckoutSession,
} from '../hooks/useBilling';
import type { StoryPackOffer } from '../types';

function formatPrice(priceMinor: number): string {
  return new Intl.NumberFormat('ro-RO', {
    style: 'currency',
    currency: 'RON',
  }).format(priceMinor / 100);
}

function formatDate(value: string | undefined): string {
  if (!value) return 'Pending';
  return new Date(value).toLocaleString('ro-RO');
}

function getBannerCopy(checkoutState: string | null, reason: string | null): { tone: string; title: string; body: string } | null {
  if (checkoutState === 'success') {
    return {
      tone: 'border-green-200 bg-green-50 text-green-700 dark:border-green-900/40 dark:bg-green-950/30 dark:text-green-200',
      title: 'Checkout completed',
      body: 'Your payment was accepted. Credits usually appear within a few seconds after the Stripe webhook is processed.',
    };
  }

  if (checkoutState === 'cancelled') {
    return {
      tone: 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-900/40 dark:bg-amber-950/30 dark:text-amber-200',
      title: 'Checkout cancelled',
      body: 'No credits were charged. You can restart the purchase whenever you are ready.',
    };
  }

  if (reason === 'insufficient-credits') {
    return {
      tone: 'border-primary-200 bg-primary-50 text-primary-700 dark:border-primary-900/40 dark:bg-primary-950/30 dark:text-primary-200',
      title: 'More credits needed',
      body: 'Buy a story pack to create more stories. Reading public stories remains free.',
    };
  }

  return null;
}

export default function Billing() {
  const { user, loading } = useAuth();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const checkoutState = searchParams.get('checkout');
  const reason = searchParams.get('reason');
  const { data: billingOverview, isLoading: overviewLoading } = useBillingOverview(!!user);
  const { data: billingHistory, isLoading: historyLoading } = useBillingHistory(!!user);
  const checkout = useCreateCheckoutSession();

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login?returnTo=/billing', { replace: true });
    }
  }, [loading, navigate, user]);

  if (loading || overviewLoading || historyLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-primary-300 dark:border-primary-700 border-t-primary-600 dark:border-t-primary-400 animate-spin" />
      </div>
    );
  }

  if (!user || !billingOverview) {
    return null;
  }

  const banner = getBannerCopy(checkoutState, reason);

  const handleCheckout = async (offer: StoryPackOffer) => {
    const result = await checkout.mutateAsync({ offerSlug: offer.slug });
    window.location.assign(result.checkoutUrl);
  };

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-6xl space-y-8">
        <section className="rounded-3xl border border-primary-100 bg-white p-6 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
          <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.22em] text-primary-500">Billing</p>
              <h1 className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">Story credits</h1>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                Public reading stays free. Credits are only used when you generate a new story.
              </p>
            </div>
            <div className="rounded-2xl bg-primary-50 px-5 py-4 text-primary-700 dark:bg-primary-900/30 dark:text-primary-200">
              <p className="text-xs uppercase tracking-[0.2em]">Available credits</p>
              <p className="mt-1 text-3xl font-extrabold">{billingOverview.balance.availableCredits}</p>
            </div>
          </div>
        </section>

        {banner && (
          <section className={`rounded-2xl border p-4 ${banner.tone}`}>
            <h2 className="text-sm font-bold uppercase tracking-[0.18em]">{banner.title}</h2>
            <p className="mt-1 text-sm">{banner.body}</p>
          </section>
        )}

        <section className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <div className="rounded-3xl border border-primary-100 bg-white p-6 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Story packs</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Each pack adds non-expiring credits to your account.
                </p>
              </div>
              {checkout.isPending && (
                <span className="text-sm text-primary-600 dark:text-primary-300">Redirecting to Stripe...</span>
              )}
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-3">
              {billingOverview.offers.map((offer) => (
                <div
                  key={offer.slug}
                  className="rounded-2xl border border-gray-100 bg-gray-50 p-5 dark:border-gray-800 dark:bg-surface-dark"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{offer.name}</p>
                      <p className="mt-1 text-xs uppercase tracking-[0.18em] text-primary-500">{offer.credits} credits</p>
                    </div>
                    <p className="text-lg font-extrabold text-gray-900 dark:text-gray-100">{formatPrice(offer.priceMinor)}</p>
                  </div>
                  <p className="mt-3 min-h-16 text-sm text-gray-500 dark:text-gray-400">{offer.description}</p>
                  <button
                    type="button"
                    disabled={!offer.isActive || checkout.isPending}
                    onClick={() => handleCheckout(offer)}
                    className="mt-4 w-full rounded-xl bg-primary-600 px-4 py-2.5 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {offer.isActive ? 'Buy pack' : 'Unavailable'}
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-primary-100 bg-white p-6 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Creation modes</h2>
            <div className="mt-4 space-y-3">
              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-surface-dark">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Fast</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">1 credit · fast generation · no audio</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-surface-dark">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Pro</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">2 credits · pro story quality · no audio</p>
              </div>
              <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-surface-dark">
                <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">Pro + Audio</p>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">3 credits · pro story quality · narration included</p>
              </div>
            </div>

            <Link
              to="/"
              className="mt-6 inline-flex rounded-xl border border-primary-200 px-4 py-2 text-sm font-semibold text-primary-700 dark:border-primary-800 dark:text-primary-200"
            >
              Create a story
            </Link>
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div className="rounded-3xl border border-primary-100 bg-white p-6 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Purchases</h2>
            <div className="mt-4 space-y-3">
              {(billingHistory?.purchases ?? []).length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No purchases yet.</p>
              ) : (
                billingHistory?.purchases.map((purchase) => (
                  <div key={purchase.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-surface-dark">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{purchase.offerSlug}</p>
                      <span className="text-sm font-semibold text-primary-600 dark:text-primary-300">{formatPrice(purchase.amountMinor)}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                      {purchase.creditsGranted} credits · {purchase.status}
                    </p>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{formatDate(purchase.fulfilledAt ?? purchase.createdAt)}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-primary-100 bg-white p-6 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Credit history</h2>
            <div className="mt-4 space-y-3">
              {(billingHistory?.ledger ?? []).length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">No credit activity yet.</p>
              ) : (
                billingHistory?.ledger.map((entry) => (
                  <div key={entry.id} className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-surface-dark">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{entry.reason}</p>
                      <span className={`text-sm font-semibold ${entry.delta >= 0 ? 'text-green-600 dark:text-green-300' : 'text-red-600 dark:text-red-300'}`}>
                        {entry.delta >= 0 ? '+' : ''}{entry.delta}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Balance after: {entry.balanceAfter}</p>
                    {entry.note && (
                      <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{entry.note}</p>
                    )}
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{formatDate(entry.createdAt)}</p>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
