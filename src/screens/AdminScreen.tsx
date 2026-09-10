import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase, formatCountdown, type Game, type Profile, type Bet, type ResultHistory } from '@/lib/supabase';
import { ShieldCheck, Users, Gamepad2, Clock3, ListOrdered, RefreshCw } from 'lucide-react';

export function AdminScreen({ onBack }: { onBack?: () => void }) {
  const { profile, signOut } = useAuth();
  const [games, setGames] = useState<Game[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [allBets, setAllBets] = useState<Bet[]>([]);
  const [results, setResults] = useState<ResultHistory[]>([]);
  const [editResult, setEditResult] = useState<Record<string, string>>({});
  const [creditAmt, setCreditAmt] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    loadAll();
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  const loadAll = async () => {
    await supabase.rpc('try_settle_due');
    const [g, u, b, r] = await Promise.all([
      supabase.from('games').select('*').order('created_at'),
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('bets').select('*').order('created_at', { ascending: false }).limit(80),
      supabase.from('results_history').select('*').order('published_at', { ascending: false }).limit(30),
    ]);
    if (g.data) setGames(g.data as Game[]);
    if (u.data) setUsers(u.data as Profile[]);
    if (b.data) setAllBets(b.data as Bet[]);
    if (r.data) setResults(r.data as ResultHistory[]);
  };

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2800);
  };

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users;
    return users.filter(
      (u) =>
        u.display_name.toLowerCase().includes(q) ||
        (u.phone || '').includes(q) ||
        u.id.toLowerCase().includes(q),
    );
  }, [users, search]);

  const toggleGame = async (game: Game) => {
    const { error } = await supabase.from('games').update({ is_active: !game.is_active }).eq('id', game.id);
    if (error) {
      notify(error.message);
      return;
    }
    await loadAll();
    notify(`${game.name} turned ${!game.is_active ? 'ON' : 'OFF'}`);
  };

  const publishOverride = async (game: Game) => {
    const result = editResult[game.id];
    if (result === undefined || result === '' || Number(result) < 0 || Number(result) > 9) {
      notify('Enter result 0–9');
      return;
    }
    const { error } = await supabase.rpc('admin_settle_game', {
      p_game_id: game.id,
      p_override: String(Number(result)),
    });
    if (error) {
      notify(error.message || 'Failed to publish');
      return;
    }
    await loadAll();
    notify(`${game.name} result set to ${result}`);
  };

  const forceSettle = async (game: Game) => {
    const { data, error } = await supabase.rpc('admin_settle_game', {
      p_game_id: game.id,
      p_override: null,
    });
    if (error) {
      notify(error.message || 'Settle failed');
      return;
    }
    await loadAll();
    notify(`${game.name} auto-settled → ${data}`);
  };

  const creditUser = async (userId: string) => {
    const amt = Number(creditAmt[userId] || 0);
    if (!amt) {
      notify('Enter credit amount (+/-)');
      return;
    }
    const { error } = await supabase.rpc('admin_credit_coins', {
      p_user_id: userId,
      p_amount: amt,
    });
    if (error) {
      notify(error.message || 'Credit failed');
      return;
    }
    setCreditAmt((c) => ({ ...c, [userId]: '' }));
    await loadAll();
    notify(`Coins updated by ${amt}`);
  };

  return (
    <div className="admin-screen">
      <header className="admin-header">
        <div>
          <span className="small-label">ADMIN PANEL</span>
          <h1>HRIVOX 900</h1>
        </div>
        <div className="admin-user">
          <span className="admin-badge">ADMIN</span>
          <span className="header-name">{profile?.display_name}</span>
          {onBack && (
            <button type="button" className="admin-back" onClick={onBack}>
              App
            </button>
          )}
          <button type="button" className="logout-button-small" onClick={signOut}>
            Logout
          </button>
        </div>
      </header>

      <div className="admin-stats">
        <div className="stat-card">
          <Users size={18} />
          <div>
            <strong>{users.length}</strong>
            <span>Users</span>
          </div>
        </div>
        <div className="stat-card">
          <Gamepad2 size={18} />
          <div>
            <strong>
              {games.filter((g) => g.is_active).length}/{games.length}
            </strong>
            <span>Active</span>
          </div>
        </div>
        <div className="stat-card">
          <ListOrdered size={18} />
          <div>
            <strong>{allBets.length}</strong>
            <span>Recent bets</span>
          </div>
        </div>
        <div className="stat-card">
          <Clock3 size={18} />
          <div>
            <strong>{results.length}</strong>
            <span>Results</span>
          </div>
        </div>
      </div>

      <section className="admin-section">
        <div className="section-top">
          <h2>Game management</h2>
          <button type="button" className="refresh-small" onClick={loadAll}>
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
        <div className="admin-game-list">
          {games.map((game) => {
            const ms = game.next_result_at ? new Date(game.next_result_at).getTime() - now : 0;
            return (
              <div key={game.id} className="admin-game-row">
                <div className="admin-game-info">
                  <strong>
                    {game.name} ({game.short_code})
                  </strong>
                  <small>
                    Result: {game.result || '--'} · Next: {formatCountdown(ms)}
                  </small>
                  <span className={`game-status ${game.is_active ? 'on' : 'off'}`}>
                    {game.is_active ? 'ON' : 'OFF'}
                  </span>
                </div>
                <div className="admin-game-actions">
                  <input
                    className="result-input"
                    placeholder="0-9"
                    value={editResult[game.id] ?? ''}
                    onChange={(e) =>
                      setEditResult((cur) => ({
                        ...cur,
                        [game.id]: e.target.value.replace(/[^0-9]/g, '').slice(0, 1),
                      }))
                    }
                    inputMode="numeric"
                  />
                  <button type="button" className="publish-button" onClick={() => publishOverride(game)}>
                    Override
                  </button>
                  <button type="button" className="settle-button" onClick={() => forceSettle(game)}>
                    Auto settle
                  </button>
                  <button
                    type="button"
                    className={`toggle-button ${game.is_active ? 'on' : 'off'}`}
                    onClick={() => toggleGame(game)}
                  >
                    {game.is_active ? 'Turn OFF' : 'Turn ON'}
                  </button>
                </div>
              </div>
            );
          })}
          {games.length === 0 && <p className="empty-state">No games — run the Supabase migration to seed 5 games.</p>}
        </div>
      </section>

      <section className="admin-section">
        <h2>User management</h2>
        <input
          className="admin-search"
          placeholder="Search name, phone, or id..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="admin-user-list">
          <div className="admin-user-header">
            <span>Name</span>
            <span>Phone</span>
            <span>Coins</span>
            <span>Credit</span>
          </div>
          {filteredUsers.map((u) => (
            <div key={u.id} className="admin-user-row">
              <span>
                {u.display_name}
                {u.is_admin && <b className="admin-tag">ADMIN</b>}
              </span>
              <span>{u.phone || 'N/A'}</span>
              <span>{u.coins}</span>
              <span>
                <div className="credit-row">
                  <input
                    placeholder="+/-"
                    value={creditAmt[u.id] ?? ''}
                    onChange={(e) =>
                      setCreditAmt((c) => ({
                        ...c,
                        [u.id]: e.target.value.replace(/[^0-9\-]/g, '').slice(0, 7),
                      }))
                    }
                    inputMode="numeric"
                  />
                  <button type="button" onClick={() => creditUser(u.id)}>
                    Apply
                  </button>
                </div>
              </span>
            </div>
          ))}
          {filteredUsers.length === 0 && <p className="empty-state">No users found.</p>}
        </div>
      </section>

      <section className="admin-section">
        <h2>Recent participations</h2>
        <div className="admin-bet-list">
          <div className="admin-bet-header">
            <span>User</span>
            <span>Game</span>
            <span>#</span>
            <span>Amt</span>
            <span>Status</span>
          </div>
          {allBets.map((bet) => {
            const game = games.find((g) => g.id === bet.game_id);
            const user = users.find((u) => u.id === bet.user_id);
            return (
              <div key={bet.id} className="admin-bet-row">
                <span>{user?.display_name ?? '—'}</span>
                <span>{game?.short_code ?? '—'}</span>
                <span>{bet.selected_number}</span>
                <span>{bet.amount}</span>
                <span className={bet.status === 'won' ? 'text-green' : bet.status === 'lost' ? 'text-red' : ''}>
                  {bet.status}
                </span>
              </div>
            );
          })}
          {allBets.length === 0 && <p className="empty-state">No bets yet.</p>}
        </div>
      </section>

      <section className="admin-section">
        <h2>Result history</h2>
        <div className="admin-bet-list">
          {results.map((r) => {
            const game = games.find((g) => g.id === r.game_id);
            return (
              <div key={r.id} className="admin-bet-row">
                <span>{game?.name ?? '—'}</span>
                <span>{r.result}</span>
                <span style={{ gridColumn: 'span 3' }}>{new Date(r.published_at).toLocaleString()}</span>
              </div>
            );
          })}
          {results.length === 0 && <p className="empty-state">No results yet.</p>}
        </div>
      </section>

      {toast && (
        <div className="toast">
          <ShieldCheck size={16} /> {toast}
        </div>
      )}
    </div>
  );
}
