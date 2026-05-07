import { useDeferredValue, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  useAdminOverview,
  useAdminUserDetail,
  useAdminUsers,
  useBillingOverview,
  useGrantCredits,
  useUpdateStoryPackOffer,
} from '../hooks/useBilling';
import { useLanguage } from '../i18n/LanguageContext';
import {
  formatCredits,
  formatLocalizedDate,
  formatLocalizedPrice,
  getLedgerReasonLabel,
  getOfferCopy,
  getPurchaseStatusLabel,
  getWebhookStatusLabel,
} from '../i18n/billingCopy';
import type { StoryPackOffer } from '../types';

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
    <div className="rounded-2xl border border-primary-100 dark:border-primary-900/40 bg-white dark:bg-surface-dark-elevated p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div>
          <p className="text-xs uppercase tracking-[0.2em] text-gray-400 dark:text-gray-500">{offer.slug}</p>
          <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{formatCredits(offer.credits, t)}</h3>
        </div>
        <span className="rounded-full bg-primary-50 dark:bg-primary-900/30 px-3 py-1 text-xs font-semibold text-primary-600 dark:text-primary-300">
          {formatLocalizedPrice(offer.priceMinor, language, offer.currency)}
        </span>
      </div>

      <div className="space-y-3">
        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{t.adminOfferNameLabel}</span>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-surface-dark px-3 py-2 text-sm text-gray-800 dark:text-gray-100"
          />
        </label>

        <label className="block">
          <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{t.adminOfferDescriptionLabel}</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-surface-dark px-3 py-2 text-sm text-gray-800 dark:text-gray-100"
          />
        </label>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
          <label className="block">
            <span className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-200">{t.adminOfferPriceLabel}</span>
            <input
              value={price}
              onChange={(event) => setPrice(event.target.value)}
              inputMode="decimal"
              className="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-surface-dark px-3 py-2 text-sm text-gray-800 dark:text-gray-100"
            />
          </label>

          <label className="flex items-center gap-2 rounded-xl border border-gray-200 dark:border-gray-700 px-3 py-2 text-sm text-gray-700 dark:text-gray-200">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(event) => setIsActive(event.target.checked)}
              className="h-4 w-4"
            />
            {t.adminOfferActiveLabel}
          </label>
        </div>
      </div>

      <button
        type="button"
        disabled={!dirty || isSaving}
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

export default function Admin() {
  const { user, loading } = useAuth();
  const { t, language } = useLanguage();
  const navigate = useNavigate();
  const { data: billingOverview, isLoading: billingLoading, error: billingError } = useBillingOverview(!!user);
  const { data: adminOverview, isLoading: adminLoading } = useAdminOverview(!!user);
  const updateOffer = useUpdateStoryPackOffer();
  const grantCredits = useGrantCredits();

  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);
  const { data: users = [], isLoading: usersLoading } = useAdminUsers(deferredQuery, !!user && !!billingOverview?.isAdmin);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const { data: selectedUser, isLoading: selectedUserLoading } = useAdminUserDetail(selectedUserId, !!selectedUserId && !!billingOverview?.isAdmin);
  const [grantAmount, setGrantAmount] = useState('5');
  const [grantNote, setGrantNote] = useState('');
  const [saveMessage, setSaveMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!loading && !user) {
      navigate('/login?returnTo=/admin', { replace: true });
    }
  }, [loading, user, navigate]);

  useEffect(() => {
    if (!selectedUserId && users.length > 0) {
      setSelectedUserId(users[0].id);
    }
  }, [selectedUserId, users]);

  const forbidden = useMemo(() => {
    if (!billingError) return false;
    return billingError.message.toLowerCase().includes('admin');
  }, [billingError]);

  if (loading || billingLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-primary-300 dark:border-primary-700 border-t-primary-600 dark:border-t-primary-400 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
  }

  if (forbidden || (!adminLoading && !billingOverview?.isAdmin)) {
    return (
      <div className="min-h-screen p-6 md:p-8">
        <div className="mx-auto max-w-3xl rounded-3xl border border-red-200 bg-red-50 p-8 text-center dark:border-red-900/40 dark:bg-red-950/30">
          <h1 className="text-2xl font-bold text-red-700 dark:text-red-300">{t.adminAccessRequiredTitle}</h1>
          <p className="mt-2 text-sm text-red-600 dark:text-red-300/80">
            {t.adminAccessRequiredBody}
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="mx-auto max-w-7xl space-y-8">
        <section className="rounded-3xl border border-primary-100 bg-white p-6 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
          <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-sm font-medium uppercase tracking-[0.22em] text-primary-500">{t.adminLabel}</p>
              <h1 className="text-3xl font-extrabold text-gray-900 dark:text-gray-100">{t.adminTitle}</h1>
              <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">
                {t.adminDescription}
              </p>
            </div>
            <div className="rounded-2xl bg-primary-50 px-4 py-3 text-sm text-primary-700 dark:bg-primary-900/30 dark:text-primary-200">
              {t.adminSignedInAs} {user.email}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[1.4fr_1fr]">
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t.adminPackOffersTitle}</h2>
              {saveMessage && (
                <span className="text-sm text-primary-600 dark:text-primary-300">{saveMessage}</span>
              )}
            </div>
            <div className="grid gap-4 lg:grid-cols-2">
              {adminOverview?.offers.map((offer) => (
                <OfferEditor
                  key={offer.slug}
                  offer={offer}
                  isSaving={updateOffer.isPending}
                  onSave={async (payload) => {
                    await updateOffer.mutateAsync(payload);
                    setSaveMessage(`${t.adminOfferSaved}: ${payload.slug}`);
                    setTimeout(() => setSaveMessage(null), 3000);
                  }}
                />
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-primary-100 bg-white p-5 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t.adminWebhookActivityTitle}</h2>
            <div className="mt-4 space-y-3">
              {(adminOverview?.webhookEvents ?? []).length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">{t.adminNoWebhookEvents}</p>
              ) : (
                adminOverview?.webhookEvents.map((event) => (
                  <div key={event.stripeEventId} className="rounded-2xl border border-gray-100 bg-gray-50 px-4 py-3 dark:border-gray-800 dark:bg-surface-dark">
                    <div className="flex items-center justify-between gap-3">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{event.eventType}</p>
                      <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${
                        event.status === 'failed'
                          ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                          : event.status === 'processed'
                            ? 'bg-green-100 text-green-700 dark:bg-green-950/40 dark:text-green-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300'
                      }`}>
                        {getWebhookStatusLabel(event.status, t)}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatLocalizedDate(event.createdAt, language, t.adminNever)}</p>
                    {event.errorMessage && (
                      <p className="mt-2 text-xs text-red-600 dark:text-red-300">{event.errorMessage}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        <section className="grid gap-6 xl:grid-cols-[360px_1fr]">
          <div className="rounded-3xl border border-primary-100 bg-white p-5 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
            <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100">{t.adminUserSearchTitle}</h2>
            <input
              type="text"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t.adminUserSearchPlaceholder}
              className="mt-4 w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100"
            />

            <div className="mt-4 space-y-2">
              {usersLoading ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">{t.adminSearchingUsers}</p>
              ) : users.length === 0 ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">{t.adminNoUsersFound}</p>
              ) : (
                users.map((result) => (
                  <button
                    key={result.id}
                    type="button"
                    onClick={() => setSelectedUserId(result.id)}
                    className={`w-full rounded-2xl border px-4 py-3 text-left transition-colors ${
                      selectedUserId === result.id
                        ? 'border-primary-400 bg-primary-50 dark:border-primary-400 dark:bg-primary-900/20'
                        : 'border-gray-100 bg-gray-50 hover:border-primary-200 dark:border-gray-800 dark:bg-surface-dark dark:hover:border-primary-900/60'
                    }`}
                  >
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{result.displayName || result.email}</p>
                    <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{result.email}</p>
                    <div className="mt-2 flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                      <span>{formatCredits(result.availableCredits, t)}</span>
                      {result.isAdmin && <span className="font-semibold text-primary-600 dark:text-primary-300">{t.adminRole}</span>}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>

          <div className="rounded-3xl border border-primary-100 bg-white p-5 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
            {!selectedUserId ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t.adminSelectUser}</p>
            ) : selectedUserLoading || !selectedUser ? (
              <p className="text-sm text-gray-500 dark:text-gray-400">{t.adminLoadingUserDetails}</p>
            ) : (
              <div className="space-y-6">
                <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
                  <div>
                    <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{selectedUser.displayName || selectedUser.email}</h2>
                    <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{selectedUser.email}</p>
                    <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t.adminJoined} {formatLocalizedDate(selectedUser.createdAt, language, t.adminNever)}</p>
                  </div>
                  <div className="rounded-2xl bg-primary-50 px-4 py-3 text-right dark:bg-primary-900/20">
                    <p className="text-xs uppercase tracking-[0.2em] text-primary-500">{t.availableCredits}</p>
                    <p className="text-2xl font-extrabold text-primary-700 dark:text-primary-200">{selectedUser.availableCredits}</p>
                  </div>
                </div>

                <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-surface-dark">
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.adminGrantFreeCreditsTitle}</h3>
                  <div className="mt-3 grid gap-3 md:grid-cols-[120px_1fr_auto]">
                    <input
                      value={grantAmount}
                      onChange={(event) => setGrantAmount(event.target.value)}
                      inputMode="numeric"
                      className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-surface-dark-accent dark:text-gray-100"
                    />
                    <input
                      value={grantNote}
                      onChange={(event) => setGrantNote(event.target.value)}
                      placeholder={t.adminLedgerReasonPlaceholder}
                      className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-surface-dark-accent dark:text-gray-100"
                    />
                    <button
                      type="button"
                      disabled={grantCredits.isPending}
                      onClick={async () => {
                        await grantCredits.mutateAsync({
                          userId: selectedUser.id,
                          amount: Number.parseInt(grantAmount, 10),
                          note: grantNote.trim() || undefined,
                        });
                        setGrantNote('');
                      }}
                      className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {grantCredits.isPending ? t.adminGrantingCredits : t.adminGrantCredits}
                    </button>
                  </div>
                </div>

                <div className="grid gap-6 lg:grid-cols-2">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t.adminRecentPurchasesTitle}</h3>
                    <div className="mt-3 space-y-3">
                      {selectedUser.purchases.length === 0 ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400">{t.billingNoPurchases}</p>
                      ) : (
                        selectedUser.purchases.map((purchase) => {
                          const offer = adminOverview?.offers.find((item) => item.slug === purchase.offerSlug);
                          const offerName = offer ? getOfferCopy(offer, t).name : purchase.offerSlug;
                          return (
                          <div key={purchase.id} className="rounded-2xl border border-gray-100 px-4 py-3 dark:border-gray-800">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{offerName}</p>
                              <span className="text-sm text-primary-600 dark:text-primary-300">{formatLocalizedPrice(purchase.amountMinor, language, purchase.currency)}</span>
                            </div>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {formatCredits(purchase.creditsGranted, t)} · {getPurchaseStatusLabel(purchase.status, t)} · {formatLocalizedDate(purchase.createdAt, language, t.adminNever)}
                            </p>
                          </div>
                        )})
                      )}
                    </div>
                  </div>

                  <div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t.adminCreditLedgerTitle}</h3>
                    <div className="mt-3 space-y-3">
                      {selectedUser.ledger.length === 0 ? (
                        <p className="text-sm text-gray-500 dark:text-gray-400">{t.adminNoLedgerEntries}</p>
                      ) : (
                        selectedUser.ledger.map((entry) => (
                          <div key={entry.id} className="rounded-2xl border border-gray-100 px-4 py-3 dark:border-gray-800">
                            <div className="flex items-center justify-between gap-3">
                              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{getLedgerReasonLabel(entry.reason, t)}</p>
                              <span className={`text-sm font-semibold ${entry.delta > 0 ? 'text-green-600 dark:text-green-300' : 'text-red-600 dark:text-red-300'}`}>
                                {entry.delta > 0 ? '+' : ''}{entry.delta}
                              </span>
                            </div>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {t.billingBalanceAfter}: {entry.balanceAfter} · {formatLocalizedDate(entry.createdAt, language, t.adminNever)}
                            </p>
                            {entry.note && (
                              <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">{entry.note}</p>
                            )}
                          </div>
                        ))
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
