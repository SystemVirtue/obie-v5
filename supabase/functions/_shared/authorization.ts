import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export async function getAuthenticatedUserId(req: Request): Promise<string | null> {
  const authorization = req.headers.get('Authorization');
  if (!authorization?.startsWith('Bearer ')) return null;

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!url || !anonKey) {
    throw new Error('Supabase URL and anon key are required for request authorization');
  }

  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: { user }, error } = await authClient.auth.getUser();
  if (error) {
    if (error.status === 401 || error.status === 403) return null;
    throw error;
  }
  return user?.id ?? null;
}

export async function userOwnsPlayer(
  supabase: any,
  userId: string,
  playerId: string,
): Promise<boolean> {
  const { data: player, error } = await supabase
    .from('players')
    .select('owner_id')
    .eq('id', playerId)
    .maybeSingle();

  if (error) throw error;
  return player?.owner_id === userId;
}
