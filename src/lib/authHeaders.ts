export async function getAuthHeaders(): Promise<Record<string, string>> {
  const { supabase } = await import('./supabase');
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.access_token) {
    return { Authorization: `Bearer ${session.access_token}` };
  }
  return {};
}
