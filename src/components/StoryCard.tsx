import { Link } from 'react-router-dom';
import type { StorySummary } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface StoryCardProps {
  story: StorySummary;
  onDelete?: (id: string) => void;
  onTogglePublic?: (id: string, isPublic: boolean) => void;
}

function StatusBadge({ status, completedPages, totalPages }: { status: string; completedPages: number; totalPages: number }) {
  const { t } = useLanguage();

  if (status === 'completed') return null;

  const labels: Record<string, string> = {
    generating_scenario: t.writingStoryStatus,
    generating_characters: t.drawingCharactersStatus,
    generating_images: `${t.illustratingStatus} ${completedPages}/${totalPages}`,
    failed: t.failed,
    cancelled: t.failed,
  };

  const isGenerating = status !== 'failed' && status !== 'cancelled';

  return (
    <div className={`absolute top-3 right-3 px-3 py-1 rounded-full text-xs font-bold backdrop-blur-sm ${
      isGenerating ? 'bg-primary-500/80 text-white' : 'bg-red-500/80 text-white'
    }`}>
      <span className="flex items-center gap-1.5">
        {isGenerating && (
          <span className="w-2 h-2 rounded-full bg-white animate-pulse" />
        )}
        {labels[status] || status}
      </span>
    </div>
  );
}

function VisibilityToggle({ isPublic, onToggle, label, ariaLabel }: {
  isPublic: boolean;
  onToggle: () => void;
  label: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
      className="flex items-center gap-2 group/toggle"
      aria-label={ariaLabel}
      title={ariaLabel}
    >
      <span className={`text-xs font-semibold transition-colors ${
        isPublic
          ? 'text-primary-600 dark:text-primary-400'
          : 'text-gray-400 dark:text-gray-500'
      }`}>
        {label}
      </span>
      <div className={`relative w-9 h-5 rounded-full transition-colors duration-200 ${
        isPublic
          ? 'bg-primary-500'
          : 'bg-gray-300 dark:bg-gray-600'
      }`}>
        <div className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          isPublic ? 'translate-x-4.5' : 'translate-x-0.5'
        }`} />
      </div>
    </button>
  );
}

export default function StoryCard({ story, onDelete, onTogglePublic }: StoryCardProps) {
  const { t } = useLanguage();
  const showFooter = onTogglePublic && story.status === 'completed';

  return (
    <div className="rounded-2xl overflow-hidden shadow-md hover:shadow-xl dark:shadow-primary-900/20 dark:hover:shadow-primary-800/30 transition-all duration-300 bg-white dark:bg-surface-dark-elevated">
      <Link
        to={`/story/${story.id}`}
        className="group block"
      >
        <div className="aspect-[4/3] relative overflow-hidden bg-gradient-to-br from-primary-100 to-warm-100 dark:from-primary-900/40 dark:to-warm-500/20">
          {story.coverImage ? (
            <img
              src={story.coverImage}
              alt={story.title || t.generatingStory}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <div className="text-center p-4">
                {story.status === 'failed' ? (
                  <span className="text-4xl">x</span>
                ) : (
                  <div className="space-y-3">
                    <div className="w-12 h-12 mx-auto rounded-full border-4 border-primary-300 dark:border-primary-700 border-t-primary-600 dark:border-t-primary-400 animate-spin" />
                    <p className="text-primary-400 dark:text-primary-300 text-sm font-medium">{t.creatingMagic}</p>
                  </div>
                )}
              </div>
            </div>
          )}
          {onDelete && (
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDelete(story.id);
              }}
              className="absolute top-3 left-3 w-8 h-8 rounded-full bg-red-500/60 hover:bg-red-500/80 text-white flex items-center justify-center backdrop-blur-sm transition-colors z-10"
              aria-label={t.deleteStory}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
              </svg>
            </button>
          )}
          <StatusBadge status={story.status} completedPages={story.completedPages} totalPages={story.totalPages} />
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-4 pt-12">
            <h3 className="text-white font-bold text-lg leading-tight drop-shadow-md">
              {story.title || t.generatingStory}
            </h3>
          </div>
        </div>
      </Link>
      {showFooter && (
        <div className="px-4 py-2.5 border-t border-gray-100 dark:border-gray-700/50 flex items-center justify-end">
          <VisibilityToggle
            isPublic={!!story.isPublic}
            onToggle={() => onTogglePublic(story.id, !story.isPublic)}
            label={story.isPublic ? t.publicLabel : t.privateLabel}
            ariaLabel={story.isPublic ? t.makePrivate : t.makePublic}
          />
        </div>
      )}
    </div>
  );
}
