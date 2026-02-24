import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { StorySummary, StoryMeta, CreateStoryResponse } from '../types';
import { supabase } from '../lib/supabase';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  return {};
}

async function fetchStories(): Promise<StorySummary[]> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch('/api/stories', {
    headers: authHeaders,
  });
  if (!res.ok) throw new Error('Failed to fetch stories');
  return res.json();
}

async function fetchUserStories(): Promise<StorySummary[]> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch('/api/stories/mine', {
    headers: authHeaders,
  });
  if (!res.ok) throw new Error('Failed to fetch user stories');
  return res.json();
}

async function fetchStory(id: string): Promise<StoryMeta> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}`, {
    headers: authHeaders,
  });
  if (!res.ok) throw new Error('Failed to fetch story');
  return res.json();
}

async function createStory(prompt: string): Promise<CreateStoryResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch('/api/stories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ prompt }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to create story' }));
    throw new Error(error.error || 'Failed to create story');
  }
  return res.json();
}

async function removeStory(id: string): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}`, { method: 'DELETE', headers: authHeaders });
  if (!res.ok) throw new Error('Failed to delete story');
}

export function useStories() {
  return useQuery({
    queryKey: ['stories'],
    queryFn: fetchStories,
    refetchInterval: 10_000, // Poll for updates on generating stories
  });
}

export function useUserStories(enabled = true) {
  return useQuery({
    queryKey: ['stories', 'mine'],
    queryFn: fetchUserStories,
    enabled,
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
      queryClient.invalidateQueries({ queryKey: ['stories', 'mine'] });
    },
  });
}
