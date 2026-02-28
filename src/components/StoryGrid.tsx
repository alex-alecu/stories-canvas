import StoryCard from './StoryCard';
import type { StorySummary } from '../types';
import { useLanguage } from '../i18n/LanguageContext';

interface StoryGridProps {
  stories: StorySummary[];
  isLoading: boolean;
  onDelete?: (id: string) => void;
  onTogglePublic?: (id: string, isPublic: boolean) => void;
  emptyMessage?: string;
  emptySubMessage?: string;
}

export default function StoryGrid({ stories, isLoading, onDelete, onTogglePublic, emptyMessage, emptySubMessage }: StoryGridProps) {
  const { t } = useLanguage();

  if (isLoading && stories.length === 0) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl overflow-hidden bg-white dark:bg-surface-dark-elevated shadow-md dark:shadow-primary-900/20 animate-pulse">
            <div className="aspect-[4/3] bg-gradient-to-br from-primary-50 to-warm-50 dark:from-primary-900/30 dark:to-warm-500/10" />
          </div>
        ))}
      </div>
    );
  }

  if (stories.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-6xl mb-4 opacity-50">~</div>
        <h2 className="text-xl font-bold text-gray-400 dark:text-gray-500 mb-2">{emptyMessage || t.noStoriesYet}</h2>
        <p className="text-gray-400 dark:text-gray-500">{emptySubMessage || t.createFirstStory}</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {stories.map(story => (
        <StoryCard key={story.id} story={story} onDelete={onDelete} onTogglePublic={onTogglePublic} />
      ))}
    </div>
  );
}
