import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useParams, Link, useNavigate, useLocation } from 'react-router-dom';
import { useStory, useCancelStory, useStoryAssets, useRegenerateStoryAssets, useRecordStoryView } from '../hooks/useStories';
import { useStoryGeneration } from '../hooks/useStoryGeneration';
import StoryViewer from '../components/StoryViewer';
import GenerationProgress from '../components/GenerationProgress';
import { useLanguage } from '../i18n/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { warmMediaCache } from '../lib/serviceWorker';
import { downloadStoryForOffline } from '../lib/offlineStories';
import { useNetworkStatus } from '../hooks/useNetworkStatus';

const recordedStoryViewKeys = new Set<string>();

export default function StoryPage() {
  const { id } = useParams<{ id: string }>();
  const location = useLocation();
  const { isOnline } = useNetworkStatus();

  // Set black browser background while viewing stories (visible in overscroll areas)
  useEffect(() => {
    document.documentElement.classList.add('story-view');
    return () => {
      document.documentElement.classList.remove('story-view');
    };
  }, []);
  const { data: story, isLoading, error, refetch } = useStory(id);
  const shouldWarmMediaCache = import.meta.env.PROD
    && isOnline
    && story?.status === 'completed'
    && !story?.assetsStale
    && !story?.publicPreviewGate;
  const { data: storyAssets } = useStoryAssets(id, shouldWarmMediaCache);
  const isGenerating = story?.status !== 'completed' && story?.status !== 'failed' && story?.status !== 'cancelled';
  const { progress } = useStoryGeneration(isGenerating ? id ?? null : null);
  const cancelStory = useCancelStory();
  const regenerateAssets = useRegenerateStoryAssets();
  const recordStoryView = useRecordStoryView();
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { user, loading: authLoading } = useAuth();
  const lastWarmupKeyRef = useRef<string | null>(null);
  const lastAutoDownloadKeyRef = useRef<string | null>(null);
  const storyReturnTo = `${location.pathname}${location.search}${location.hash}`;

  useEffect(() => {
    if (id && isOnline && !authLoading) void refetch();
  }, [id, user?.id, authLoading, isOnline, refetch]);

  const warmupUrls = useMemo(() => {
    if (story?.status !== 'completed' || story.assetsStale || story.publicPreviewGate || !story.scenario) return [];

    const urls = new Set<string>();
    for (const page of story.scenario.pages) {
      if (page.status === 'completed' && page.imageUrl) {
        urls.add(page.imageUrl);
      }
      if (page.audioUrl) {
        urls.add(page.audioUrl);
      }
    }

    for (const sheet of storyAssets?.characterSheets ?? []) {
      urls.add(sheet.url);
    }

    return [...urls];
  }, [story, storyAssets]);

  useEffect(() => {
    if (warmupUrls.length === 0) return;

    const warmupKey = warmupUrls.join('|');
    if (lastWarmupKeyRef.current === warmupKey) return;

    lastWarmupKeyRef.current = warmupKey;
    warmMediaCache(warmupUrls);
  }, [warmupUrls]);

  useEffect(() => {
    if (!isOnline) return;
    if (!story || story.status !== 'completed' || story.assetsStale || story.publicPreviewGate || !story.scenario) return;

    const autoDownloadKey = `${story.id}:${story.scenarioRevision ?? 0}:${story.renderedScenarioRevision ?? 0}`;
    if (lastAutoDownloadKeyRef.current === autoDownloadKey) return;

    lastAutoDownloadKeyRef.current = autoDownloadKey;
    downloadStoryForOffline(story.id, 'recent', story).catch((error) => {
      console.error('Failed to save recently viewed story offline:', error);
    });
  }, [isOnline, story]);

  useEffect(() => {
    if (!isOnline || !story?.id) return;

    const viewKey = `${story.id}:${location.key}`;
    if (recordedStoryViewKeys.has(viewKey)) return;

    recordedStoryViewKeys.add(viewKey);
    recordStoryView.mutate(story.id);
  }, [isOnline, location.key, recordStoryView, story?.id]);

  const handleCancelStory = useCallback(async () => {
    if (!id) return;
    try {
      await cancelStory.mutateAsync(id);
    } catch (error) {
      console.error('Failed to cancel story:', error);
    }
    navigate('/');
  }, [id, cancelStory, navigate]);

  const handleRegenerateAssets = useCallback(async () => {
    if (!id) return;
    try {
      await regenerateAssets.mutateAsync(id);
    } catch (error) {
      console.error('Failed to regenerate story assets:', error);
    }
  }, [id, regenerateAssets]);

  const publicPreviewGate = useMemo(() => {
    if (!story?.publicPreviewGate) return undefined;
    return {
      ...story.publicPreviewGate,
      loginPath: `/login?returnTo=${encodeURIComponent(storyReturnTo)}`,
    };
  }, [story?.publicPreviewGate, storyReturnTo]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-12 h-12 rounded-full border-4 border-primary-300 dark:border-primary-700 border-t-primary-600 dark:border-t-primary-400 animate-spin" />
      </div>
    );
  }

  if (error || !story) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white dark:bg-surface-dark-elevated rounded-2xl shadow-lg dark:shadow-primary-900/30 p-8 max-w-md w-full text-center">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">{t.storyNotFound}</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-6">{t.storyNotFoundDescription}</p>
          <Link
            to="/"
            className="inline-block bg-primary-500 hover:bg-primary-600 text-white font-bold py-3 px-6 rounded-xl transition-colors"
          >
            {t.backHome}
          </Link>
        </div>
      </div>
    );
  }

  // Check if any pages have completed images
  const hasCompletedPages = story.scenario?.pages?.some(p => p.status === 'completed');

  if (story.assetsStale && story.scenario && !isGenerating) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div className="bg-white dark:bg-surface-dark-elevated rounded-2xl shadow-lg dark:shadow-primary-900/30 p-8 max-w-lg w-full text-center">
          <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">{t.assetsNeedRefresh}</h1>
          <p className="text-gray-500 dark:text-gray-400 mb-6">{t.regenerateAssetsDescription}</p>

          {regenerateAssets.isError && (
            <p className="text-sm text-red-500 dark:text-red-400 mb-4">
              {regenerateAssets.error?.message || t.regenerateAssetsFailed}
            </p>
          )}

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={handleRegenerateAssets}
              disabled={regenerateAssets.isPending}
              className="bg-primary-500 hover:bg-primary-600 disabled:bg-primary-500/50 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-xl transition-colors"
            >
              {regenerateAssets.isPending ? t.regeneratingAssets : t.regenerateAssets}
            </button>
            <Link
              to="/"
              className="inline-flex items-center justify-center bg-white/10 hover:bg-white/20 dark:bg-surface-dark-accent dark:hover:bg-surface-dark text-gray-700 dark:text-gray-200 font-semibold py-3 px-6 rounded-xl transition-colors"
            >
              {t.backHome}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // If still generating but no pages ready yet, show progress only
  if (isGenerating && !hasCompletedPages) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div>
          <GenerationProgress
            progress={progress}
            onCancel={handleCancelStory}
            isCancelling={cancelStory.isPending}
          />
          <div className="text-center mt-4">
            <Link to="/" className="text-primary-500 dark:text-primary-400 hover:text-primary-600 dark:hover:text-primary-300 font-medium text-sm">
              &larr; {t.backHome}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Show the story viewer (with progress overlay if still generating)
  if (story.scenario) {
    return (
      <StoryViewer
        storyId={story.id}
        scenario={story.scenario}
        isGenerating={isGenerating}
        progress={progress}
        storyMessage={story.progressMessage}
        voice={story.voice}
        storyStatus={story.status}
        likeCount={story.likeCount ?? 0}
        dislikeCount={story.dislikeCount ?? 0}
        myReaction={story.myReaction ?? null}
        storyMode={story.storyMode}
        openRouterCosts={story.openRouterCosts}
        canManageStory={isOnline && !!user && !!story.userId && story.userId === user.id}
        canUseOnlineActions={isOnline}
        publicPreviewGate={publicPreviewGate}
      />
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <div className="bg-white dark:bg-surface-dark-elevated rounded-2xl shadow-lg dark:shadow-primary-900/30 p-8 max-w-md w-full text-center">
        <h1 className="text-2xl font-bold text-gray-800 dark:text-gray-100 mb-2">{t.storyDataUnavailable}</h1>
        <Link
          to="/"
          className="inline-block bg-primary-500 hover:bg-primary-600 text-white font-bold py-3 px-6 rounded-xl transition-colors mt-4"
        >
          {t.backHome}
        </Link>
      </div>
    </div>
  );
}
