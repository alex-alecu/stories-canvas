const activeGenerations = new Map<string, AbortController>();

export function startTrackedGeneration(storyId: string): AbortController {
  const controller = new AbortController();
  activeGenerations.set(storyId, controller);
  return controller;
}

export function finishTrackedGeneration(storyId: string): void {
  activeGenerations.delete(storyId);
}

export function getTrackedGeneration(storyId: string): AbortController | undefined {
  return activeGenerations.get(storyId);
}

export function isGenerationActive(storyId: string): boolean {
  return activeGenerations.has(storyId);
}

export function listTrackedGenerationIds(): string[] {
  return [...activeGenerations.keys()];
}

export function abortAllTrackedGenerations(): void {
  for (const controller of activeGenerations.values()) {
    controller.abort();
  }
}
