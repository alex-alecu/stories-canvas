import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminShell } from '../components/admin/AdminShell';
import { useAuth } from '../contexts/AuthContext';
import { useAdminOverview, useBillingOverview, useRefreshModelPrices, useUpdateStoryPackOffer } from '../hooks/useBilling';
import { useLanguage } from '../i18n/LanguageContext';
import {
  formatCredits,
  formatLocalizedDate,
  formatLocalizedPrice,
  getWebhookStatusLabel,
} from '../i18n/billingCopy';
import type { ModelPriceCatalogEntry, StoryPackOffer } from '../types';
import { formatRate } from '../components/admin/adminFormatting';

function OfferEditor({
  offer,
  onSave,
  isSaving,
}: {
  offer: StoryPackOffer;
  onSave: (payload: {
    slug: StoryPackOffer['slug'];
    name: string;
    description: string;
    priceMinor: number;
    isActive: boolean;
  }) => Promise<void>;
  isSaving: boolean;
}) {
  const { t, language } = useLanguage();
  const [name, setName] = useState(offer.name);
  const [description, setDescription] = useState(offer.description);
  const [price, setPrice] = useState(String((offer.priceMinor / 100).toFixed(2)));
  const [isActive, setIsActive] = useState(offer.isActive);

  useEffect(() => {
    setName(offer.name);
    setDescription(offer.description);
    setPrice((offer.priceMinor / 100).toFixed(2));
    setIsActive(offer.isActive);
  }, [offer]);

  const dirty = name !== offer.name
    || description !== offer.description
    || isActive !== offer.isActive
    || Number(price) !== offer.priceMinor / 100;

  return (
    <div className="rounded-2xl border border-primary-100 bg-white p-5 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-gray-400 dark:text-gray-500">{offer.slug}</p>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{formatCredits(offer.credits, t)}</h3>
        </div>
        <span className="rounded-full bg-primary-50 px-3 py-1 text-xs font-semibold text-primary-600 dark:bg-primary-900/30 dark:text-primary-300">
          {formatLocalizedPrice(offer.priceMinor, language, offer.currency)}
        </span>
      </div>
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{t.adminOfferNameLabel}</span>
          <input value={name} onChange={event => setName(event.target.value)} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100" />
        </label>
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{t.adminOfferDescriptionLabel}</span>
          <textarea value={description} onChange={event => setDescription(event.target.value)} rows={3} className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100" />
        </label>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">Price ({offer.currency.toUpperCase()})</span>
            <input value={price} onChange={event => setPrice(event.target.value)} inputMode="decimal" className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100" />
          </label>
          <label className="flex items-center gap-2 rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-700 dark:border-gray-700 dark:text-gray-200">
            <input type="checkbox" checked={isActive} onChange={event => setIsActive(event.target.checked)} className="h-4 w-4" />
            {t.adminOfferActiveLabel}
          </label>
        </div>
      </div>
      <button
        type="button"
        disabled={!dirty || isSaving || !Number.isFinite(Number(price)) || Number(price) < 0}
        onClick={() => onSave({
          slug: offer.slug,
          name: name.trim(),
          description: description.trim(),
          priceMinor: Math.round(Number(price || '0') * 100),
          isActive,
        })}
        className="mt-4 rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
      >
        {isSaving ? t.adminSaving : t.adminSaveOffer}
      </button>
    </div>
  );
}

function priceColumns(entry: ModelPriceCatalogEntry) {
  if (entry.provider === 'elevenlabs') {
    return [{ label: 'Audio', value: formatRate(entry.audioUsdPerCharacter, 'character') }];
  }
  if (entry.provider === 'openai') {
    const webSearchRate = Number(entry.webSearchUsdPerCall);
    return [
      { label: 'Input', value: formatRate(entry.inputUsdPerToken, 'token') },
      { label: 'Cached input', value: formatRate(entry.cachedInputUsdPerToken, 'token') },
      { label: 'Cache write', value: formatRate(entry.cacheWriteUsdPerToken, 'token') },
      { label: 'Output', value: formatRate(entry.outputUsdPerToken, 'token') },
      {
        label: 'Web search',
        value: Number.isFinite(webSearchRate) && webSearchRate > 0
          ? `$${(webSearchRate * 1_000).toLocaleString('en-US', { maximumFractionDigits: 6 })} / 1K`
          : '—',
      },
    ];
  }
  return [
    { label: 'Input', value: formatRate(entry.inputUsdPerToken, 'token') },
    { label: 'Output', value: formatRate(entry.outputUsdPerToken, 'token') },
    { label: 'Image output', value: formatRate(entry.imageOutputUsdPerToken, 'token') },
  ];
}

export default function Admin() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const { data: billingOverview } = useBillingOverview(!!user);
  const { data: overview, isLoading, error } = useAdminOverview(!!billingOverview?.isAdmin);
  const updateOffer = useUpdateStoryPackOffer();
  const refreshPrices = useRefreshModelPrices();
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  return (
    <AdminShell>
      <section className="grid gap-4 md:grid-cols-2">
        <Link to="/admin/users" className="group rounded-3xl border border-primary-100 bg-white p-6 shadow-sm transition hover:border-primary-300 hover:shadow-md dark:border-primary-900/40 dark:bg-surface-dark-elevated dark:hover:border-primary-700">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-500">Users</p>
          <h2 className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100">Credits and purchase history</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Search accounts, inspect purchases and ledger entries, or grant credits.</p>
          <span className="mt-5 inline-block text-sm font-semibold text-primary-600 group-hover:translate-x-1 dark:text-primary-300">Open users →</span>
        </Link>
        <Link to="/admin/stories" className="group rounded-3xl border border-primary-100 bg-white p-6 shadow-sm transition hover:border-primary-300 hover:shadow-md dark:border-primary-900/40 dark:bg-surface-dark-elevated dark:hover:border-primary-700">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-primary-500">Stories</p>
          <h2 className="mt-2 text-xl font-bold text-gray-900 dark:text-gray-100">Generation cost and profit</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Review per-story text, image, audio, credit, and profit totals.</p>
          <span className="mt-5 inline-block text-sm font-semibold text-primary-600 group-hover:translate-x-1 dark:text-primary-300">Open stories →</span>
        </Link>
      </section>

      {isLoading ? (
        <section className="rounded-3xl border border-primary-100 bg-white p-8 text-sm text-gray-500 dark:border-primary-900/40 dark:bg-surface-dark-elevated dark:text-gray-400">Loading dashboard…</section>
      ) : error || !overview ? (
        <section className="rounded-3xl border border-red-200 bg-red-50 p-6 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">{error?.message ?? 'Failed to load dashboard'}</section>
      ) : (
        <>
          <section className="space-y-4">
            <div className="flex items-center justify-between gap-4">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t.adminPackOffersTitle}</h2>
              {saveMessage && <span className="text-sm text-primary-600 dark:text-primary-300">{saveMessage}</span>}
            </div>
            <div className="grid gap-4 lg:grid-cols-3">
              {overview.offers.map(offer => (
                <OfferEditor
                  key={offer.slug}
                  offer={offer}
                  isSaving={updateOffer.isPending}
                  onSave={async payload => {
                    await updateOffer.mutateAsync(payload);
                    setSaveMessage(`${t.adminOfferSaved}: ${payload.slug}`);
                    window.setTimeout(() => setSaveMessage(null), 3000);
                  }}
                />
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-primary-100 bg-white shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
            <div className="flex flex-col gap-3 border-b border-gray-100 p-5 dark:border-gray-800 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">Current model prices</h2>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${overview.priceCatalogStatus.stale ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300' : 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'}`}>
                    {overview.priceCatalogStatus.stale ? 'Stale' : 'Fresh'}
                  </span>
                </div>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  Last successful refresh: {formatLocalizedDate(overview.priceCatalogStatus.lastSuccessAt, language, t.adminNever)}
                </p>
                {overview.priceCatalogStatus.lastError && <p className="mt-2 text-sm text-red-600 dark:text-red-300">{overview.priceCatalogStatus.lastError}</p>}
              </div>
              <button
                type="button"
                disabled={refreshPrices.isPending}
                onClick={() => refreshPrices.mutate()}
                className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
              >
                {refreshPrices.isPending ? 'Refreshing…' : 'Refresh prices'}
              </button>
            </div>
            {refreshPrices.error && <p className="border-b border-red-200 bg-red-50 px-5 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-300">{refreshPrices.error.message}</p>}
            <div className="grid gap-4 p-5 lg:grid-cols-2">
              {overview.modelPrices.map(entry => (
                <article key={`${entry.provider}:${entry.model}`} className="rounded-2xl border border-gray-100 p-4 dark:border-gray-800">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{entry.model}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{entry.provider} · {entry.endpointTag || 'configured rate'} · {entry.unit}</p>
                    </div>
                    <span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-900/30 dark:text-primary-200">{entry.roles.join(', ')}</span>
                  </div>
                  <dl className="mt-4 grid gap-3 sm:grid-cols-3">
                    {priceColumns(entry).map(column => (
                      <div key={column.label}>
                        <dt className="text-xs uppercase tracking-wide text-gray-400">{column.label}</dt>
                        <dd className="mt-1 text-sm font-semibold text-gray-700 dark:text-gray-200">{column.value}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 flex flex-wrap items-center justify-between gap-2 text-xs text-gray-500 dark:text-gray-400">
                    <span>Fetched {formatLocalizedDate(entry.fetchedAt, language, t.adminNever)}</span>
                    {entry.sourceUrl.startsWith('http') && <a href={entry.sourceUrl} target="_blank" rel="noreferrer" className="font-semibold text-primary-600 hover:underline dark:text-primary-300">Source ↗</a>}
                  </div>
                </article>
              ))}
            </div>
          </section>

          <section className="rounded-3xl border border-primary-100 bg-white p-5 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t.adminWebhookActivityTitle}</h2>
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {overview.webhookEvents.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">{t.adminNoWebhookEvents}</p>
              ) : overview.webhookEvents.map(event => (
                <div key={event.stripeEventId} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-surface-dark">
                  <div className="flex items-center justify-between gap-3">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{event.eventType}</p>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${event.status === 'failed' ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300' : event.status === 'processed' ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300' : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'}`}>
                      {getWebhookStatusLabel(event.status, t)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatLocalizedDate(event.createdAt, language, t.adminNever)}</p>
                  {event.errorMessage && <p className="mt-2 text-xs text-red-600 dark:text-red-300">{event.errorMessage}</p>}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </AdminShell>
  );
}
