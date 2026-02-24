import StoryCard from './StoryCard';
import type { StorySummary } from '../types';

interface StoryGridProps {
  stories: StorySummary[];
  isLoading: boolean;
  onDelete?: (id: string) => void;
}

export default function StoryGrid({ stories, isLoading, onDelete }: StoryGridProps) {
  if (isLoading && stories.length === 0) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl overflow-hidden bg-white shadow-md animate-pulse">
            <div className="aspect-[4/3] bg-gradient-to-br from-primary-50 to-warm-50" />
          </div>
        ))}
      </div>
    );
  }

  if (stories.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-6xl mb-4 opacity-50">~</div>
        <h2 className="text-xl font-bold text-gray-400 mb-2">Nicio poveste încă</h2>
        <p className="text-gray-400">Creează prima ta poveste mai sus!</p>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
      {stories.map(story => (
        <StoryCard key={story.id} story={story} onDelete={onDelete} />
      ))}
    </div>
  );
}
