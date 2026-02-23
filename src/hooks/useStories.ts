import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { StorySummary, StoryMeta, CreateStoryResponse } from '../types';

async function fetchStories(): Promise<StorySummary[]> {
  const res = await fetch('/api/stories');
  if (!res.ok) throw new Error('Failed to fetch stories');
  return res.json();
}

async function fetchStory(id: string): Promise<StoryMeta> {
  const res = await fetch(`/api/stories/${id}`);
  if (!res.ok) throw new Error('Failed to fetch story');
  return res.json();
}

async function createStory(prompt: string): Promise<CreateStoryResponse> {
  const res = await fetch('/api/stories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to create story' }));
    throw new Error(error.error || 'Failed to create story');
  }
  return res.json();
}

async function removeStory(id: string): Promise<void> {
  const res = await fetch(`/api/stories/${id}`, { method: 'DELETE' });
  if (!res.ok) throw new Error('Failed to delete story');
}

export function useStories() {
  return useQuery({
    queryKey: ['stories'],
    queryFn: fetchStories,
    refetchInterval: 10_000, // Poll for updates on generating stories
  });
}

export function useStory(id: string | undefined) {
  return useQuery({
    queryKey: ['story', id],
    queryFn: () => fetchStory(id!),
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
    },
  });
}
