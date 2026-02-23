import { Link } from 'react-router-dom';
import type { StorySummary } from '../types';

interface StoryCardProps {
  story: StorySummary;
}

function StatusBadge({ status, completedPages, totalPages }: { status: string; completedPages: number; totalPages: number }) {
  if (status === 'completed') return null;

  const labels: Record<string, string> = {
    generating_scenario: 'Se scrie povestea...',
    generating_characters: 'Se desenează personajele...',
    generating_images: `Se ilustrează... ${completedPages}/${totalPages}`,
    failed: 'Eșuat',
  };

  const isGenerating = status !== 'failed';

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

export default function StoryCard({ story }: StoryCardProps) {
  return (
    <Link
      to={`/story/${story.id}`}
      className="group block rounded-2xl overflow-hidden shadow-md hover:shadow-xl transition-all duration-300 transform hover:scale-[1.02] bg-white"
    >
      <div className="aspect-[4/3] relative overflow-hidden bg-gradient-to-br from-primary-100 to-warm-100">
        {story.coverImage ? (
          <img
            src={story.coverImage}
            alt={story.title || 'Coperta poveștii'}
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
                  <div className="w-12 h-12 mx-auto rounded-full border-4 border-primary-300 border-t-primary-600 animate-spin" />
                  <p className="text-primary-400 text-sm font-medium">Se creează magia...</p>
                </div>
              )}
            </div>
          </div>
        )}
        <StatusBadge status={story.status} completedPages={story.completedPages} totalPages={story.totalPages} />
        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-4 pt-12">
          <h3 className="text-white font-bold text-lg leading-tight drop-shadow-md">
            {story.title || 'Se generează povestea...'}
          </h3>
        </div>
      </div>
    </Link>
  );
}
