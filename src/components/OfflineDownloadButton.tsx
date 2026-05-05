import { useEffect, useRef, useState } from 'react';
import type { StorySummary } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import { useOfflineStoryDownload } from '../hooks/useOfflineStories';

interface OfflineDownloadButtonProps {
  story: StorySummary;
}

export default function OfflineDownloadButton({ story }: OfflineDownloadButtonProps) {
  const { t } = useLanguage();
  const {
    canDownload,
    error,
    isDownloaded,
    keepOffline,
    record,
    remove,
    startDownload,
    status,
  } = useOfflineStoryDownload(story);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(event.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(event.target as Node)
      ) {
        setMenuOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  if (!canDownload) {
    return null;
  }

  const title = isDownloaded
    ? t.savedOffline
    : status === 'failed'
      ? t.retryDownload
      : t.downloadStory;

  const handleClick = () => {
    if (isDownloaded) {
      setMenuOpen(prev => !prev);
      return;
    }

    void startDownload();
  };

  return (
    <div className="relative flex justify-center">
      <button
        ref={buttonRef}
        type="button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handleClick();
        }}
        disabled={status === 'downloading'}
        className={`inline-flex h-9 min-w-9 items-center justify-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors disabled:cursor-not-allowed ${
          isDownloaded
            ? 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/60 dark:bg-emerald-900/20 dark:text-emerald-300 dark:hover:bg-emerald-900/30'
            : status === 'failed'
              ? 'border-red-200 bg-red-50 text-red-600 hover:bg-red-100 dark:border-red-800/60 dark:bg-red-900/20 dark:text-red-300 dark:hover:bg-red-900/30'
              : 'border-primary-200 bg-primary-50 text-primary-600 hover:bg-primary-100 dark:border-primary-800/60 dark:bg-primary-900/20 dark:text-primary-300 dark:hover:bg-primary-900/30'
        }`}
        aria-label={title}
        aria-expanded={isDownloaded ? menuOpen : undefined}
        title={title}
      >
        {status === 'downloading' ? (
          <span className="h-4 w-4 rounded-full border-2 border-current/30 border-t-current animate-spin" />
        ) : isDownloaded ? (
          <DeviceCheckIcon />
        ) : status === 'failed' ? (
          <RetryIcon />
        ) : (
          <DownloadIcon />
        )}
        <span className="hidden sm:inline">
          {status === 'downloading'
            ? t.downloadingStory
            : isDownloaded
              ? t.savedOffline
              : status === 'failed'
                ? t.retry
                : t.downloadStory}
        </span>
      </button>

      {isDownloaded && menuOpen && (
        <div
          ref={menuRef}
          className="absolute bottom-11 left-1/2 z-30 w-48 -translate-x-1/2 rounded-xl border border-gray-200 bg-white p-1.5 shadow-xl shadow-slate-950/15 dark:border-primary-800/60 dark:bg-surface-dark-elevated dark:shadow-primary-950/30"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
        >
          {record?.source === 'recent' && (
            <button
              type="button"
              onClick={() => {
                setMenuOpen(false);
                void keepOffline();
              }}
              className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-gray-700 transition-colors hover:bg-primary-50 dark:text-gray-200 dark:hover:bg-surface-dark-accent"
            >
              <PinIcon />
              {t.keepOffline}
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              void remove();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm font-semibold text-red-600 transition-colors hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-900/20"
          >
            <TrashIcon />
            {t.removeFromDevice}
          </button>
        </div>
      )}

      {error && (
        <span className="sr-only">{error}</span>
      )}
    </div>
  );
}

function DownloadIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v10m0 0l4-4m-4 4l-4-4M5 20h14" />
    </svg>
  );
}

function DeviceCheckIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8 3h8a2 2 0 012 2v14a2 2 0 01-2 2H8a2 2 0 01-2-2V5a2 2 0 012-2z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 13l2 2 4-5" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v6h6M20 20v-6h-6M5.6 15A7 7 0 0018 17.4M18.4 9A7 7 0 006 6.6" />
    </svg>
  );
}

function PinIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M14 4l6 6-4 1-5 7-2-2 7-5 1-4-3-3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 19l4-4" />
    </svg>
  );
}

function TrashIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M10 11v6M14 11v6M9 7l1-3h4l1 3M8 7l1 13h6l1-13" />
    </svg>
  );
}
