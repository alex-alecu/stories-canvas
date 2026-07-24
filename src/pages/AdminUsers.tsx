import { useDeferredValue, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { AdminPagination } from '../components/admin/AdminPagination';
import { AdminShell } from '../components/admin/AdminShell';
import { formatMinor, formatUsdMicros } from '../components/admin/adminFormatting';
import { useAuth } from '../contexts/AuthContext';
import {
  useAdminOverview,
  useAdminUserDetail,
  useAdminUsers,
  useBillingOverview,
  useGrantCredits,
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

const PAGE_SIZES = new Set([10, 25, 50]);

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export default function AdminUsers() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const deferredQuery = useDeferredValue(query);
  const page = positiveInteger(searchParams.get('page'), 1);
  const rawSize = Number(searchParams.get('size'));
  const pageSize = PAGE_SIZES.has(rawSize) ? rawSize : 25;
  const selectedUserId = searchParams.get('user');
  const { data: billingOverview } = useBillingOverview(!!user);
  const isAdmin = !!billingOverview?.isAdmin;
  const { data: usersPage, isLoading: usersLoading, error: usersError } = useAdminUsers({ query: deferredQuery, page, pageSize }, isAdmin);
  const { data: selectedUser, isLoading: selectedUserLoading, error: selectedUserError } = useAdminUserDetail(selectedUserId, isAdmin && !!selectedUserId);
  const { data: adminOverview } = useAdminOverview(isAdmin);
  const grantCredits = useGrantCredits();
  const [grantAmount, setGrantAmount] = useState('5');
  const [grantNote, setGrantNote] = useState('');

  useEffect(() => {
    const rawPage = searchParams.get('page');
    const rawPageSize = searchParams.get('size');
    if ((rawPage && String(page) !== rawPage) || (rawPageSize && String(pageSize) !== rawPageSize)) {
      const next = new URLSearchParams(searchParams);
      next.set('page', String(page));
      next.set('size', String(pageSize));
      setSearchParams(next, { replace: true });
    }
  }, [page, pageSize, searchParams, setSearchParams]);

  useEffect(() => {
    if (!usersPage || usersPage.totalCount === 0) return;
    const lastPage = Math.max(1, Math.ceil(usersPage.totalCount / pageSize));
    if (page > lastPage) {
      const next = new URLSearchParams(searchParams);
      next.set('page', String(lastPage));
      setSearchParams(next, { replace: true });
    }
  }, [page, pageSize, searchParams, setSearchParams, usersPage]);

  const updateSearch = (value: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set('q', value); else next.delete('q');
    next.set('page', '1');
    next.delete('user');
    setSearchParams(next, { replace: true });
  };

  return (
    <AdminShell>
      <section className="rounded-3xl border border-primary-100 bg-white shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-5 dark:border-gray-800 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Users</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Search accounts and inspect their billing history.</p>
          </div>
          <label className="w-full md:max-w-md">
            <span className="sr-only">Search users</span>
            <input
              type="search"
              value={query}
              onChange={event => updateSearch(event.target.value)}
              placeholder={t.adminUserSearchPlaceholder}
              className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100"
            />
          </label>
        </div>

        {usersError ? (
          <p className="p-5 text-sm text-red-600 dark:text-red-300">{usersError.message}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-[850px] w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-surface-dark dark:text-gray-400">
                  <tr>
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Joined</th>
                    <th className="px-5 py-3 text-right">Credits</th>
                    <th className="px-5 py-3 text-right">Avg. credit value</th>
                    <th className="px-5 py-3">Role</th>
                    <th className="px-5 py-3"><span className="sr-only">Action</span></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {usersLoading ? (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-500 dark:text-gray-400">{t.adminSearchingUsers}</td></tr>
                  ) : !usersPage?.items.length ? (
                    <tr><td colSpan={6} className="px-5 py-8 text-center text-gray-500 dark:text-gray-400">{t.adminNoUsersFound}</td></tr>
                  ) : usersPage.items.map(result => (
                    <tr key={result.id} className={selectedUserId === result.id ? 'bg-primary-50/70 dark:bg-primary-900/10' : ''}>
                      <td className="px-5 py-4">
                        <p className="font-semibold text-gray-900 dark:text-gray-100">{result.displayName || result.email}</p>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{result.email}</p>
                      </td>
                      <td className="px-5 py-4 text-gray-600 dark:text-gray-300">{formatLocalizedDate(result.createdAt, language, t.adminNever)}</td>
                      <td className="px-5 py-4 text-right font-semibold text-gray-800 dark:text-gray-200">{formatCredits(result.availableCredits, t)}</td>
                      <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{formatMinor(result.averageCreditValueMinor, language, result.revenueCurrency)}</td>
                      <td className="px-5 py-4 text-gray-600 dark:text-gray-300">{result.isAdmin ? t.adminRole : 'user'}</td>
                      <td className="px-5 py-4 text-right">
                        <button
                          type="button"
                          onClick={() => {
                            const next = new URLSearchParams(searchParams);
                            next.set('user', result.id);
                            setSearchParams(next);
                          }}
                          className="rounded-xl bg-primary-50 px-3 py-2 text-xs font-semibold text-primary-700 hover:bg-primary-100 dark:bg-primary-900/30 dark:text-primary-200"
                        >
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AdminPagination
              page={page}
              pageSize={pageSize}
              totalCount={usersPage?.totalCount ?? 0}
              onPageChange={nextPage => {
                const next = new URLSearchParams(searchParams);
                next.set('page', String(nextPage));
                next.delete('user');
                setSearchParams(next);
              }}
              onPageSizeChange={nextSize => {
                const next = new URLSearchParams(searchParams);
                next.set('size', String(nextSize));
                next.set('page', '1');
                next.delete('user');
                setSearchParams(next);
              }}
            />
          </>
        )}
      </section>

      <section className="rounded-3xl border border-primary-100 bg-white p-5 shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
        {!selectedUserId ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t.adminSelectUser}</p>
        ) : selectedUserLoading ? (
          <p className="text-sm text-gray-500 dark:text-gray-400">{t.adminLoadingUserDetails}</p>
        ) : selectedUserError || !selectedUser ? (
          <p className="text-sm text-red-600 dark:text-red-300">{selectedUserError?.message ?? 'User not found'}</p>
        ) : (
          <div className="space-y-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">{selectedUser.displayName || selectedUser.email}</h2>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{selectedUser.email}</p>
                <p className="mt-1 text-xs text-gray-400 dark:text-gray-500">{t.adminJoined} {formatLocalizedDate(selectedUser.createdAt, language, t.adminNever)}</p>
              </div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div className="rounded-2xl bg-primary-50 px-4 py-3 dark:bg-primary-900/20">
                  <p className="text-xs uppercase tracking-wide text-primary-500">Credits</p>
                  <p className="mt-1 text-lg font-bold text-primary-700 dark:text-primary-200">{selectedUser.availableCredits}</p>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-surface-dark">
                  <p className="text-xs uppercase tracking-wide text-gray-400">Revenue</p>
                  <p className="mt-1 text-lg font-bold text-gray-800 dark:text-gray-200">{formatLocalizedPrice(selectedUser.metrics.revenueMinor, language, selectedUser.metrics.revenueCurrency)}</p>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-surface-dark">
                  <p className="text-xs uppercase tracking-wide text-gray-400">Gen. cost</p>
                  <p className="mt-1 text-lg font-bold text-gray-800 dark:text-gray-200">{formatUsdMicros(selectedUser.metrics.costUsdMicros, language)}</p>
                </div>
                <div className="rounded-2xl bg-gray-50 px-4 py-3 dark:bg-surface-dark">
                  <p className="text-xs uppercase tracking-wide text-gray-400">Stories</p>
                  <p className="mt-1 text-lg font-bold text-gray-800 dark:text-gray-200">{selectedUser.stories.length}</p>
                </div>
              </div>
            </div>

            <div className="rounded-2xl border border-gray-100 bg-gray-50 p-4 dark:border-gray-800 dark:bg-surface-dark">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{t.adminGrantFreeCreditsTitle}</h3>
              <div className="mt-3 grid gap-3 md:grid-cols-[120px_1fr_auto]">
                <input value={grantAmount} onChange={event => setGrantAmount(event.target.value)} inputMode="numeric" aria-label="Credit amount" className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-surface-dark-accent dark:text-gray-100" />
                <input value={grantNote} onChange={event => setGrantNote(event.target.value)} placeholder={t.adminLedgerReasonPlaceholder} className="rounded-xl border border-gray-200 px-3 py-2 text-sm text-gray-800 dark:border-gray-700 dark:bg-surface-dark-accent dark:text-gray-100" />
                <button
                  type="button"
                  disabled={grantCredits.isPending || !Number.isInteger(Number(grantAmount)) || Number(grantAmount) <= 0}
                  onClick={async () => {
                    await grantCredits.mutateAsync({ userId: selectedUser.id, amount: Number(grantAmount), note: grantNote.trim() || undefined });
                    setGrantNote('');
                  }}
                  className="rounded-xl bg-primary-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {grantCredits.isPending ? t.adminGrantingCredits : t.adminGrantCredits}
                </button>
              </div>
              {grantCredits.error && <p className="mt-2 text-sm text-red-600 dark:text-red-300">{grantCredits.error.message}</p>}
            </div>

            <div className="grid gap-6 lg:grid-cols-2">
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t.adminRecentPurchasesTitle}</h3>
                <div className="mt-3 space-y-3">
                  {selectedUser.purchases.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">{t.billingNoPurchases}</p> : selectedUser.purchases.map(purchase => {
                    const offer = adminOverview?.offers.find(item => item.slug === purchase.offerSlug);
                    return (
                      <div key={purchase.id} className="rounded-2xl border border-gray-100 px-4 py-3 dark:border-gray-800">
                        <div className="flex items-center justify-between gap-3">
                          <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{offer ? getOfferCopy(offer, t).name : purchase.offerSlug}</p>
                          <span className="text-sm text-primary-600 dark:text-primary-300">{formatLocalizedPrice(purchase.amountMinor, language, purchase.currency)}</span>
                        </div>
                        <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatCredits(purchase.creditsGranted, t)} · {getPurchaseStatusLabel(purchase.status, t)} · {formatLocalizedDate(purchase.createdAt, language, t.adminNever)}</p>
                      </div>
                    );
                  })}
                </div>
              </div>
              <div>
                <h3 className="text-lg font-bold text-gray-900 dark:text-gray-100">{t.adminCreditLedgerTitle}</h3>
                <div className="mt-3 space-y-3">
                  {selectedUser.ledger.length === 0 ? <p className="text-sm text-gray-500 dark:text-gray-400">{t.adminNoLedgerEntries}</p> : selectedUser.ledger.map(entry => (
                    <div key={entry.id} className="rounded-2xl border border-gray-100 px-4 py-3 dark:border-gray-800">
                      <div className="flex items-center justify-between gap-3">
                        <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">{getLedgerReasonLabel(entry.reason, t)}</p>
                        <span className={`text-sm font-semibold ${entry.delta > 0 ? 'text-green-600 dark:text-green-300' : 'text-red-600 dark:text-red-300'}`}>{entry.delta > 0 ? '+' : '-'}{formatCredits(Math.abs(entry.delta), t)}</span>
                      </div>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{t.billingBalanceAfter}: {formatCredits(entry.balanceAfter, t)} · {formatLocalizedDate(entry.createdAt, language, t.adminNever)}</p>
                      {entry.note && <p className="mt-2 text-xs text-gray-600 dark:text-gray-300">{entry.note}</p>}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </AdminShell>
  );
}
