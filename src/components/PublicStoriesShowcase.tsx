import { Link } from 'react-router-dom';
import type { StorySummary } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import StoryCard from './StoryCard';

interface PublicStoriesShowcaseProps {
  stories: StorySummary[];
  isLoading: boolean;
}

function ShowcaseSkeleton() {
  return (
    <div className="rounded-3xl overflow-hidden bg-white dark:bg-surface-dark-elevated shadow-md dark:shadow-primary-900/20 animate-pulse">
      <div className="aspect-[4/3] bg-gradient-to-br from-primary-50 to-warm-50 dark:from-primary-900/30 dark:to-warm-500/10" />
      <div className="p-4 space-y-3">
        <div className="h-4 w-3/4 rounded-full bg-gray-100 dark:bg-surface-dark-accent" />
        <div className="h-4 w-1/2 rounded-full bg-gray-100 dark:bg-surface-dark-accent" />
      </div>
    </div>
  );
}

export default function PublicStoriesShowcase({ stories, isLoading }: PublicStoriesShowcaseProps) {
  const { t } = useLanguage();
  const visibleStories = stories.slice(0, 4);
  const showSkeletons = isLoading && visibleStories.length === 0;
  const showStoryGrid = showSkeletons || visibleStories.length > 0;

  return (
    <section className="mt-10 md:mt-14 rounded-[2rem] border border-primary-100/80 dark:border-primary-800/50 bg-white/75 dark:bg-surface-dark-elevated/80 backdrop-blur-xl shadow-xl shadow-primary-100/40 dark:shadow-primary-950/20 overflow-hidden">
      <div className={`px-6 py-6 md:px-8 md:py-7 ${
        showStoryGrid ? 'border-b border-primary-100/80 dark:border-primary-800/40' : ''
      }`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div className="max-w-2xl">
            <span className="inline-flex items-center rounded-full border border-primary-200 dark:border-primary-700/60 bg-white/70 dark:bg-surface-dark-accent/70 px-3 py-1 text-xs font-semibold uppercase tracking-[0.2em] text-primary-600 dark:text-primary-300">
              {t.explore}
            </span>
            <h2 className="mt-3 text-2xl md:text-3xl font-extrabold text-gray-900 dark:text-gray-100">
              {t.exploreStories}
            </h2>
            <p className="mt-2 text-sm md:text-base text-gray-500 dark:text-gray-400">
              {t.discoverCommunityStories}
            </p>
          </div>

          <Link
            to="/explore"
            className="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-primary-500 to-primary-600 px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-primary-500/20 transition-transform hover:scale-[1.01] hover:from-primary-600 hover:to-primary-700"
          >
            {t.explore}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10.293 3.293a1 1 0 011.414 0l5 5a1 1 0 010 1.414l-5 5a1 1 0 01-1.414-1.414L13.586 10H4a1 1 0 110-2h9.586l-3.293-3.293a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </Link>
        </div>
      </div>

      {showStoryGrid && (
        <div className="px-6 py-6 md:px-8 md:py-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-6">
            {showSkeletons
              ? Array.from({ length: 4 }).map((_, index) => <ShowcaseSkeleton key={index} />)
              : visibleStories.map((story) => <StoryCard key={story.id} story={story} />)}
          </div>
        </div>
      )}
    </section>
  );
}
