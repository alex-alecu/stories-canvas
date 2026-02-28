import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StoryInput from '../components/StoryInput';
import StoryGrid from '../components/StoryGrid';
import GenerationProgress from '../components/GenerationProgress';
import { useStories, useCreateStory, useCancelStory } from '../hooks/useStories';
import { useStoryGeneration } from '../hooks/useStoryGeneration';
import { useLanguage } from '../i18n/LanguageContext';

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
  const { progress } = useStoryGeneration(generatingStoryId);
  const navigate = useNavigate();
  const { t, language } = useLanguage();

  // Sync generatingStoryId to localStorage
  useEffect(() => {
    setStoredGeneratingId(generatingStoryId);
  }, [generatingStoryId]);

  const handleCreateStory = useCallback(async (prompt: string) => {
    try {
      const result = await createStory.mutateAsync({ prompt, language });
      setGeneratingStoryId(result.id);
    } catch (error) {
      console.error('Failed to create story:', error);
    }
  }, [createStory, language]);

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

  // Navigate to story when generation completes, clear localStorage
  useEffect(() => {
    if (progress?.status === 'completed' && generatingStoryId) {
      setStoredGeneratingId(null);
      navigate(`/story/${generatingStoryId}`);
    }
    if (progress?.status === 'failed' || progress?.status === 'cancelled') {
      setStoredGeneratingId(null);
    }
  }, [progress?.status, generatingStoryId, navigate]);

  // Show progress if we have a generatingStoryId (even before SSE connects, for instant feedback)
  const showProgress = generatingStoryId && progress?.status !== 'completed';

  return (
    <div className="min-h-screen p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
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
          <StoryGrid stories={stories} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
}
