import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import StoryInput from '../components/StoryInput';
import StoryGrid from '../components/StoryGrid';
import GenerationProgress from '../components/GenerationProgress';
import { useStories, useCreateStory } from '../hooks/useStories';
import { useStoryGeneration } from '../hooks/useStoryGeneration';

export default function Home() {
  const [generatingStoryId, setGeneratingStoryId] = useState<string | null>(null);
  const { data: stories = [], isLoading } = useStories();
  const createStory = useCreateStory();
  const { progress } = useStoryGeneration(generatingStoryId);
  const navigate = useNavigate();

  const handleCreateStory = async (prompt: string) => {
    try {
      const result = await createStory.mutateAsync(prompt);
      setGeneratingStoryId(result.id);
    } catch (error) {
      console.error('Failed to create story:', error);
    }
  };

  // Navigate to story when generation completes
  useEffect(() => {
    if (progress?.status === 'completed' && generatingStoryId) {
      navigate(`/story/${generatingStoryId}`);
    }
  }, [progress?.status, generatingStoryId, navigate]);

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

        {generatingStoryId && progress && progress.status !== 'completed' && (
          <div className="mb-8 flex justify-center">
            <GenerationProgress progress={progress} />
          </div>
        )}

        <div className="mt-4">
          <StoryGrid stories={stories} isLoading={isLoading} />
        </div>
      </div>
    </div>
  );
}
