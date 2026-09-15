import { useEffect, useState } from 'react';
import { ArrowLeft, Clock3 } from 'lucide-react';
import { isHarfGame, supabase, formatCountdown, type Game } from '@/lib/supabase';
import { formatMarketListRange, isMarketBettingOpen, nextDrawWindow } from '@/lib/marketSchedule';

export function TimingsScreen({ onBack }: { onBack: () => void }) {
  const [games, setGames] = useState<Game[]>([]);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('games').select('*').order('created_at');
      if (data) {
        const list = data as Game[];
        setGames([...list.filter((g) => isHarfGame(g)), ...list.filter((g) => !isHarfGame(g))]);
      }
    })();
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  return (
    <div className="info-screen page-screen">
      <div className="page-title-row">
        <button type="button" className="back-button" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <span className="small-label">SCHEDULE</span>
          <h1>Game timings</h1>
        </div>
      </div>

      <p className="info-lead">
        Markets follow satta-king draw clocks (not hourly). Green window = day open → draw. Play Harf stays on its
        own cycle.
      </p>

      <div className="timing-list">
        {games.map((g) => {
          const win = !isHarfGame(g) ? nextDrawWindow(g.short_code, now) : null;
          const ms = win
            ? win.drawMs - now
            : g.next_result_at
              ? new Date(g.next_result_at).getTime() - now
              : 0;
          const open = isHarfGame(g)
            ? g.is_active && ms > 30000
            : isMarketBettingOpen(g, now);
          const range = !isHarfGame(g) ? formatMarketListRange(g, now) : '';
          return (
            <div key={g.id} className={`timing-card ${g.is_active ? '' : 'off'}`}>
              <div className="timing-left">
                <strong>{isHarfGame(g) ? 'Play Harf' : g.name}</strong>
                <small>
                  {isHarfGame(g) ? 'HARF' : g.short_code}
                  {range ? ` · ${range}` : ''} · Last: {g.result || '—'}
                </small>
              </div>
              <div className="timing-right">
                <Clock3 size={14} />
                <b>{formatCountdown(ms)}</b>
                <span className={`timing-badge ${open ? 'on' : 'off'}`}>{open ? 'OPEN' : 'CLOSED'}</span>
              </div>
            </div>
          );
        })}
        {games.length === 0 && <p className="empty-state">Loading games…</p>}
      </div>

      <div className="info-callout">
        <strong>Close window</strong>
        <p>
          Bets are blocked in the final 30 seconds before each draw. Jodi / Jantari / Crossing: min ₹100, no
          final-hour cap.
        </p>
      </div>
    </div>
  );
}
