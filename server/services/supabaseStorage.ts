import { getSupabase } from './supabase.js';
import { config } from '../config.js';
import type { StoryMeta, StoryStatus, Scenario, PageStatus } from '../../shared/types.js';

const BUCKET = 'story-images';

// ---------- Story CRUD ----------

export async function createStory(id: string, prompt: string, status: StoryStatus, userId?: string, language?: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('stories').insert({
    id,
    prompt,
    status,
    user_id: userId ?? null,
    language: language ?? 'ro',
    current_phase: 'Generating story scenario...',
    progress_message: 'Creating your story...',
  });
  if (error) throw new Error(`Failed to create story: ${error.message}`);
}

export async function updateStoryStatus(id: string, status: StoryStatus): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('stories').update({ status }).eq('id', id);
  if (error) throw new Error(`Failed to update story status: ${error.message}`);
}

export interface StoryProgressUpdate {
  completed_pages?: number;
  failed_pages?: number[];
  current_phase?: string;
  progress_message?: string;
  status?: StoryStatus;
}

export async function updateStoryProgress(id: string, progress: StoryProgressUpdate): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from('stories').update(progress).eq('id', id);
  if (error) throw new Error(`Failed to update story progress: ${error.message}`);
}

export async function updateStoryScenario(
  id: string,
  scenario: Scenario,
  status: StoryStatus,
  prompt: string,
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('stories')
    .update({
      scenario,
      title: scenario.title,
      target_age: scenario.targetAge,
      total_pages: scenario.pages.length,
      status,
      prompt,
    })
    .eq('id', id);
  if (error) throw new Error(`Failed to update story scenario: ${error.message}`);
}

export async function updatePageStatus(id: string, pageNumber: number, status: PageStatus): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.rpc('update_page_status', {
    story_id: id,
    page_number: pageNumber,
    new_status: status,
  });
  if (error) throw new Error(`Failed to update page status: ${error.message}`);
}

interface StoryRow {
  id: string;
  prompt: string;
  status: StoryStatus;
  created_at: string;
  title: string | null;
  target_age: number | null;
  scenario: Scenario | null;
  cover_image_url: string | null;
  total_pages: number;
  completed_pages: number;
  failed_pages: number[];
  current_phase: string | null;
  progress_message: string | null;
  user_id: string | null;
  is_public: boolean;
}

function rowToStoryMeta(row: StoryRow): StoryMeta {
  return {
    id: row.id,
    prompt: row.prompt,
    status: row.status as StoryStatus,
    createdAt: row.created_at,
    scenario: row.scenario ?? undefined,
    coverImage: row.cover_image_url ?? undefined,
    userId: row.user_id ?? undefined,
    isPublic: row.is_public ?? false,
  };
}

export async function getStory(id: string): Promise<StoryMeta | null> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .eq('id', id)
    .single();
  if (error) {
    if (error.code === 'PGRST116') return null; // not found
    throw new Error(`Failed to get story: ${error.message}`);
  }
  return rowToStoryMeta(data as StoryRow);
}

export async function listStories(limit = 27): Promise<StoryMeta[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list stories: ${error.message}`);
  return (data as StoryRow[]).map(rowToStoryMeta);
}

export async function listStoriesByUser(userId: string, limit = 50): Promise<StoryMeta[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw new Error(`Failed to list user stories: ${error.message}`);
  return (data as StoryRow[]).map(rowToStoryMeta);
}

export async function deleteStory(id: string, userId?: string): Promise<boolean> {
  const supabase = getSupabase();

  // Delete images from storage - try user-scoped path first, then legacy path
  if (userId) {
    const storagePath = `${userId}/${id}`;
    const { data: files } = await supabase.storage.from(BUCKET).list(storagePath);
    if (files && files.length > 0) {
      const paths = files.map(f => `${storagePath}/${f.name}`);
      await supabase.storage.from(BUCKET).remove(paths);
    }
  }
  // Also clean up legacy path (images stored without userId prefix)
  const { data: legacyFiles } = await supabase.storage.from(BUCKET).list(id);
  if (legacyFiles && legacyFiles.length > 0) {
    const legacyPaths = legacyFiles.map(f => `${id}/${f.name}`);
    await supabase.storage.from(BUCKET).remove(legacyPaths);
  }

  // Delete from DB
  const { error } = await supabase.from('stories').delete().eq('id', id);
  if (error) throw new Error(`Failed to delete story: ${error.message}`);
  return true;
}

export async function getActiveGenerations(): Promise<StoryMeta[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('stories')
    .select('*')
    .not('status', 'in', '("completed","failed")')
    .order('created_at', { ascending: false });
  if (error) throw new Error(`Failed to get active generations: ${error.message}`);
  return (data as StoryRow[]).map(rowToStoryMeta);
}

// ---------- Public Stories ----------

export async function updateStoryVisibility(id: string, isPublic: boolean): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from('stories')
    .update({ is_public: isPublic })
    .eq('id', id);
  if (error) throw new Error(`Failed to update story visibility: ${error.message}`);
}

export async function listPublicStories(search?: string, limit = 50): Promise<StoryMeta[]> {
  const supabase = getSupabase();
  let query = supabase
    .from('stories')
    .select('*')
    .eq('is_public', true)
    .eq('status', 'completed')
    .order('created_at', { ascending: false })
    .limit(limit);

  if (search && search.trim()) {
    const term = `%${search.trim()}%`;
    query = query.or(`title.ilike."${term}",prompt.ilike."${term}"`);
  }

  const { data, error } = await query;
  if (error) throw new Error(`Failed to list public stories: ${error.message}`);
  return (data as StoryRow[]).map(rowToStoryMeta);
}

// ---------- Image Storage ----------

export async function uploadImage(userId: string | undefined, storyId: string, filename: string, base64Data: string): Promise<string> {
  const supabase = getSupabase();
  const buffer = Buffer.from(base64Data, 'base64');
  const storagePath = userId ? `${userId}/${storyId}/${filename}` : `${storyId}/${filename}`;

  const { error } = await supabase.storage
    .from(BUCKET)
    .upload(storagePath, buffer, {
      contentType: 'image/png',
      upsert: true,
    });
  if (error) throw new Error(`Failed to upload image: ${error.message}`);

  return getImageUrl(userId, storyId, filename);
}

export function getImageUrl(userId: string | undefined, storyId: string, filename: string): string {
  if (userId) {
    return `${config.supabaseUrl}/storage/v1/object/public/${BUCKET}/${userId}/${storyId}/${filename}`;
  }
  return `${config.supabaseUrl}/storage/v1/object/public/${BUCKET}/${storyId}/${filename}`;
}
