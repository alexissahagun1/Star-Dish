import { useEffect, useMemo, useState } from 'react';

import { supabase } from '../lib/supabase';

type VoteCounts = {
  up: number;
  down: number;
  net: number;
};

async function fetchVoteCounts(platilloId: string): Promise<VoteCounts> {
  // MVP approach: fetch all votes for the dish and aggregate client-side.
  // For scale, replace with a SQL view or RPC returning aggregated counts.
  const { data, error } = await supabase
    .from('votes')
    .select('vote_type')
    .eq('platillo_id', platilloId);

  if (error) throw error;

  const up = (data ?? []).filter((v) => v.vote_type === 'UP').length;
  const down = (data ?? []).filter((v) => v.vote_type === 'DOWN').length;
  return { up, down, net: up - down };
}

export function usePlatilloVotes(platilloId: string | null) {
  const [counts, setCounts] = useState<VoteCounts>({ up: 0, down: 0, net: 0 });
  const [loading, setLoading] = useState<boolean>(!!platilloId);
  const enabled = useMemo(() => !!platilloId, [platilloId]);

  useEffect(() => {
    if (!platilloId) return;

    let cancelled = false;
    setLoading(true);

    fetchVoteCounts(platilloId)
      .then((c) => {
        if (cancelled) return;
        setCounts(c);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [platilloId]);

  useEffect(() => {
    if (!enabled || !platilloId) return;

    const channel = supabase
      .channel(`votes:${platilloId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'votes', filter: `platillo_id=eq.${platilloId}` },
        async () => {
          try {
            const c = await fetchVoteCounts(platilloId);
            setCounts(c);
          } catch {
            // best-effort realtime refresh
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [enabled, platilloId]);

  return { counts, loading };
}




