import { useEffect } from 'react';
import { useLanguage } from '../i18n/LanguageContext';

interface LocalDownloadDeleteDialogProps {
  isOpen: boolean;
  isDeleting?: boolean;
  errorMessage?: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export default function LocalDownloadDeleteDialog({
  isOpen,
  isDeleting = false,
  errorMessage,
  onCancel,
  onConfirm,
}: LocalDownloadDeleteDialogProps) {
  const { t } = useLanguage();

  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isDeleting) {
        onCancel();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDeleting, isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/55 backdrop-blur-sm px-4"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isDeleting) {
          onCancel();
        }
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-downloads-title"
        className="w-full max-w-md rounded-[1.75rem] border border-primary-100/80 dark:border-primary-800/50 bg-white dark:bg-surface-dark-elevated shadow-2xl shadow-slate-950/20 dark:shadow-primary-950/30 overflow-hidden"
      >
        <div className="p-6 md:p-7">
          <div className="w-12 h-12 rounded-2xl bg-red-50 dark:bg-red-900/20 text-red-500 dark:text-red-300 flex items-center justify-center mb-5">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 7h12M10 11v6M14 11v6M9 7l1-3h4l1 3M8 7l1 13h6l1-13" />
            </svg>
          </div>

          <h2 id="delete-downloads-title" className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            {t.deleteAllDownloadsTitle}
          </h2>
          <p className="text-sm leading-6 text-gray-500 dark:text-gray-400">
            {t.deleteAllDownloadsDescription}
          </p>

          {errorMessage && (
            <div className="mt-4 rounded-2xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20 px-4 py-3 text-sm text-red-600 dark:text-red-300">
              {errorMessage}
            </div>
          )}
        </div>

        <div className="px-6 pb-6 md:px-7 md:pb-7 flex gap-3">
          <button
            type="button"
            onClick={onCancel}
            disabled={isDeleting}
            className="flex-1 rounded-2xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-surface-dark px-4 py-3 text-sm font-semibold text-gray-700 dark:text-gray-200 transition-colors hover:bg-gray-50 dark:hover:bg-surface-dark-accent disabled:opacity-50"
          >
            {t.back}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={isDeleting}
            className="flex-1 rounded-2xl bg-red-500 hover:bg-red-600 px-4 py-3 text-sm font-semibold text-white transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isDeleting && (
              <span className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            )}
            {t.confirmDeleteAllDownloads}
          </button>
        </div>
      </div>
    </div>
  );
}
