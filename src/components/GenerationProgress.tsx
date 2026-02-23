import type { GenerationProgress as ProgressType } from '../types';

interface GenerationProgressProps {
  progress: ProgressType | null;
}

function PhaseIndicator({ phase, isActive, isDone }: { phase: string; isActive: boolean; isDone: boolean }) {
  return (
    <div className={`flex items-center gap-2 text-sm ${isDone ? 'text-green-500' : isActive ? 'text-primary-600 font-semibold' : 'text-gray-300'}`}>
      <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold border-2 ${
        isDone ? 'bg-green-500 border-green-500 text-white' :
        isActive ? 'border-primary-500 text-primary-600 animate-pulse' :
        'border-gray-200 text-gray-300'
      }`}>
        {isDone ? '✓' : isActive ? '...' : '○'}
      </div>
      <span>{phase}</span>
    </div>
  );
}

export default function GenerationProgress({ progress }: GenerationProgressProps) {
  const phases = [
    { key: 'generating_scenario', label: 'Se scrie povestea' },
    { key: 'generating_characters', label: 'Se desenează personajele' },
    { key: 'generating_images', label: 'Se ilustrează paginile' },
  ];

  const currentPhaseIndex = phases.findIndex(p => p.key === progress?.status);
  const progressPercent = progress?.totalPages
    ? Math.round((progress.completedPages / progress.totalPages) * 100)
    : 0;

  return (
    <div className="bg-white rounded-2xl shadow-lg p-6 max-w-md w-full mx-auto">
      <h2 className="text-lg font-bold text-gray-800 mb-4">
        {progress?.status === 'failed' ? 'Generarea a eșuat' : 'Se creează povestea ta'}
      </h2>

      <div className="space-y-3 mb-6">
        {phases.map((phase, i) => (
          <PhaseIndicator
            key={phase.key}
            phase={phase.label}
            isActive={i === currentPhaseIndex}
            isDone={i < currentPhaseIndex || progress?.status === 'completed'}
          />
        ))}
      </div>

      {progress?.status === 'generating_images' && progress.totalPages > 0 && (
        <div className="mb-4">
          <div className="flex justify-between text-sm text-gray-500 mb-1">
            <span>Pagini</span>
            <span>{progress.completedPages}/{progress.totalPages}</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-primary-400 to-primary-600 rounded-full transition-all duration-500 ease-out"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
          {progress.failedPages.length > 0 && (
            <p className="text-red-400 text-xs mt-1">
              {progress.failedPages.length} pagină/pagini nu s-au generat
            </p>
          )}
        </div>
      )}

      {progress?.message && (
        <p className="text-sm text-gray-500 italic">{progress.message}</p>
      )}

      {progress?.status === 'failed' && (
        <button
          onClick={() => window.location.href = '/'}
          className="mt-4 w-full bg-primary-500 hover:bg-primary-600 text-white font-bold py-2 px-4 rounded-xl transition-colors"
        >
          Înapoi acasă
        </button>
      )}
    </div>
  );
}
