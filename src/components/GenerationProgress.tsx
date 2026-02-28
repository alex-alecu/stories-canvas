import { useState } from 'react';
import type { GenerationProgress as ProgressType } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface GenerationProgressProps {
  progress: ProgressType | null;
  onCancel?: () => void;
  isCancelling?: boolean;
}

function PhaseIndicator({ phase, isActive, isDone }: { phase: string; isActive: boolean; isDone: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-sm ${isDone ? 'text-green-500' : isActive ? 'text-primary-600 dark:text-primary-400 font-semibold' : 'text-gray-300 dark:text-gray-600'}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
        isDone ? 'bg-green-500 border-green-500 text-white' :
        isActive ? 'border-primary-500 text-primary-600 dark:text-primary-400 animate-pulse' :
        'border-gray-200 dark:border-gray-700 text-gray-300 dark:text-gray-600'
      }`}>
        {isDone ? '\u2713' : isActive ? '...' : '\u25CB'}
      </div>
      <span>{phase}</span>
    </div>
  );
}

function CancelConfirmDialog({ onConfirm, onDismiss, isCancelling }: { onConfirm: () => void; onDismiss: () => void; isCancelling: boolean }) {
  const { t } = useLanguage();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-surface-dark-elevated rounded-2xl shadow-xl p-6 max-w-sm w-full mx-4">
        <h3 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-2">
          {t.cancelConfirmTitle}
        </h3>
        <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
          {t.cancelConfirmMessage}
        </p>
        <div className="flex gap-3">
          <button
            onClick={onDismiss}
            disabled={isCancelling}
            className="flex-1 bg-gray-100 dark:bg-surface-dark-accent hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 font-semibold py-2.5 px-4 rounded-xl transition-colors disabled:opacity-50"
          >
            {t.keepGenerating}
          </button>
          <button
            onClick={onConfirm}
            disabled={isCancelling}
            className="flex-1 bg-red-500 hover:bg-red-600 text-white font-semibold py-2.5 px-4 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isCancelling && (
              <div className="w-4 h-4 rounded-full border-2 border-white/30 border-t-white animate-spin" />
            )}
            {t.confirmCancel}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function GenerationProgress({ progress, onCancel, isCancelling = false }: GenerationProgressProps) {
  const { t } = useLanguage();
  const [showConfirmDialog, setShowConfirmDialog] = useState(false);

  const phases = [
    { key: 'generating_scenario', label: t.writingStory },
    { key: 'generating_characters', label: t.drawingCharacters },
    { key: 'generating_images', label: t.illustratingPages },
  ];

  // When progress is null (waiting for SSE to connect), default to first phase
  const currentPhaseIndex = progress
    ? phases.findIndex(p => p.key === progress.status)
    : 0;
  const progressPercent = progress?.totalPages
    ? Math.round((progress.completedPages / progress.totalPages) * 100)
    : 0;

  const isTerminal = progress?.status === 'completed' || progress?.status === 'failed' || progress?.status === 'cancelled';
  const isCancelled = progress?.status === 'cancelled';
  const isFailed = progress?.status === 'failed';
  const showCancelButton = onCancel && !isTerminal;

  const handleCancelClick = () => {
    setShowConfirmDialog(true);
  };

  const handleConfirmCancel = () => {
    setShowConfirmDialog(false);
    onCancel?.();
  };

  const handleDismissDialog = () => {
    setShowConfirmDialog(false);
  };

  return (
    <>
      {showConfirmDialog && (
        <CancelConfirmDialog
          onConfirm={handleConfirmCancel}
          onDismiss={handleDismissDialog}
          isCancelling={isCancelling}
        />
      )}

      <div className="bg-white dark:bg-surface-dark-elevated rounded-2xl shadow-lg dark:shadow-primary-900/30 p-6 max-w-md w-full mx-auto">
        <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">
          {isCancelled ? t.generationCancelled : isFailed ? t.generationFailed : t.creatingYourStory}
        </h2>

        <div className="space-y-3 mb-6">
          {phases.map((phase, i) => (
            <PhaseIndicator
              key={phase.key}
              phase={phase.label}
              isActive={progress ? i === currentPhaseIndex : i === 0}
              isDone={progress ? (i < currentPhaseIndex || progress.status === 'completed') : false}
            />
          ))}
        </div>

        {progress?.status === 'generating_images' && progress.totalPages > 0 && (
          <div className="mb-4">
            <div className="flex justify-between text-sm text-gray-500 dark:text-gray-400 mb-1">
              <span>{t.pages}</span>
              <span>{progress.completedPages}/{progress.totalPages}</span>
            </div>
            <div className="w-full bg-gray-100 dark:bg-surface-dark-accent rounded-full h-3 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-primary-400 to-primary-600 rounded-full transition-all duration-500 ease-out"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
            {progress.failedPages.length > 0 && (
              <p className="text-red-400 text-xs mt-1">
                {progress.failedPages.length} {t.pagesFailedCount}
              </p>
            )}
          </div>
        )}

        {progress?.message && (
          <p className="text-sm text-gray-500 dark:text-gray-400 italic">{progress.message}</p>
        )}

        {(isFailed || isCancelled) && (
          <button
            onClick={() => window.location.href = '/'}
            className="mt-4 w-full bg-primary-500 hover:bg-primary-600 text-white font-bold py-2 px-4 rounded-xl transition-colors"
          >
            {t.backHome}
          </button>
        )}

        {showCancelButton && (
          <button
            onClick={handleCancelClick}
            disabled={isCancelling}
            className="mt-4 w-full border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-surface-dark-accent text-gray-600 dark:text-gray-300 font-semibold py-2 px-4 rounded-xl transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {isCancelling && (
              <div className="w-4 h-4 rounded-full border-2 border-gray-400 border-t-gray-600 animate-spin" />
            )}
            {t.cancelGeneration}
          </button>
        )}
      </div>
    </>
  );
}
