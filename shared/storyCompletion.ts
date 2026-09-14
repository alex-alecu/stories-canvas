import type { Scenario, StoryMeta } from './types.js';

export function storyAssetsAreStale(
  story: Pick<StoryMeta, 'scenario' | 'scenarioRevision' | 'renderedScenarioRevision'>,
): boolean {
  const scenarioRevision = Number.isInteger(story.scenarioRevision)
    ? Math.max(0, story.scenarioRevision!)
    : story.scenario ? 1 : 0;
  const renderedRevision = Number.isInteger(story.renderedScenarioRevision)
    ? Math.max(0, story.renderedScenarioRevision!)
    : scenarioRevision;
  if (scenarioRevision === 1 && renderedRevision === 0) return false;
  return scenarioRevision > renderedRevision;
}

export function summarizeStoryImages(scenario?: Scenario): {
  completedPages: number;
  totalPages: number;
  failedPages: number[];
} {
  const pages = scenario?.pages ?? [];
  const failedPages = pages.filter(page => page.status !== 'completed').map(page => page.pageNumber);
  return { completedPages: pages.length - failedPages.length, totalPages: pages.length, failedPages };
}

export function getStoryContinuationCopy(language: string): {
  message: string;
  action: string;
  pendingAction: string;
} {
  if (language === 'ro') {
    return {
      message: 'Generarea poveștii s-a oprit înainte ca toate imaginile să fie gata.',
      action: 'Continuă generarea',
      pendingAction: 'Generarea continuă…',
    };
  }
  return {
    message: 'Story generation stopped before all images were ready.',
    action: 'Continue generation',
    pendingAction: 'Continuing generation…',
  };
}
