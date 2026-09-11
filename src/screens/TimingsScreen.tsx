import { useEffect, useState } from 'react';
import { ArrowLeft, Clock3 } from 'lucide-react';
import { isHarfGame, supabase, formatCountdown, type Game } from '@/lib/supabase';

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
        Play Harf and all 5 markets run on a continuous <b>1-hour cycle</b>. Next result countdown is live below.
      </p>

      <div className="timing-list">
        {games.map((g) => {
          const ms = g.next_result_at ? new Date(g.next_result_at).getTime() - now : 0;
          return (
            <div key={g.id} className={`timing-card ${g.is_active ? '' : 'off'}`}>
              <div className="timing-left">
                <strong>{isHarfGame(g) ? 'Play Harf' : g.name}</strong>
                <small>
                  {isHarfGame(g) ? 'HARF' : g.short_code} · Last: {g.result || '—'}
                </small>
              </div>
              <div className="timing-right">
                <Clock3 size={14} />
                <b>{formatCountdown(ms)}</b>
                <span className={`timing-badge ${g.is_active ? 'on' : 'off'}`}>{g.is_active ? 'LIVE' : 'OFF'}</span>
              </div>
            </div>
          );
        })}
        {games.length === 0 && <p className="empty-state">Loading games…</p>}
      </div>

      <div className="info-callout">
        <strong>Close window</strong>
        <p>Bets are blocked in the final 30 seconds before each result is published.</p>
      </div>
    </div>
  );
}
