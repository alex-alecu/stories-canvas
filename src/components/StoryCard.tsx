import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { StorySummary } from '../types';
import { useLanguage } from '../i18n/LanguageContext';
import OfflineDownloadButton from './OfflineDownloadButton';

interface StoryCardProps {
  story: StorySummary;
  onDelete?: (id: string) => void;
  onTogglePublic?: (id: string, isPublic: boolean) => void;
}

function useNearViewport(rootMargin = '200px 0px') {
  const targetRef = useRef<HTMLDivElement | null>(null);
  const [isNearViewport, setIsNearViewport] = useState(false);

  useEffect(() => {
    if (isNearViewport) {
      return;
    }

    const target = targetRef.current;
    if (!target || !('IntersectionObserver' in window)) {
      setIsNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setIsNearViewport(true);
          observer.disconnect();
        }
      },
      { rootMargin },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [isNearViewport, rootMargin]);

  return { targetRef, isNearViewport };
}

function StatusBadge({ status, completedPages, totalPages }: { status: string; completedPages: number; totalPages: number }) {
  const { t } = useLanguage();

  if (status === 'completed') return null;

  const labels: Record<string, string> = {
    generating_scenario: t.writingStoryStatus,
    reviewing_scenario: t.writingStoryStatus,
    generating_characters: t.drawingCharactersStatus,
    generating_images: `${t.illustratingStatus} ${completedPages}/${totalPages}`,
    generating_audio: `${t.recordingNarration}...`,
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
  const showVisibilityToggle = !!onTogglePublic && story.status === 'completed';
  const showOfflineDownload = story.status === 'completed' && !story.assetsStale;
  const showFooter = !!onDelete || showVisibilityToggle || showOfflineDownload;
  const viewCount = story.viewCount ?? 0;
  const coverSources = story.coverImageSources;
  const coverSrc = coverSources?.card ?? coverSources?.thumb ?? story.coverImage;
  const coverSrcSet = [
    coverSources?.thumb ? `${coverSources.thumb} 320w` : null,
    coverSources?.card ? `${coverSources.card} 640w` : null,
  ].filter(Boolean).join(', ');
  const { targetRef, isNearViewport } = useNearViewport();
  const shouldRenderCover = Boolean(coverSrc && isNearViewport);

  return (
    <div className="rounded-2xl overflow-hidden shadow-md hover:shadow-xl dark:shadow-primary-900/20 dark:hover:shadow-primary-800/30 transition-all duration-300 bg-white dark:bg-surface-dark-elevated">
      <Link
        to={`/story/${story.id}`}
        className="story-card-open-target group block"
        draggable={false}
        onDragStart={(event) => event.preventDefault()}
      >
        <div ref={targetRef} className="aspect-[4/3] relative overflow-hidden bg-gradient-to-br from-primary-100 to-warm-100 dark:from-primary-900/40 dark:to-warm-500/20">
          {shouldRenderCover ? (
            <img
              src={coverSrc!}
              srcSet={coverSrcSet || undefined}
              sizes="(min-width: 1280px) 288px, (min-width: 640px) 50vw, 100vw"
              alt={story.title || t.generatingStory}
              width={640}
              height={480}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              loading="lazy"
              decoding="async"
              draggable={false}
            />
          ) : !coverSrc ? (
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
          ) : null}
          <div
            className="absolute top-3 left-3 inline-flex items-center gap-1.5 rounded-full bg-black/35 px-2.5 py-1 text-xs font-bold text-white/90 backdrop-blur-sm"
            aria-label={`${viewCount} ${t.viewsLabel}`}
            title={`${viewCount} ${t.viewsLabel}`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0" />
              <circle cx="12" cy="12" r="3" />
            </svg>
            <span>{viewCount.toLocaleString()}</span>
          </div>
          <StatusBadge status={story.status} completedPages={story.completedPages} totalPages={story.totalPages} />
          {story.status === 'completed' && story.hasAudio && (
            <div className="absolute top-3 right-3 w-7 h-7 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center" aria-label={t.playNarration}>
              <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5 text-white/80" viewBox="0 0 24 24" fill="currentColor">
                <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 001.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06zM18.584 5.106a.75.75 0 011.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 01-1.06-1.06 8.25 8.25 0 000-11.668.75.75 0 010-1.06z" />
                <path d="M15.932 7.757a.75.75 0 011.061 0 6 6 0 010 8.486.75.75 0 01-1.06-1.061 4.5 4.5 0 000-6.364.75.75 0 010-1.06z" />
              </svg>
            </div>
          )}
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/70 via-black/30 to-transparent p-4 pt-12">
            <h3 className="text-white font-bold text-lg leading-tight drop-shadow-md">
              {story.title || t.generatingStory}
            </h3>
          </div>
        </div>
      </Link>
      {showFooter && (
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 px-4 py-2.5 border-t border-gray-100 dark:border-gray-700/50">
          <div className="min-w-0">
            {onDelete && (
              <button
                type="button"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  onDelete(story.id);
                }}
                className="text-sm font-semibold text-red-500 hover:text-red-600 dark:text-red-300 dark:hover:text-red-200 transition-colors"
                aria-label={t.deleteStory}
              >
                {t.deleteStory}
              </button>
            )}
          </div>
          <div className="min-w-0 justify-self-center">
            {showOfflineDownload && <OfflineDownloadButton story={story} />}
          </div>
          <div className="min-w-0 justify-self-end">
            {showVisibilityToggle && (
              <VisibilityToggle
                isPublic={!!story.isPublic}
                onToggle={() => onTogglePublic(story.id, !story.isPublic)}
                label={story.isPublic ? t.publicLabel : t.privateLabel}
                ariaLabel={story.isPublic ? t.makePrivate : t.makePublic}
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
