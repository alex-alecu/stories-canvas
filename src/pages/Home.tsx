import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StoryInput from '../components/StoryInput';
import StoryGrid from '../components/StoryGrid';
import BackgroundOrbs from '../components/BackgroundOrbs';
import GenerationProgress from '../components/GenerationProgress';
import { useStories, useCreateStory, useCancelStory, useToggleVisibility } from '../hooks/useStories';
import { useStoryGeneration } from '../hooks/useStoryGeneration';
import { useNotification } from '../hooks/useNotification';
import { useLanguage } from '../i18n/LanguageContext';
import type { ArtStyleKey } from '../../shared/types';

const GENERATING_STORY_KEY = 'stories-canvas:generatingStoryId';

function getStoredGeneratingId(): string | null {
  try {
    return localStorage.getItem(GENERATING_STORY_KEY);
  } catch {
    return null;
  }
}

function setStoredGeneratingId(id: string | null): void {
  try {
    if (id) {
      localStorage.setItem(GENERATING_STORY_KEY, id);
    } else {
      localStorage.removeItem(GENERATING_STORY_KEY);
    }
  } catch {}
}

export default function Home() {
  const [generatingStoryId, setGeneratingStoryId] = useState<string | null>(getStoredGeneratingId);
  const { data: stories = [], isLoading } = useStories();
  const createStory = useCreateStory();
  const cancelStory = useCancelStory();
  const toggleVisibility = useToggleVisibility();
  const { progress } = useStoryGeneration(generatingStoryId);
  const { requestPermission, notify } = useNotification();
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  // Sync generatingStoryId to localStorage
  useEffect(() => {
    setStoredGeneratingId(generatingStoryId);
  }, [generatingStoryId]);

  const handleCreateStory = useCallback(async (prompt: string, age: number, style: ArtStyleKey) => {
    try {
      requestPermission();
      const result = await createStory.mutateAsync({ prompt, language, age, style });
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
    setGeneratingStoryId(null);
    setStoredGeneratingId(null);
  }, [generatingStoryId, cancelStory]);

  // Navigate to story as soon as the first page image is ready (or when fully completed)
  useEffect(() => {
    if (generatingStoryId && progress) {
      if (progress.completedPages >= 1 || progress.status === 'completed') {
        notify(t.notificationTitle, t.notificationBody);
        const targetId = generatingStoryId;
        setGeneratingStoryId(null);
        setStoredGeneratingId(null);
        navigate(`/story/${targetId}`);
      }
      if (progress.status === 'failed' || progress.status === 'cancelled') {
        setGeneratingStoryId(null);
        setStoredGeneratingId(null);
      }
    }
  }, [progress?.status, progress?.completedPages, generatingStoryId, navigate, notify, t]);

  // Show progress if we have a generatingStoryId (even before SSE connects, for instant feedback)
  const showProgress = generatingStoryId && progress?.status !== 'completed';

  return (
    <div className="min-h-screen p-4 md:p-8 relative">
      <BackgroundOrbs />
      <div className="max-w-6xl mx-auto relative z-10">
        <div className="py-8 md:py-16">
          <StoryInput onSubmit={handleCreateStory} isLoading={createStory.isPending} />
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

        <div className="mt-4">
          <StoryGrid stories={stories} isLoading={isLoading} onTogglePublic={handleTogglePublic} />
        </div>
      </div>
    </div>
  );
}
