import { useDeferredValue, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { AdminPagination } from '../components/admin/AdminPagination';
import { AdminShell } from '../components/admin/AdminShell';
import { formatUsdMicros } from '../components/admin/adminFormatting';
import { useAuth } from '../contexts/AuthContext';
import { useAdminStories, useBillingOverview } from '../hooks/useBilling';
import { useLanguage } from '../i18n/LanguageContext';
import { formatLocalizedDate } from '../i18n/billingCopy';
import type { StoryMode } from '../types';

const PAGE_SIZES = new Set([10, 25, 50]);
const STORY_TYPES = new Set(['all', 'fast', 'pro', 'pro_audio']);

function positiveInteger(value: string | null, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function storyModeLabel(mode: StoryMode) {
  if (mode === 'pro_audio') return 'Pro + Audio';
  if (mode === 'pro') return 'Pro';
  return 'Fast';
}

export default function AdminStories() {
  const { user } = useAuth();
  const { t, language } = useLanguage();
  const [searchParams, setSearchParams] = useSearchParams();
  const query = searchParams.get('q') ?? '';
  const deferredQuery = useDeferredValue(query);
  const rawType = searchParams.get('type') ?? 'all';
  const storyType = (STORY_TYPES.has(rawType) ? rawType : 'all') as 'all' | StoryMode;
  const page = positiveInteger(searchParams.get('page'), 1);
  const rawSize = Number(searchParams.get('size'));
  const pageSize = PAGE_SIZES.has(rawSize) ? rawSize : 25;
  const { data: billingOverview } = useBillingOverview(!!user);
  const { data, isLoading, error } = useAdminStories({ query: deferredQuery, type: storyType, page, pageSize }, !!billingOverview?.isAdmin);

  useEffect(() => {
    const rawPage = searchParams.get('page');
    const rawPageSize = searchParams.get('size');
    const rawStoryType = searchParams.get('type');
    if ((rawPage && String(page) !== rawPage)
      || (rawPageSize && String(pageSize) !== rawPageSize)
      || (rawStoryType && storyType !== rawStoryType)) {
      const next = new URLSearchParams(searchParams);
      next.set('page', String(page));
      next.set('size', String(pageSize));
      next.set('type', storyType);
      setSearchParams(next, { replace: true });
    }
  }, [page, pageSize, searchParams, setSearchParams, storyType]);

  useEffect(() => {
    if (!data || data.totalCount === 0) return;
    const lastPage = Math.max(1, Math.ceil(data.totalCount / pageSize));
    if (page > lastPage) {
      const next = new URLSearchParams(searchParams);
      next.set('page', String(lastPage));
      setSearchParams(next, { replace: true });
    }
  }, [data, page, pageSize, searchParams, setSearchParams]);

  return (
    <AdminShell>
      <section className="rounded-3xl border border-primary-100 bg-white shadow-sm dark:border-primary-900/40 dark:bg-surface-dark-elevated">
        <div className="flex flex-col gap-4 border-b border-gray-100 p-5 dark:border-gray-800 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">Stories</h2>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">Newest first, with frozen generation costs and estimated profit.</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(260px,1fr)_180px]">
            <label>
              <span className="sr-only">Search by user email</span>
              <input
                type="search"
                value={query}
                onChange={event => {
                  const next = new URLSearchParams(searchParams);
                  if (event.target.value) next.set('q', event.target.value); else next.delete('q');
                  next.set('page', '1');
                  setSearchParams(next, { replace: true });
                }}
                placeholder="Search by user email"
                className="w-full rounded-2xl border border-gray-200 px-4 py-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100"
              />
            </label>
            <label>
              <span className="sr-only">Story type</span>
              <select
                value={storyType}
                onChange={event => {
                  const next = new URLSearchParams(searchParams);
                  next.set('type', event.target.value);
                  next.set('page', '1');
                  setSearchParams(next);
                }}
                className="w-full rounded-2xl border border-gray-200 bg-white px-4 py-3 text-sm text-gray-800 dark:border-gray-700 dark:bg-surface-dark dark:text-gray-100"
              >
                <option value="all">All types</option>
                <option value="fast">Fast</option>
                <option value="pro">Pro</option>
                <option value="pro_audio">Pro + Audio</option>
              </select>
            </label>
          </div>
        </div>

        {error ? (
          <p className="p-5 text-sm text-red-600 dark:text-red-300">{error.message}</p>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="min-w-[1220px] w-full text-left text-sm">
                <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500 dark:bg-surface-dark dark:text-gray-400">
                  <tr>
                    <th className="px-5 py-3">Story</th>
                    <th className="px-5 py-3">User</th>
                    <th className="px-5 py-3">Created</th>
                    <th className="px-5 py-3">Type</th>
                    <th className="px-5 py-3 text-right">Pages</th>
                    <th className="px-5 py-3 text-right">Text</th>
                    <th className="px-5 py-3 text-right">Images</th>
                    <th className="px-5 py-3 text-right">Audio</th>
                    <th className="px-5 py-3 text-right">Total</th>
                    <th className="px-5 py-3 text-right">Credits</th>
                    <th className="px-5 py-3 text-right">Profit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                  {isLoading ? (
                    <tr><td colSpan={11} className="px-5 py-8 text-center text-gray-500 dark:text-gray-400">Loading stories…</td></tr>
                  ) : !data?.items.length ? (
                    <tr><td colSpan={11} className="px-5 py-8 text-center text-gray-500 dark:text-gray-400">No stories match these filters.</td></tr>
                  ) : data.items.map(story => (
                    <tr key={story.id}>
                      <td className="max-w-64 px-5 py-4">
                        <Link to={`/story/${story.id}`} className="block truncate font-semibold text-gray-900 hover:text-primary-600 hover:underline dark:text-gray-100 dark:hover:text-primary-300">{story.title}</Link>
                        <p className="mt-1 truncate text-xs text-gray-400">{story.id}</p>
                      </td>
                      <td className="max-w-64 px-5 py-4"><p className="truncate text-gray-600 dark:text-gray-300">{story.email}</p></td>
                      <td className="whitespace-nowrap px-5 py-4 text-gray-600 dark:text-gray-300">{formatLocalizedDate(story.createdAt, language, t.adminNever)}</td>
                      <td className="px-5 py-4"><span className="rounded-full bg-primary-50 px-2.5 py-1 text-xs font-semibold text-primary-700 dark:bg-primary-900/30 dark:text-primary-200">{storyModeLabel(story.storyMode)}</span></td>
                      <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{story.pages}</td>
                      <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{formatUsdMicros(story.textCostUsdMicros, language)}</td>
                      <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{formatUsdMicros(story.imageCostUsdMicros, language)}</td>
                      <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{formatUsdMicros(story.audioCostUsdMicros, language)}</td>
                      <td className="px-5 py-4 text-right font-semibold text-gray-900 dark:text-gray-100">{formatUsdMicros(story.totalCostUsdMicros, language)}</td>
                      <td className="px-5 py-4 text-right text-gray-600 dark:text-gray-300">{story.creditsConsumed}</td>
                      <td className={`px-5 py-4 text-right font-semibold ${story.profitUsdMicros === null ? 'text-gray-400' : story.profitUsdMicros >= 0 ? 'text-green-600 dark:text-green-300' : 'text-red-600 dark:text-red-300'}`}>
                        {story.profitUsdMicros === null ? 'Unavailable' : formatUsdMicros(story.profitUsdMicros, language)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <AdminPagination
              page={page}
              pageSize={pageSize}
              totalCount={data?.totalCount ?? 0}
              onPageChange={nextPage => {
                const next = new URLSearchParams(searchParams);
                next.set('page', String(nextPage));
                setSearchParams(next);
              }}
              onPageSizeChange={nextSize => {
                const next = new URLSearchParams(searchParams);
                next.set('size', String(nextSize));
                next.set('page', '1');
                setSearchParams(next);
              }}
            />
          </>
        )}
      </section>
    </AdminShell>
  );
}
