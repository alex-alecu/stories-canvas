import type {
  CreateStoryResponse,
  GenerateAudioResponse,
  RegenerateAssetsResponse,
  RegeneratePageAudioResponse,
  RegeneratePageImageResponse,
  RetryStoryResponse,
  StoryAssets,
  StoryMeta,
  StoryMode,
  StoryReaction,
  StoryReactionResponse,
  StoryViewResponse,
  VoiceKey,
} from '../types';
import type { StorySummary } from '../types';
import { getAuthHeaders } from './authHeaders';

async function readError(res: Response, fallback: string): Promise<Error> {
  const error = await res.json().catch(() => ({ error: fallback }));
  return new Error(error.error || fallback);
}

export async function fetchStories(): Promise<StorySummary[]> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch('/api/stories', {
    headers: authHeaders,
  });
  if (!res.ok) throw new Error('Failed to fetch stories');
  return res.json();
}

export async function fetchUserStories(): Promise<StorySummary[]> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch('/api/stories/mine', {
    headers: authHeaders,
  });
  if (!res.ok) throw new Error('Failed to fetch user stories');
  return res.json();
}

export async function fetchStory(id: string): Promise<StoryMeta> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}`, {
    headers: authHeaders,
  });
  if (!res.ok) throw new Error('Failed to fetch story');
  return res.json();
}

export async function recordStoryView(id: string): Promise<StoryViewResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/view`, {
    method: 'POST',
    headers: authHeaders,
  });
  if (!res.ok) throw new Error('Failed to record story view');
  return res.json();
}

export async function setStoryReaction({
  id,
  reaction,
  feedback,
}: {
  id: string;
  reaction: StoryReaction | null;
  feedback?: string | null;
}): Promise<StoryReactionResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/reaction`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ reaction, feedback }),
  });
  if (!res.ok) {
    throw await readError(res, 'Failed to update story reaction');
  }
  return res.json();
}

export async function createStory(params: {
  prompt: string;
  language?: string;
  age?: number;
  style?: string;
  storyMode?: StoryMode;
  voice?: string;
}): Promise<CreateStoryResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch('/api/stories', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({
      prompt: params.prompt,
      language: params.language,
      age: params.age,
      style: params.style,
      storyMode: params.storyMode,
      voice: params.voice,
    }),
  });
  if (!res.ok) {
    throw await readError(res, 'Failed to create story');
  }
  return res.json();
}

export async function removeStory(id: string): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}`, { method: 'DELETE', headers: authHeaders });
  if (!res.ok) throw new Error('Failed to delete story');
}

export async function cancelStory(id: string): Promise<void> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/cancel`, { method: 'POST', headers: authHeaders });
  if (!res.ok) throw new Error('Failed to cancel story');
}

export async function fetchPublicStories({
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

export async function toggleStoryVisibility(id: string, isPublic: boolean): Promise<{ id: string; isPublic: boolean }> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/visibility`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ isPublic }),
  });
  if (!res.ok) throw new Error('Failed to toggle story visibility');
  return res.json();
}

export async function retryStory(id: string): Promise<RetryStoryResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/retry`, {
    method: 'POST',
    headers: authHeaders,
  });
  if (!res.ok) {
    throw await readError(res, 'Failed to retry story');
  }
  return res.json();
}

export async function regenerateStoryAssets(id: string): Promise<RegenerateAssetsResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/regenerate-assets`, {
    method: 'POST',
    headers: authHeaders,
  });
  if (!res.ok) {
    throw await readError(res, 'Failed to regenerate story assets');
  }
  return res.json();
}

export async function generateStoryAudio({ id, voice }: { id: string; voice: VoiceKey }): Promise<GenerateAudioResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/generate-audio`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ voice }),
  });
  if (!res.ok) {
    throw await readError(res, 'Failed to generate narration');
  }
  return res.json();
}

export async function regeneratePageImage({
  id,
  pageNumber,
  feedback,
  mode,
}: {
  id: string;
  pageNumber: number;
  feedback: string;
  mode: 'fast' | 'pro';
}): Promise<RegeneratePageImageResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/pages/${pageNumber}/regenerate-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ feedback, mode }),
  });
  if (!res.ok) {
    throw await readError(res, 'Failed to regenerate page image');
  }
  return res.json();
}

export async function regeneratePageAudio({
  id,
  pageNumber,
  text,
}: {
  id: string;
  pageNumber: number;
  text: string;
}): Promise<RegeneratePageAudioResponse> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/pages/${pageNumber}/script-audio`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw await readError(res, 'Failed to update page script and narration');
  }
  return res.json();
}

export async function fetchStoryAssets(id: string): Promise<StoryAssets> {
  const authHeaders = await getAuthHeaders();
  const res = await fetch(`/api/stories/${id}/assets`, {
    headers: authHeaders,
  });
  if (!res.ok) throw new Error('Failed to fetch story assets');
  return res.json();
}
