import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase, formatCountdown, type Game, type ResultHistory } from '@/lib/supabase';
import { Volume2, Coins } from 'lucide-react';

export function PlayScreen({ onBack, half = false }: { onBack: () => void; half?: boolean }) {
  const { profile, refreshProfile } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [selectedGame, setSelectedGame] = useState(0);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [last5, setLast5] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [spinning, setSpinning] = useState(false);
  const [muted, setMuted] = useState(false);

  useEffect(() => {
    loadGames();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const settlePoll = window.setInterval(async () => {
      try {
        const { data } = await supabase.rpc('try_settle_due');
        if (data && data > 0) {
          setSpinning(true);
          window.setTimeout(() => setSpinning(false), 4000);
          await loadGames();
          await refreshProfile();
        }
      } catch {
        /* ignore */
      }
    }, 20000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(settlePoll);
    };
  }, []);

  useEffect(() => {
    if (games[selectedGame]) loadLast5(games[selectedGame].id);
  }, [selectedGame, games]);

  const loadGames = async () => {
    try {
      await supabase.rpc('try_settle_due');
    } catch {
      /* ignore */
    }
    const { data } = await supabase.from('games').select('*').order('created_at');
    if (data) setGames(data as Game[]);
  };

  const loadLast5 = async (gameId: string) => {
    const { data } = await supabase
      .from('results_history')
      .select('*')
      .eq('game_id', gameId)
      .order('published_at', { ascending: false })
      .limit(5);
    if (data) setLast5((data as ResultHistory[]).map((r) => r.result));
  };

  const game = games[selectedGame];
  const nextMs = game?.next_result_at ? new Date(game.next_result_at).getTime() - now : 0;
  const countdown = formatCountdown(nextMs);
  const bettingClosed = nextMs > 0 && nextMs < 30000;
  const totalAmount = Object.values(amounts).reduce((sum, v) => sum + (Number(v) || 0), 0);
  const last5Label = useMemo(() => (last5.length ? last5.join(' | ') : '—'), [last5]);

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2800);
  };

  const updateAmount = (num: number, val: string) => {
    setAmounts((cur) => ({ ...cur, [num]: val.replace(/[^0-9]/g, '').slice(0, 5) }));
  };

  const handleSubmit = async () => {
    if (!profile || !game) return;
    if (totalAmount === 0) {
      notify('Enter amount on at least one number');
      return;
    }
    if (!game.is_active) {
      notify('This game is currently OFF');
      return;
    }
    if (bettingClosed || nextMs <= 0) {
      notify('Betting closed for this round');
      return;
    }
    if (totalAmount > profile.coins) {
      notify('Insufficient coins');
      return;
    }

    setSubmitting(true);
    const bets = Object.entries(amounts)
      .filter(([, v]) => Number(v) > 0)
      .map(([num, amt]) => ({ number: Number(num), amount: Number(amt) }));

    const { error } = await supabase.rpc('place_bets', {
      p_game_id: game.id,
      p_bets: bets,
    });

    if (error) {
      notify(error.message || 'Failed to place bet');
      setSubmitting(false);
      return;
    }

    await refreshProfile();
    setAmounts({});
    notify(half ? 'Harf bet placed' : 'Bet placed successfully');
    setSubmitting(false);
  };

  if (!game) {
    return (
      <div className="play-screen play-casino">
        <p className="empty-state" style={{ color: '#ccc' }}>Loading games...</p>
      </div>
    );
  }

  return (
    <div className="play-screen play-casino">
      <div className="play-topbar">
        <button type="button" className="sound-btn" onClick={() => setMuted((m) => !m)} aria-label="Sound">
          <Volume2 size={18} style={{ opacity: muted ? 0.35 : 1 }} />
        </button>
        <div className="play-title-center">
          <small>{half ? 'PLAY HARF' : 'PLAY GAME'}</small>
          <strong>{game.name}</strong>
        </div>
        <button type="button" className="play-mini-back" onClick={onBack}>
          Home
        </button>
      </div>

      <div className={`wheel-art ${spinning ? 'spinning' : ''}`}>
        <div className="wheel-marker" />
        <div className="wheel-labels">
          {[1, 2, 3, 4, 5, 6, 7, 8, 9, 0].map((n) => (
            <span key={n}>{n}</span>
          ))}
        </div>
        <div className="wheel-center">
          <b>{game.result || '--'}</b>
          <small>LAST</small>
        </div>
      </div>

      <div className="play-stats casino-stats">
        <div>
          <span>Wallet</span>
          <strong>{profile?.coins ?? 0}</strong>
        </div>
        <div className="last5">
          <span>Last 5 Result</span>
          <strong>{last5Label}</strong>
        </div>
        <div>
          <span>Next Result</span>
          <strong>{countdown}</strong>
        </div>
        <div>
          <span>Last Result</span>
          <strong>{game.result || '--'}</strong>
        </div>
      </div>

      <div className="marquee-bar">
        <span>{game.is_active ? (bettingClosed ? 'BETTING CLOSED' : 'PLACE YOUR BET') : 'GAME OFF'}</span>
      </div>

      <div className="game-selector dark-selector">
        {games.map((g, i) => (
          <button
            key={g.id}
            type="button"
            className={selectedGame === i ? 'active' : ''}
            onClick={() => {
              setSelectedGame(i);
              setAmounts({});
            }}
          >
            {g.short_code}
          </button>
        ))}
      </div>

      <section className="number-grid casino-grid">
        {Array.from({ length: 10 }, (_, n) => (
          <label key={n} className={amounts[n] ? 'has-amount' : ''}>
            <span>{n}</span>
            <input
              value={amounts[n] || ''}
              onChange={(e) => updateAmount(n, e.target.value)}
              placeholder="Amount"
              inputMode="numeric"
              disabled={!game.is_active || bettingClosed}
            />
          </label>
        ))}
      </section>

      <div className="bet-summary casino-bet">
        <button type="button" className="total-btn" disabled>
          {totalAmount}/-
        </button>
        <button type="button" className="ok-btn" onClick={handleSubmit} disabled={submitting || !game.is_active || bettingClosed}>
          {submitting ? 'Saving...' : 'Bet Ok'}
        </button>
      </div>

      <p className="payout-note casino-note">
        Lowest-bet number wins · Payout <b>1 → 8</b>
      </p>

      {toast && (
        <div className="toast">
          <Coins size={16} /> {toast}
        </div>
      )}
    </div>
  );
}
