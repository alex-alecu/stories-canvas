import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import StoryInput from '../components/StoryInput';
import StoryGrid from '../components/StoryGrid';
import GenerationProgress from '../components/GenerationProgress';
import { useStories, useCreateStory } from '../hooks/useStories';
import { useStoryGeneration } from '../hooks/useStoryGeneration';

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
  const { progress } = useStoryGeneration(generatingStoryId);
  const navigate = useNavigate();

  // Sync generatingStoryId to localStorage
  useEffect(() => {
    setStoredGeneratingId(generatingStoryId);
  }, [generatingStoryId]);

  const handleCreateStory = useCallback(async (prompt: string) => {
    try {
      const result = await createStory.mutateAsync(prompt);
      setGeneratingStoryId(result.id);
    } catch (error) {
      console.error('Failed to create story:', error);
    }
  }, [createStory]);

  // Navigate to story when generation completes, clear localStorage
  useEffect(() => {
    if (progress?.status === 'completed' && generatingStoryId) {
      setStoredGeneratingId(null);
      navigate(`/story/${generatingStoryId}`);
    }
    if (progress?.status === 'failed') {
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
          <div className="max-w-2xl mx-auto mb-8 bg-red-50 border border-red-200 rounded-xl p-4 text-red-600 text-center">
            {createStory.error?.message || 'Nu s-a putut crea povestea. Te rugăm să încerci din nou.'}
          </div>
        )}

        {showProgress && (
          <div className="mb-8 flex justify-center">
            <GenerationProgress progress={progress ?? null} />
          </div>
        )}

        <div className="mt-4">
          <StoryGrid stories={stories} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
}
