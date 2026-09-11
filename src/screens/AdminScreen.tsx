import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase, formatCountdown, type Game, type Profile, type Bet, type ResultHistory } from '@/lib/supabase';
import {
  ShieldCheck,
  Users,
  Gamepad2,
  Clock3,
  ListOrdered,
  RefreshCw,
  ArrowLeft,
  LayoutDashboard,
} from 'lucide-react';

type AdminSection = 'overview' | 'games' | 'users' | 'bets' | 'results';

const SECTIONS: { id: AdminSection; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'games', label: 'Games' },
  { id: 'users', label: 'Users' },
  { id: 'bets', label: 'Bets' },
  { id: 'results', label: 'Results' },
];

export function AdminScreen({ onBack }: { onBack?: () => void }) {
  const { profile, signOut } = useAuth();
  const [section, setSection] = useState<AdminSection>('overview');
  const [games, setGames] = useState<Game[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [allBets, setAllBets] = useState<Bet[]>([]);
  const [pendingBets, setPendingBets] = useState<Bet[]>([]);
  const [results, setResults] = useState<ResultHistory[]>([]);
  const [editResult, setEditResult] = useState<Record<string, string>>({});
  const [creditAmt, setCreditAmt] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(Date.now());
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);

  const loadPendingForGame = async (gameId: string | null) => {
    if (!gameId) {
      setPendingBets([]);
      return;
    }
    const { data } = await supabase
      .from('bets')
      .select('*')
      .eq('game_id', gameId)
      .eq('status', 'pending')
      .order('created_at', { ascending: false })
      .limit(2000);
    if (data) setPendingBets(data as Bet[]);
  };

  const refreshLive = async () => {
    const gameId = selectedGameId;
    const [g, b] = await Promise.all([
      supabase.from('games').select('*').order('created_at'),
      supabase.from('bets').select('*').order('created_at', { ascending: false }).limit(150),
    ]);
    let nextId = gameId;
    if (g.data) {
      const list = g.data as Game[];
      setGames(list);
      if (!nextId && list[0]) {
        nextId = list[0].id;
        setSelectedGameId(list[0].id);
      }
    }
    if (b.data) setAllBets(b.data as Bet[]);
    await loadPendingForGame(nextId);
  };

  useEffect(() => {
    void loadAll();
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, []);

  // Auto-refresh digit totals while watching Games / Bets / Overview
  useEffect(() => {
    if (section !== 'games' && section !== 'bets' && section !== 'overview') return;
    void refreshLive();
    const poll = window.setInterval(() => {
      void refreshLive();
    }, 2500);
    return () => window.clearInterval(poll);
  }, [section, selectedGameId]);

  // Instant updates when any bet is inserted/updated
  useEffect(() => {
    const channel = supabase
      .channel(`admin-live-bets-${selectedGameId || 'all'}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'bets' }, () => {
        void refreshLive();
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [selectedGameId]);

  const loadAll = async () => {
    await supabase.rpc('try_settle_due');
    const [g, u, b, r] = await Promise.all([
      supabase.from('games').select('*').order('created_at'),
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('bets').select('*').order('created_at', { ascending: false }).limit(150),
      supabase.from('results_history').select('*').order('published_at', { ascending: false }).limit(50),
    ]);
    let nextSelected = selectedGameId;
    if (g.data) {
      const list = g.data as Game[];
      setGames(list);
      if (!nextSelected && list[0]) {
        nextSelected = list[0].id;
        setSelectedGameId(list[0].id);
      }
    }
    if (u.data) setUsers(u.data as Profile[]);
    if (b.data) setAllBets(b.data as Bet[]);
    if (r.data) setResults(r.data as ResultHistory[]);
    await loadPendingForGame(nextSelected);
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

  const pendingByDigit = useMemo(() => {
    const totals = Array.from({ length: 10 }, () => 0);
    for (const bet of pendingBets) {
      if (bet.selected_number >= 0 && bet.selected_number <= 9) {
        totals[bet.selected_number] += bet.amount;
      }
    }
    return totals;
  }, [pendingBets]);

  const pendingStakeTotal = useMemo(() => pendingByDigit.reduce((a, b) => a + b, 0), [pendingByDigit]);

  const lowestDigit = useMemo(() => {
    let best = 0;
    for (let i = 1; i < 10; i++) {
      if (pendingByDigit[i] < pendingByDigit[best]) best = i;
    }
    return best;
  }, [pendingByDigit]);

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
    if (result === undefined || result === '' || Number(result) < 0 || Number(result) > 99) {
      notify('Enter result 0–99');
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
    <div className="admin-app">
      <header className="admin-app-header">
        <button type="button" className="back-button light" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="admin-app-title">
          <span className="admin-badge">ADMIN</span>
          <strong>Control panel</strong>
          <small>{profile?.display_name}</small>
        </div>
        <button type="button" className="refresh-small light" onClick={loadAll} aria-label="Refresh">
          <RefreshCw size={16} />
        </button>
      </header>

      <nav className="admin-section-tabs">
        {SECTIONS.map((s) => (
          <button
            key={s.id}
            type="button"
            className={section === s.id ? 'active' : ''}
            onClick={() => setSection(s.id)}
          >
            {s.label}
          </button>
        ))}
      </nav>

      <div className="admin-app-body">
        {section === 'overview' && (
          <section className="admin-pane">
            <div className="admin-stats compact">
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
                  <span>Bets</span>
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

            <h2 className="admin-pane-title">
              <LayoutDashboard size={16} /> Live markets
            </h2>
            <div className="admin-game-list">
              {games.map((game) => {
                const ms = game.next_result_at ? new Date(game.next_result_at).getTime() - now : 0;
                return (
                  <button
                    key={game.id}
                    type="button"
                    className="admin-game-summary"
                    onClick={() => {
                      setSelectedGameId(game.id);
                      setSection('games');
                    }}
                  >
                    <div>
                      <strong>{game.name}</strong>
                      <small>
                        Last {game.result || '—'} · Next {formatCountdown(ms)}
                      </small>
                    </div>
                    <span className={`game-status ${game.is_active ? 'on' : 'off'}`}>
                      {game.is_active ? 'ON' : 'OFF'}
                    </span>
                  </button>
                );
              })}
            </div>
            <button type="button" className="logout-button" onClick={() => signOut()}>
              Logout admin
            </button>
          </section>
        )}

        {section === 'games' && (
          <section className="admin-pane">
            <h2 className="admin-pane-title">Game management</h2>
            <div className="filter-chips tight">
              {games.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  className={selectedGameId === g.id ? 'on' : ''}
                  onClick={() => setSelectedGameId(g.id)}
                >
                  {g.short_code}
                </button>
              ))}
            </div>

            {games
              .filter((g) => !selectedGameId || g.id === selectedGameId)
              .map((game) => {
                const ms = game.next_result_at ? new Date(game.next_result_at).getTime() - now : 0;
                return (
                  <div key={game.id} className="admin-game-card">
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

                    <p className="digit-totals-label">
                      Live open-round totals · {pendingBets.length} bets · {pendingStakeTotal} coins (lowest → {lowestDigit})
                      <span className="live-dot" aria-hidden /> Live
                    </p>
                    <div className="digit-totals">
                      {pendingByDigit.map((amt, n) => (
                        <div key={n} className={`digit-total ${n === lowestDigit ? 'lowest' : ''}`}>
                          <em>{n}</em>
                          <b>{amt}</b>
                        </div>
                      ))}
                    </div>

                    <div className="admin-game-actions stacked">
                      <input
                        className="result-input"
                        placeholder="Override 0-99"
                        value={editResult[game.id] ?? ''}
                        onChange={(e) =>
                          setEditResult((cur) => ({
                            ...cur,
                            [game.id]: e.target.value.replace(/[^0-9]/g, '').slice(0, 2),
                          }))
                        }
                        inputMode="numeric"
                      />
                      <button type="button" className="publish-button" onClick={() => publishOverride(game)}>
                        Override & settle
                      </button>
                      <button type="button" className="settle-button" onClick={() => forceSettle(game)}>
                        Auto settle now
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
            {games.length === 0 && <p className="empty-state">No games seeded yet.</p>}
          </section>
        )}

        {section === 'users' && (
          <section className="admin-pane">
            <h2 className="admin-pane-title">User management</h2>
            <input
              className="admin-search"
              placeholder="Search name, phone, or id..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="admin-user-cards">
              {filteredUsers.map((u) => (
                <div key={u.id} className="admin-user-card">
                  <div>
                    <strong>
                      {u.display_name}
                      {u.is_admin && <b className="admin-tag">ADMIN</b>}
                    </strong>
                    <small>
                      {u.phone || 'N/A'} · {u.coins} coins
                    </small>
                  </div>
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
                </div>
              ))}
              {filteredUsers.length === 0 && <p className="empty-state">No users found.</p>}
            </div>
          </section>
        )}

        {section === 'bets' && (
          <section className="admin-pane">
            <h2 className="admin-pane-title">Recent participations</h2>
            <div className="admin-bet-cards">
              {allBets.map((bet) => {
                const game = games.find((g) => g.id === bet.game_id);
                const user = users.find((u) => u.id === bet.user_id);
                return (
                  <div key={bet.id} className="admin-bet-card">
                    <span className="result-digit">{bet.selected_number}</span>
                    <div>
                      <strong>{user?.display_name ?? '—'}</strong>
                      <small>
                        {game?.short_code ?? '—'} · {bet.amount} coins · {new Date(bet.created_at).toLocaleString()}
                      </small>
                    </div>
                    <b className={bet.status === 'won' ? 'text-green' : bet.status === 'lost' ? 'text-red' : ''}>
                      {bet.status}
                    </b>
                  </div>
                );
              })}
              {allBets.length === 0 && <p className="empty-state">No bets yet.</p>}
            </div>
          </section>
        )}

        {section === 'results' && (
          <section className="admin-pane">
            <h2 className="admin-pane-title">Result history</h2>
            <div className="admin-bet-cards">
              {results.map((r) => {
                const game = games.find((g) => g.id === r.game_id);
                return (
                  <div key={r.id} className="admin-bet-card">
                    <span className="result-digit">{r.result}</span>
                    <div>
                      <strong>{game?.name ?? '—'}</strong>
                      <small>{new Date(r.published_at).toLocaleString()}</small>
                    </div>
                  </div>
                );
              })}
              {results.length === 0 && <p className="empty-state">No results yet.</p>}
            </div>
          </section>
        )}
      </div>

      {toast && (
        <div className="toast">
          <ShieldCheck size={16} /> {toast}
        </div>
      )}
    </div>
  );
}
