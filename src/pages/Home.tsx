import type { TextModelSettings } from '../../shared/textModels';
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import StoryInput from '../components/StoryInput';
import StoryGrid from '../components/StoryGrid';
import BackgroundOrbs from '../components/BackgroundOrbs';
import GenerationProgress from '../components/GenerationProgress';
import PublicStoriesShowcase from '../components/PublicStoriesShowcase';
import StoryDeleteDialog from '../components/StoryDeleteDialog';
import { useStories, useCreateStory, useCancelStory, useDeleteStory, usePublicStories, useToggleVisibility } from '../hooks/useStories';
import { useStoryGeneration } from '../hooks/useStoryGeneration';
import { useNotification } from '../hooks/useNotification';
import { useNetworkStatus } from '../hooks/useNetworkStatus';
import { useOfflineStorySummaries } from '../hooks/useOfflineStories';
import { useLanguage } from '../i18n/LanguageContext';
import { useAuth } from '../contexts/AuthContext';
import { isSupabaseConfigured } from '../lib/supabaseConfig';
import type { StorySummary } from '../types';
import type { ArtStyleKey, StoryMode, StoryStatus, VoiceKey } from '../../shared/types';
import { readStorageItem, removeStorageItem, writeStorageItem } from '../lib/browserStorage';

const GENERATING_STORY_KEY = 'stories-canvas:generatingStoryId';
const PUBLIC_STORY_SHOWCASE_DISPLAY_LIMIT = 4;

function getStoredGeneratingId(): string | null {
  return readStorageItem(GENERATING_STORY_KEY);
}

function setStoredGeneratingId(id: string | null): void {
  if (id) {
    writeStorageItem(GENERATING_STORY_KEY, id);
  } else {
    removeStorageItem(GENERATING_STORY_KEY);
  }
}

function isTerminalStoryStatus(status: StoryStatus): boolean {
  return status === 'completed' || status === 'failed' || status === 'cancelled';
}

export default function Home() {
  const { user } = useAuth();
  const { isOnline } = useNetworkStatus();
  const {
    data: offlineStories = [],
    isLoading: isLoadingOfflineStories,
  } = useOfflineStorySummaries();
  const [generatingStoryId, setGeneratingStoryId] = useState<string | null>(getStoredGeneratingId);
  const [storyToDelete, setStoryToDelete] = useState<StorySummary | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [shouldLoadPublicStories, setShouldLoadPublicStories] = useState(false);
  const publicStoriesRef = useRef<HTMLDivElement | null>(null);
  const shouldLoadUserStories = isOnline && (!isSupabaseConfigured || !!user);
  const {
    data: stories = [],
    isLoading,
    isError: didFailUserStories,
    isFetched: hasSettledStories,
    isSuccess: hasLoadedStories,
  } = useStories(shouldLoadUserStories);
  const hasSettledUserStories = !shouldLoadUserStories || hasSettledStories;
  const {
    data: publicStories = [],
    isLoading: isLoadingPublicStories,
  } = usePublicStories(
    undefined,
    PUBLIC_STORY_SHOWCASE_DISPLAY_LIMIT,
    isOnline && shouldLoadPublicStories && hasSettledUserStories,
  );
  const createStory = useCreateStory();
  const cancelStory = useCancelStory();
  const cancelDeletingStory = useCancelStory();
  const deleteStory = useDeleteStory();
  const toggleVisibility = useToggleVisibility();
  const { progress } = useStoryGeneration(generatingStoryId);
  const { requestPermission, notify } = useNotification();
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  const clearGeneratingStoryTracking = useCallback(() => {
    setGeneratingStoryId(null);
    setStoredGeneratingId(null);
  }, []);

  const restoreGeneratingStoryTracking = useCallback((id: string) => {
    setGeneratingStoryId(id);
    setStoredGeneratingId(id);
  }, []);

  // Sync generatingStoryId to localStorage
  useEffect(() => {
    setStoredGeneratingId(generatingStoryId);
  }, [generatingStoryId]);

  useEffect(() => {
    if (!generatingStoryId || !hasLoadedStories) {
      return;
    }

    const matchingStory = stories.find(story => story.id === generatingStoryId);
    if (!matchingStory || isTerminalStoryStatus(matchingStory.status)) {
      clearGeneratingStoryTracking();
    }
  }, [clearGeneratingStoryTracking, generatingStoryId, hasLoadedStories, stories]);

  useEffect(() => {
    if (shouldLoadPublicStories || !hasSettledUserStories) {
      return;
    }

    const target = publicStoriesRef.current;
    if (!target) {
      return;
    }

    if (!('IntersectionObserver' in window)) {
      setShouldLoadPublicStories(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setShouldLoadPublicStories(true);
          observer.disconnect();
        }
      },
      { rootMargin: '100px 0px' },
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [hasSettledUserStories, shouldLoadPublicStories]);

  const handleCreateStory = useCallback(async (prompt: string, age: number, style: ArtStyleKey, settings: TextModelSettings, audioEnabled: boolean, voice?: VoiceKey) => {
    try {
      requestPermission();
      const result = await createStory.mutateAsync({ prompt, language, age, style, ...settings, audioEnabled, voice });
      setGeneratingStoryId(result.id);
    } catch (error) {
      console.error('Failed to create story:', error);
    }
  }, [createStory, language, requestPermission]);

  const handleTogglePublic = useCallback(async (id: string, isPublic: boolean) => {
    try {
      await toggleVisibility.mutateAsync({ id, isPublic });
    } catch {
      // Silently fail - React Query will keep the previous state
    }
  }, [toggleVisibility]);

  const handleCancelStory = useCallback(async () => {
    if (!generatingStoryId) return;
    try {
      await cancelStory.mutateAsync(generatingStoryId);
    } catch (error) {
      console.error('Failed to cancel story:', error);
    }
    clearGeneratingStoryTracking();
  }, [cancelStory, clearGeneratingStoryTracking, generatingStoryId]);

  const handleRequestDelete = useCallback((story: StorySummary) => {
    setDeleteError(null);
    setStoryToDelete(story);
  }, []);

  const handleDismissDelete = useCallback(() => {
    if (deleteStory.isPending || cancelDeletingStory.isPending) {
      return;
    }
    setDeleteError(null);
    setStoryToDelete(null);
  }, [cancelDeletingStory.isPending, deleteStory.isPending]);

  const handleConfirmDelete = useCallback(async () => {
    if (!storyToDelete) return;

    setDeleteError(null);
    const deletingActiveStory = storyToDelete.id === generatingStoryId;
    if (deletingActiveStory) {
      clearGeneratingStoryTracking();
    }

    try {
      if (isTerminalStoryStatus(storyToDelete.status)) {
        await deleteStory.mutateAsync(storyToDelete.id);
      } else {
        await cancelDeletingStory.mutateAsync(storyToDelete.id);
      }
      setStoryToDelete(null);
    } catch (error) {
      if (deletingActiveStory) {
        restoreGeneratingStoryTracking(storyToDelete.id);
      }
      setDeleteError(error instanceof Error ? error.message : t.couldNotDeleteStory);
    }
  }, [
    cancelDeletingStory,
    clearGeneratingStoryTracking,
    deleteStory,
    generatingStoryId,
    restoreGeneratingStoryTracking,
    storyToDelete,
    t.couldNotDeleteStory,
  ]);

  // Navigate to story as soon as the first page image is ready (or when fully completed)
  useEffect(() => {
    if (generatingStoryId && progress) {
      if (progress.completedPages >= 1 || progress.status === 'completed') {
        notify(t.notificationTitle, t.notificationBody);
        const targetId = generatingStoryId;
        clearGeneratingStoryTracking();
        navigate(`/story/${targetId}`);
      }
      if (progress.status === 'failed' || progress.status === 'cancelled') {
        clearGeneratingStoryTracking();
      }
    }
  }, [clearGeneratingStoryTracking, progress?.status, progress?.completedPages, generatingStoryId, navigate, notify, t]);

  // Show progress if we have a generatingStoryId (even before SSE connects, for instant feedback)
  const showProgress = generatingStoryId && progress?.status !== 'completed';
  const hasOfflineStories = offlineStories.length > 0;
  const shouldShowOfflineStories = hasOfflineStories && (
    !isOnline ||
    !shouldLoadUserStories ||
    didFailUserStories
  );
  const visibleUserStories = shouldShowOfflineStories ? offlineStories : stories;
  const isLoadingVisibleUserStories = shouldShowOfflineStories ? isLoadingOfflineStories : isLoading;
  const showUserStories = isSupabaseConfigured
    ? shouldShowOfflineStories || (!!user && (isLoading || visibleUserStories.length > 0))
    : isLoadingVisibleUserStories || visibleUserStories.length > 0;
  const isDeletingStory = deleteStory.isPending || cancelDeletingStory.isPending;
  const visiblePublicStories = useMemo(
    () => [...publicStories]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice(0, PUBLIC_STORY_SHOWCASE_DISPLAY_LIMIT),
    [publicStories],
  );

  return (
    <div className="min-h-screen p-4 md:p-8 relative">
      <StoryDeleteDialog
        isOpen={!!storyToDelete}
        storyTitle={storyToDelete?.title || storyToDelete?.prompt}
        isDeleting={isDeletingStory}
        errorMessage={deleteError}
        onCancel={handleDismissDelete}
        onConfirm={handleConfirmDelete}
      />

      <BackgroundOrbs />
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="py-8 md:py-16">
          <StoryInput onSubmit={handleCreateStory} isLoading={createStory.isPending} isOffline={!isOnline} />
        </div>

        {createStory.isError && (
          <div className="max-w-2xl mx-auto mb-8 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800/50 rounded-xl p-4 text-red-600 dark:text-red-400 text-center">
            {createStory.error?.message || t.couldNotCreateStory}
          </div>
        )}

        {showProgress && (
          <div className="mb-8 flex justify-center">
            <GenerationProgress
              progress={progress ?? null}
              onCancel={handleCancelStory}
              isCancelling={cancelStory.isPending}
            />
          </div>
        )}

        {showUserStories && (
          <section className="mt-4">
            <div className="mb-5">
              <h2 className="text-xl md:text-2xl font-bold text-gray-800 dark:text-gray-100">
                {t.myStories}
              </h2>
            </div>
            <StoryGrid
              stories={visibleUserStories}
              isLoading={isLoadingVisibleUserStories}
              onDelete={!shouldShowOfflineStories && isOnline ? (id) => {
                const story = visibleUserStories.find((item) => item.id === id);
                if (story) {
                  handleRequestDelete(story);
                }
              } : undefined}
              onTogglePublic={!shouldShowOfflineStories && isOnline ? handleTogglePublic : undefined}
            />
          </section>
        )}

        <div ref={publicStoriesRef}>
          <PublicStoriesShowcase
            stories={visiblePublicStories}
            isLoading={isOnline && shouldLoadPublicStories && hasSettledUserStories && isLoadingPublicStories}
          />
        </div>
      </div>
    </div>
  );
}
