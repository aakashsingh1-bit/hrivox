import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { supabase, type Game, type ResultHistory } from '@/lib/supabase';

export function ResultsHistoryScreen({ onBack }: { onBack: () => void }) {
  const [games, setGames] = useState<Game[]>([]);
  const [results, setResults] = useState<ResultHistory[]>([]);
  const [filter, setFilter] = useState<string>('all');

  useEffect(() => {
    void (async () => {
      const [g, r] = await Promise.all([
        supabase.from('games').select('*').order('created_at'),
        supabase.from('results_history').select('*').order('published_at', { ascending: false }).limit(100),
      ]);
      if (g.data) setGames(g.data as Game[]);
      if (r.data) setResults(r.data as ResultHistory[]);
    })();
  }, []);

  const filtered = useMemo(
    () => (filter === 'all' ? results : results.filter((r) => r.game_id === filter)),
    [results, filter],
  );

  const nameOf = (id: string) => games.find((g) => g.id === id)?.name ?? '—';

  return (
    <div className="info-screen page-screen">
      <div className="page-title-row">
        <button type="button" className="back-button" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div>
          <span className="small-label">HISTORY</span>
          <h1>Previous results</h1>
        </div>
      </div>

      <div className="filter-chips">
        <button type="button" className={filter === 'all' ? 'on' : ''} onClick={() => setFilter('all')}>
          All
        </button>
        {games.map((g) => (
          <button
            key={g.id}
            type="button"
            className={filter === g.id ? 'on' : ''}
            onClick={() => setFilter(g.id)}
          >
            {g.short_code}
          </button>
        ))}
      </div>

      <div className="results-archive">
        {filtered.map((r) => (
          <div key={r.id} className="result-archive-row">
            <span className="result-digit">{r.result}</span>
            <div>
              <strong>{nameOf(r.game_id)}</strong>
              <small>{new Date(r.published_at).toLocaleString()}</small>
            </div>
          </div>
        ))}
        {filtered.length === 0 && <p className="empty-state">No results published yet.</p>}
      </div>
    </div>
  );
}
