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
        className={`inline-flex items-center justify-center text-sm font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
          isDownloaded
            ? 'text-emerald-600 hover:text-emerald-700 dark:text-emerald-300 dark:hover:text-emerald-200'
            : status === 'failed'
              ? 'text-red-500 hover:text-red-600 dark:text-red-300 dark:hover:text-red-200'
              : 'text-primary-600 hover:text-primary-700 dark:text-primary-300 dark:hover:text-primary-200'
        }`}
        aria-label={title}
        aria-expanded={isDownloaded ? menuOpen : undefined}
        title={title}
      >
        {status === 'downloading'
          ? t.downloadingStory
          : isDownloaded
            ? t.savedOffline
            : status === 'failed'
              ? t.retry
              : t.downloadStory}
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
