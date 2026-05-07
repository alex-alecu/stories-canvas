import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { StorySummary, StoryMeta, StoryAssets, StoryMode, StoryReaction, VoiceKey } from '../types';
import { getOfflineStory, listOfflineStorySummaries } from '../lib/offlineStories';
import {
  cancelStory,
  createStory,
  fetchPublicStories,
  fetchStories,
  fetchStory,
  fetchStoryAssets,
  fetchUserStories,
  generateStoryAudio,
  recordStoryView,
  regenerateStoryAssets,
  removeStory,
  retryStory,
  setStoryReaction,
  toggleStoryVisibility,
} from '../lib/storyApi';

function applyReactionState<T extends { id: string; likeCount?: number; dislikeCount?: number; myReaction?: StoryReaction | null }>(
  story: T,
  reaction: StoryReaction | null,
): T {
  const previousReaction = story.myReaction ?? null;
  let likeCount = story.likeCount ?? 0;
  let dislikeCount = story.dislikeCount ?? 0;

  if (previousReaction === 'like') likeCount = Math.max(0, likeCount - 1);
  if (previousReaction === 'dislike') dislikeCount = Math.max(0, dislikeCount - 1);
  if (reaction === 'like') likeCount += 1;
  if (reaction === 'dislike') dislikeCount += 1;

  return {
    ...story,
    likeCount,
    dislikeCount,
    myReaction: reaction,
  };
}

function applyReactionResponse<T extends { id: string; likeCount?: number; dislikeCount?: number; myReaction?: StoryReaction | null }>(
  story: T,
  response: { likeCount: number; dislikeCount: number; myReaction: StoryReaction | null },
): T {
  return {
    ...story,
    likeCount: response.likeCount,
    dislikeCount: response.dislikeCount,
    myReaction: response.myReaction,
  };
}

async function fetchStoriesWithOfflineFallback(): Promise<StorySummary[]> {
  try {
    return await fetchStories();
  } catch (error) {
    const offlineStories = await listOfflineStorySummaries().catch(() => []);
    if (offlineStories.length > 0) return offlineStories;
    throw error;
  }
}

async function fetchUserStoriesWithOfflineFallback(): Promise<StorySummary[]> {
  try {
    return await fetchUserStories();
  } catch (error) {
    const offlineStories = await listOfflineStorySummaries().catch(() => []);
    if (offlineStories.length > 0) return offlineStories;
    throw error;
  }
}

async function fetchPublicStoriesWithOfflineFallback({
  search,
  limit,
}: {
  search?: string;
  limit?: number;
} = {}): Promise<StorySummary[]> {
  try {
    return await fetchPublicStories({ search, limit });
  } catch (error) {
    const offlineStories = await listOfflineStorySummaries(search).catch(() => []);
    if (offlineStories.length > 0) {
      return typeof limit === 'number' ? offlineStories.slice(0, limit) : offlineStories;
    }
    throw error;
  }
}

async function fetchStoryWithOfflineFallback(id: string): Promise<StoryMeta> {
  try {
    return await fetchStory(id);
  } catch (error) {
    const offlineStory = await getOfflineStory(id).catch(() => null);
    if (offlineStory) return offlineStory.story;
    throw error;
  }
}

export function useStories(enabled = true) {
  return useQuery({
    queryKey: ['stories'],
    queryFn: fetchStoriesWithOfflineFallback,
    enabled,
    refetchInterval: 10_000, // Poll for updates on generating stories
  });
}

export function useUserStories(enabled = true) {
  return useQuery({
    queryKey: ['stories', 'mine'],
    queryFn: fetchUserStoriesWithOfflineFallback,
    enabled,
  });
}

export function useStory(id: string | undefined) {
  return useQuery({
    queryKey: ['story', id],
    queryFn: () => fetchStoryWithOfflineFallback(id!),
    enabled: !!id,
  });
}

export function useCreateStory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: createStory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
    },
  });
}

export function useDeleteStory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: removeStory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      queryClient.invalidateQueries({ queryKey: ['stories', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['stories', 'public'] });
    },
  });
}

export function useCancelStory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: cancelStory,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      queryClient.invalidateQueries({ queryKey: ['stories', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['stories', 'public'] });
    },
  });
}

export function usePublicStories(search?: string, limit?: number, enabled = true) {
  return useQuery({
    queryKey: ['stories', 'public', search ?? '', limit ?? 'all'],
    queryFn: () => fetchPublicStoriesWithOfflineFallback({ search, limit }),
    enabled,
  });
}

export function useRecordStoryView() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: recordStoryView,
    onSuccess: (data) => {
      queryClient.setQueryData<StoryMeta>(['story', data.id], old => (
        old ? { ...old, viewCount: data.viewCount } : old
      ));
      queryClient.setQueriesData<StorySummary[]>({ queryKey: ['stories'] }, old => (
        old?.map(story => story.id === data.id ? { ...story, viewCount: data.viewCount } : story) ?? old
      ));
    },
  });
}

export function useStoryReaction(storyId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: setStoryReaction,
    onMutate: async ({ id, reaction }) => {
      await queryClient.cancelQueries({ queryKey: ['story', id] });

      const previousStory = queryClient.getQueryData<StoryMeta>(['story', id]);
      if (previousStory) {
        queryClient.setQueryData<StoryMeta>(['story', id], applyReactionState(previousStory, reaction));
      }

      return { id, previousStory };
    },
    onError: (_error, _variables, context) => {
      if (context?.previousStory) {
        queryClient.setQueryData<StoryMeta>(['story', context.id], context.previousStory);
      }
    },
    onSuccess: (data) => {
      queryClient.setQueryData<StoryMeta>(['story', data.id], old => (
        old ? applyReactionResponse(old, data) : old
      ));
      queryClient.setQueriesData<StorySummary[]>({ queryKey: ['stories'] }, old => (
        old?.map(story => story.id === data.id ? applyReactionResponse(story, data) : story) ?? old
      ));
    },
    onSettled: (_data, _error, variables) => {
      if (storyId && variables.id === storyId) {
        queryClient.invalidateQueries({ queryKey: ['story', storyId] });
      }
    },
  });
}

export function useToggleVisibility() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, isPublic }: { id: string; isPublic: boolean }) =>
      toggleStoryVisibility(id, isPublic),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      queryClient.invalidateQueries({ queryKey: ['stories', 'mine'] });
      queryClient.invalidateQueries({ queryKey: ['stories', 'public'] });
    },
  });
}

export function useRetryStory() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: retryStory,
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['story', id] });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
    },
  });
}

export function useRegenerateStoryAssets() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: regenerateStoryAssets,
    onSuccess: (_data, id) => {
      queryClient.invalidateQueries({ queryKey: ['story', id] });
      queryClient.invalidateQueries({ queryKey: ['story-assets', id] });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
    },
  });
}

export function useGenerateStoryAudio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: generateStoryAudio,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['story', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
      queryClient.invalidateQueries({ queryKey: ['stories', 'mine'] });
    },
  });
}

export function useStoryAssets(id: string | undefined, enabled = false) {
  return useQuery({
    queryKey: ['story-assets', id],
    queryFn: () => fetchStoryAssets(id!),
    enabled: !!id && enabled,
  });
}
