import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import type { StorySummary, StoryMeta, CreateStoryResponse, StoryAssets, RetryStoryResponse, RegenerateAssetsResponse } from '../types';
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

async function createStory(params: { prompt: string; language?: string; age?: number; style?: string; pro?: boolean; voice?: string }): Promise<CreateStoryResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch('/api/stories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ prompt: params.prompt, language: params.language, age: params.age, style: params.style, pro: params.pro, voice: params.voice }),
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

async function cancelStory(id: string): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/cancel`, { method: 'POST', headers: authHeaders });
  if (!res.ok) throw new Error('Failed to cancel story');
}

async function fetchPublicStories({
  search,
  limit,
}: {
  search?: string;
  limit?: number;
} = {}): Promise<StorySummary[]> {
  const params = new URLSearchParams();
  if (search) params.set('search', search);
  if (typeof limit === 'number') params.set('limit', String(limit));
  const url = `/api/stories/public${params.toString() ? `?${params}` : ''}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('Failed to fetch public stories');
  return res.json();
}

async function toggleStoryVisibility(id: string, isPublic: boolean): Promise<{ id: string; isPublic: boolean }> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/visibility`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ isPublic }),
  });
  if (!res.ok) throw new Error('Failed to toggle story visibility');
  return res.json();
}

export function useStories(enabled = true) {
  return useQuery({
    queryKey: ['stories'],
    queryFn: fetchStories,
    enabled,
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

export function usePublicStories(search?: string, limit?: number) {
  return useQuery({
    queryKey: ['stories', 'public', search ?? '', limit ?? 'all'],
    queryFn: () => fetchPublicStories({ search, limit }),
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

// ---------- Retry & Assets ----------

async function retryStory(id: string): Promise<RetryStoryResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/retry`, {
    method: 'POST',
    headers: authHeaders,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to retry story' }));
    throw new Error(error.error || 'Failed to retry story');
  }
  return res.json();
}

async function regenerateStoryAssets(id: string): Promise<RegenerateAssetsResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/regenerate-assets`, {
    method: 'POST',
    headers: authHeaders,
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to regenerate story assets' }));
    throw new Error(error.error || 'Failed to regenerate story assets');
  }
  return res.json();
}

async function fetchStoryAssets(id: string): Promise<StoryAssets> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/assets`, {
    headers: authHeaders,
  });
  if (!res.ok) throw new Error('Failed to fetch story assets');
  return res.json();
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

export function useStoryAssets(id: string | undefined, enabled = false) {
  return useQuery({
    queryKey: ['story-assets', id],
    queryFn: () => fetchStoryAssets(id!),
    enabled: !!id && enabled,
  });
}

// ---------- Generate Audio ----------

async function generateAudio({ id, voice }: { id: string; voice: string }): Promise<{ status: string }> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/generate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ voice }),
  });
  if (!res.ok) {
    const error = await res.json().catch(() => ({ error: 'Failed to generate audio' }));
    throw new Error(error.error || 'Failed to generate audio');
  }
  return res.json();
}

export function useGenerateAudio() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: generateAudio,
    onSuccess: (_data, { id }) => {
      queryClient.invalidateQueries({ queryKey: ['story', id] });
      queryClient.invalidateQueries({ queryKey: ['stories'] });
    },
  });
}
