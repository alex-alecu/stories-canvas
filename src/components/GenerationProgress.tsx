import type { GenerationProgress as ProgressType } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface GenerationProgressProps {
  progress: ProgressType | null;
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

export default function GenerationProgress({ progress }: GenerationProgressProps) {
  const { t } = useLanguage();

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

  return (
    <div className="bg-white dark:bg-surface-dark-elevated rounded-2xl shadow-lg dark:shadow-primary-900/30 p-6 max-w-md w-full mx-auto">
      <h2 className="text-lg font-bold text-gray-800 dark:text-gray-100 mb-4">
        {progress?.status === 'failed' ? t.generationFailed : t.creatingYourStory}
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

      {progress?.status === 'failed' && (
        <button
          onClick={() => window.location.href = '/'}
          className="mt-4 w-full bg-primary-500 hover:bg-primary-600 text-white font-bold py-2 px-4 rounded-xl transition-colors"
        >
          {t.backHome}
        </button>
      )}
    </div>
  );
}
