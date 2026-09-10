import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase, formatCountdown, type Game } from '@/lib/supabase';
import { ChevronRight, Coins, RefreshCw } from 'lucide-react';

const TILE = ['purple', 'pink', 'cyan', 'green', 'orange'] as const;

type Props = {
  mode: 'full' | 'harf';
  onOpenGame: (gameId: string) => void;
};

export function GamesListScreen({ mode, onOpenGame }: Props) {
  const { profile, refreshProfile } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState('');

  useEffect(() => {
    load();
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const load = async () => {
    try {
      await supabase.rpc('try_settle_due');
    } catch {
      /* ignore */
    }
    const { data } = await supabase.from('games').select('*').order('created_at');
    if (data) setGames(data as Game[]);
  };

  const title = mode === 'harf' ? 'Play Harf' : 'Play Game';
  const subtitle =
    mode === 'harf'
      ? 'Single-digit harf bets · pick a market'
      : 'Full number board · pick a market to play';

  return (
    <div className="games-list-screen">
      <header className="games-list-head">
        <div>
          <span className="small-label">{mode === 'harf' ? 'HARF MODE' : 'MARKETS'}</span>
          <h1>{title}</h1>
          <p>{subtitle}</p>
        </div>
        <div className="home-coins list-coins">
          <Coins size={16} />
          <b>{profile?.coins ?? 0}</b>
        </div>
      </header>

      <div className={`mode-banner ${mode}`}>
        {mode === 'harf'
          ? 'Harf = bet on one digit only (faster entry). Same 1→8 payout.'
          : 'Full play = bet amounts on numbers 0–9. Lowest total wins each hour.'}
      </div>

      <div className="games-list">
        {games.map((g, i) => {
          const ms = g.next_result_at ? new Date(g.next_result_at).getTime() - now : 0;
          return (
            <button
              key={g.id}
              type="button"
              className={`game-list-card ${TILE[i % 5]}`}
              onClick={() => onOpenGame(g.id)}
              disabled={!g.is_active}
            >
              <div className="gl-left">
                <strong>{g.result || '--'}</strong>
                <span>{g.short_code}</span>
              </div>
              <div className="gl-mid">
                <b>{g.name}</b>
                <small>
                  {g.is_active ? 'OPEN' : 'OFF'} · Next {formatCountdown(ms)}
                </small>
                <small className="gl-mode">{mode === 'harf' ? 'Harf table' : 'Full table'}</small>
              </div>
              <ChevronRight size={20} />
            </button>
          );
        })}
        {games.length === 0 && <p className="empty-state">No games loaded.</p>}
      </div>

      <button
        type="button"
        className="refresh-large"
        style={{ margin: '16px auto', display: 'flex' }}
        onClick={async () => {
          await load();
          await refreshProfile();
          setToast('Updated');
          window.setTimeout(() => setToast(''), 1500);
        }}
      >
        <RefreshCw size={16} /> Refresh
      </button>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
