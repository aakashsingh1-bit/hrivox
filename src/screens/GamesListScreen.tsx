import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { HARF_SHORT_CODE, supabase, type Game } from '@/lib/supabase';
import { Coins } from 'lucide-react';

type Props = {
  onOpenGame: (gameId: string) => void;
};

function formatRange(game: Game) {
  const end = game.next_result_at ? new Date(game.next_result_at) : null;
  const start = end ? new Date(end.getTime() - 60 * 60 * 1000) : null;
  const fmt = (d: Date) =>
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true }).toLowerCase();
  if (start && end) return `(${fmt(start)} - ${fmt(end)})`;
  return '(Hourly)';
}

export function GamesListScreen({ onOpenGame }: Props) {
  const { profile } = useAuth();
  const [games, setGames] = useState<Game[]>([]);

  useEffect(() => {
    void (async () => {
      try {
        await supabase.rpc('try_settle_due');
      } catch {
        /* ignore */
      }
      const { data } = await supabase.from('games').select('*').order('created_at');
      if (data) {
        // Markets only — Play Harf is a separate standalone game
        setGames((data as Game[]).filter((g) => g.short_code !== HARF_SHORT_CODE));
      }
    })();
  }, []);

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

      <div className="market-green-list">
        {games.map((g) => (
          <button
            key={g.id}
            type="button"
            className={`market-green-row ${g.is_active ? '' : 'off'}`}
            onClick={() => g.is_active && onOpenGame(g.id)}
            disabled={!g.is_active}
          >
            <span>
              {g.name.toUpperCase()} {formatRange(g)}
              {!g.is_active ? ' · OFF' : ''}
            </span>
          </button>
        ))}
        {games.length === 0 && <p className="empty-state">No markets loaded.</p>}
      </div>
    </div>
  );
}
