import { useState } from 'react';
import { useLanguage } from '../i18n/LanguageContext';
import { useOfflineDownloadsSummary } from '../hooks/useOfflineStories';
import LocalDownloadDeleteDialog from './LocalDownloadDeleteDialog';

export default function DeviceDownloadsPanel() {
  const { t } = useLanguage();
  const { clearAll, error, isClearing, isLoading, summary } = useOfflineDownloadsSummary();
  const [confirmOpen, setConfirmOpen] = useState(false);

  const hasDownloads = summary.totalCount > 0;

  const handleConfirmDelete = async () => {
    const cleared = await clearAll();
    if (cleared) {
      setConfirmOpen(false);
    }
  };

  return (
    <section className="bg-white dark:bg-surface-dark-elevated rounded-2xl shadow-lg shadow-primary-100/50 dark:shadow-primary-900/30 border border-primary-100 dark:border-primary-800/50 p-6 md:p-8 mb-8">
      <LocalDownloadDeleteDialog
        isOpen={confirmOpen}
        isDeleting={isClearing}
        errorMessage={error}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={handleConfirmDelete}
      />

      <div className="flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-2xl bg-primary-50 dark:bg-primary-900/20 text-primary-600 dark:text-primary-300 flex items-center justify-center">
              <DeviceIcon />
            </div>
            <h2 className="text-xl font-extrabold text-gray-800 dark:text-gray-100">
              {t.deviceDownloads}
            </h2>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-gray-500 dark:text-gray-400">
            {t.deviceDownloadsDescription}
          </p>
        </div>

        <button
          type="button"
          onClick={() => setConfirmOpen(true)}
          disabled={!hasDownloads || isClearing}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-bold text-red-600 transition-colors hover:bg-red-100 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/30"
        >
          {isClearing ? (
            <span className="h-4 w-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
          ) : (
            <TrashIcon />
          )}
          {t.deleteAllDownloads}
        </button>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Metric label={t.downloadedStories} value={isLoading ? '-' : String(summary.totalCount)} />
        <Metric label={t.manualDownloads} value={isLoading ? '-' : String(summary.manualCount)} />
        <Metric label={t.recentDownloads} value={isLoading ? '-' : String(summary.recentCount)} />
        <Metric label={t.storageUsed} value={isLoading ? '-' : formatBytes(summary.totalBytes)} />
      </div>

      {!isLoading && !hasDownloads && (
        <p className="mt-5 rounded-2xl bg-primary-50/80 dark:bg-surface-dark-accent/80 border border-primary-100 dark:border-primary-800/40 px-4 py-3 text-sm text-gray-500 dark:text-gray-400">
          {t.noDeviceDownloads}
        </p>
      )}

      {error && !confirmOpen && (
        <p className="mt-5 rounded-2xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-300">
          {t.couldNotUpdateDownloads}
        </p>
      )}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-primary-100 dark:border-primary-800/40 bg-primary-50/60 dark:bg-surface-dark-accent/60 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-400 dark:text-gray-500">
        {label}
      </p>
      <p className="mt-1 text-lg font-extrabold text-gray-800 dark:text-gray-100">
        {value}
      </p>
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 MB';
  }

  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function DeviceIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 3h8a2 2 0 012 2v14a2 2 0 01-2 2H8a2 2 0 01-2-2V5a2 2 0 012-2z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 18h4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M10 11v6M14 11v6M9 7l1-3h4l1 3M8 7l1 13h6l1-13" />
    </svg>
  );
}
