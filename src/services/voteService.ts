import type { VoteType } from '../types/database';
import { supabase } from '../lib/supabase';

/**
 * Atomic vote toggle using Supabase RPC `toggle_platillo_vote`.
 *
 * Notes:
 * - We accept userId to match the requested signature, but the database function
 *   uses auth.uid() as the source of truth for security.
 */
export async function togglePlatilloVote(
  userId: string,
  platilloId: string,
  voteType: VoteType
): Promise<void> {
  // Optional lightweight guard (does not affect security; RPC enforces auth.uid()).
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) throw new Error('Not authenticated');
  if (userId && user.id !== userId) throw new Error('User mismatch');

  const { error } = await supabase.rpc('toggle_platillo_vote', {
    platillo_id: platilloId,
    vote_type: voteType,
  });

  if (error) throw error;
}




