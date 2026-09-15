import { supabase, type Bet, type Game } from '@/lib/supabase';

/** Prefer Vercel scrape API (avoids Supabase Edge 403); fall back to Edge Function. */
export async function requestMarketResults(): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token || '';

    const vercelRes = await fetch('/api/scrape-results', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: '{}',
    });

    if (vercelRes.ok) {
      const data = await vercelRes.json().catch(() => ({}));
      if (data?.error) return { ok: false, error: String(data.error) };
      return { ok: true };
    }

    // Local/dev without Vercel API, or misconfigured — try Edge Function
    const { data, error } = await supabase.functions.invoke('fetch-results', { body: {} });
    if (error) {
      return {
        ok: false,
        error: error.message || `Vercel scrape HTTP ${vercelRes.status}`,
      };
    }
    if (data && typeof data === 'object' && 'error' in data && (data as { error?: string }).error) {
      return { ok: false, error: String((data as { error: string }).error) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function loadGame(gameId: string): Promise<Game | null> {
  const { data } = await supabase.from('games').select('*').eq('id', gameId).maybeSingle();
  return (data as Game) || null;
}

export async function loadMyGameBets(userId: string, gameId: string, limit = 40): Promise<Bet[]> {
  const { data } = await supabase
    .from('bets')
    .select('*')
    .eq('user_id', userId)
    .eq('game_id', gameId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return (data as Bet[]) || [];
}

export function kindLabel(kind: string | null | undefined) {
  if (kind === 'open') return 'Open';
  if (kind === 'close') return 'Close';
  if (kind === 'jodi') return 'Jodi';
  if (kind === 'crossing') return 'Crossing';
  return 'Bet';
}

export function summarizeRoundOutcome(bets: Bet[], resultDigit: number) {
  const settled = bets.filter((b) => b.status === 'won' || b.status === 'lost');
  if (!settled.length) return null;
  const won = settled.filter((b) => b.status === 'won');
  const stake = settled.reduce((s, b) => s + b.amount, 0);
  const payout = won.reduce((s, b) => s + (b.payout || 0), 0);
  return {
    type: won.length > 0 ? ('won' as const) : ('lost' as const),
    digit: resultDigit,
    stake,
    payout,
  };
}
