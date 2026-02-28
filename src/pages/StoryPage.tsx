import { useParams, Link } from 'react-router-dom';
import { useStory } from '../hooks/useStories';
import { useStoryGeneration } from '../hooks/useStoryGeneration';
import StoryViewer from '../components/StoryViewer';
import GenerationProgress from '../components/GenerationProgress';
import { useLanguage } from '../i18n/LanguageContext';

export default function StoryPage() {
  const { id } = useParams<{ id: string }>();
  const { data: story, isLoading, error } = useStory(id);
  const isGenerating = story?.status !== 'completed' && story?.status !== 'failed';
  const { progress } = useStoryGeneration(isGenerating ? id ?? null : null);
  const { t } = useLanguage();

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

  // If story is still generating, show progress
  if (isGenerating) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4">
        <div>
          <GenerationProgress progress={progress} />
          <div className="text-center mt-4">
            <Link to="/" className="text-primary-500 dark:text-primary-400 hover:text-primary-600 dark:hover:text-primary-300 font-medium text-sm">
              &larr; {t.backHome}
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Show the story viewer
  if (story.scenario) {
    return <StoryViewer storyId={story.id} scenario={story.scenario} />;
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
