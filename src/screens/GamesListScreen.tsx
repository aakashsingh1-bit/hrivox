import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { HARF_SHORT_CODE, supabase, type Game } from '@/lib/supabase';
import { requestMarketResults } from '@/lib/results';
import {
  displayResultDigit,
  formatMarketListRange,
  isMarketBettingOpen,
  nextDrawWindow,
} from '@/lib/marketSchedule';
import { Coins } from 'lucide-react';

type Props = {
  onOpenGame: (gameId: string) => void;
};

export function GamesListScreen({ onOpenGame }: Props) {
  const { profile } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [now, setNow] = useState(Date.now());
  const [toast, setToast] = useState('');

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2800);
  };

  const loadGames = useCallback(async () => {
    try {
      await supabase.rpc('try_settle_due');
    } catch {
      /* ignore */
    }
    const { data } = await supabase.from('games').select('*').order('created_at');
    if (data) {
      const list = (data as Game[]).filter((g) => g.short_code !== HARF_SHORT_CODE);
      setGames(list);
      const anyDue = list.some((g) => {
        const win = nextDrawWindow(g.short_code);
        if (win && win.drawMs <= Date.now() + 15000) return true;
        return Boolean(g.next_result_at && new Date(g.next_result_at).getTime() <= Date.now() + 15000);
      });
      if (anyDue) void requestMarketResults();
    }
  }, []);

  useEffect(() => {
    void loadGames();
    void requestMarketResults().then(() => void loadGames());
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    // Keep scraping so XX → digit flips markets to red without waiting for draw due
    const scrape = window.setInterval(() => {
      void requestMarketResults().then(() => void loadGames());
    }, 60000);
    const reload = window.setInterval(() => {
      void loadGames();
    }, 5000);
    const onFocus = () => void loadGames();
    window.addEventListener('focus', onFocus);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onFocus();
    });
    return () => {
      window.clearInterval(tick);
      window.clearInterval(scrape);
      window.clearInterval(reload);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadGames]);

  const userCode = profile?.id ? profile.id.slice(0, 8).toUpperCase() : 'USER';

  return (
    <div className="market-list-screen">
      <header className="market-blue-header">
        <div className="market-user">
          <strong>
            {profile?.display_name ?? 'Player'} ({userCode})
          </strong>
          <span>{profile?.phone || '—'}</span>
        </div>
        <div className="market-coins">
          <Coins size={18} fill="#f4b831" color="#f4b831" />
          <b>{profile?.coins ?? 0}</b>
        </div>
      </header>

      <p className="market-list-hint">
        Green = betting open. Red = closed / result out (digit shown). Tap a red market for “bet closed”.
      </p>

      <div className="market-green-list">
        {games.map((g) => {
          const open = isMarketBettingOpen(g, now);
          const digit = displayResultDigit(g);
          const rowClass = !g.is_active ? 'off' : open ? 'open-bet' : 'result-out';
          return (
            <button
              key={g.id}
              type="button"
              className={`market-green-row ${rowClass}`}
              onClick={() => {
                if (open) onOpenGame(g.id);
                else notify('bet closed');
              }}
            >
              <span>
                {g.name.toUpperCase()} {formatMarketListRange(g, now)}
                {!open && digit ? ` · ${digit}` : ''}
                {!g.is_active ? ' · OFF' : ''}
              </span>
            </button>
          );
        })}
        {games.length === 0 && <p className="empty-state">No markets loaded.</p>}
      </div>
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
