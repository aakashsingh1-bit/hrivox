import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth';
import {
  supabase,
  formatCountdown,
  isHarfGame,
  getSupportWhatsApp,
  clearSupportWhatsAppCache,
  type Game,
  type Profile,
  type Bet,
  type ResultHistory,
} from '@/lib/supabase';
import { effectiveBettingCloseMs, hasActiveBettingCloseOverride } from '@/lib/marketSchedule';
import { kindLabel } from '@/lib/results';
import {
  ShieldCheck,
  Users,
  Gamepad2,
  Clock3,
  ListOrdered,
  RefreshCw,
  ArrowLeft,
  LayoutDashboard,
  Settings,
} from 'lucide-react';

type AdminSection = 'overview' | 'games' | 'users' | 'bets' | 'results' | 'limits' | 'settings';
type BetHistoryFilter = '24h' | '7d' | '30d' | 'all';

const SECTIONS: { id: AdminSection; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'games', label: 'Games' },
  { id: 'limits', label: 'Min & payout' },
  { id: 'users', label: 'Users' },
  { id: 'bets', label: 'Entries' },
  { id: 'results', label: 'Results' },
  { id: 'settings', label: 'Settings' },
];

function sortGames(list: Game[]) {
  return [...list].sort((a, b) => {
    if (isHarfGame(a) && !isHarfGame(b)) return -1;
    if (!isHarfGame(a) && isHarfGame(b)) return 1;
    return a.created_at.localeCompare(b.created_at);
  });
}

function gameLabel(game: Game | undefined) {
  if (!game) return '—';
  return isHarfGame(game) ? `${game.name} · HARF` : `${game.short_code}`;
}

/** Local datetime-local value from ISO / Date. */
function toLocalInputValue(iso: string | null | undefined) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInputValue(local: string): string | null {
  if (!local.trim()) return null;
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

type BetSlipGroup = {
  key: string;
  game_id: string;
  bet_kind: string | null | undefined;
  status: string;
  created_at: string;
  entries: { number: number; amount: number; payout: number }[];
  totalAmount: number;
  totalPayout: number;
};

/** Group one Continue / place_bets batch into a single slip card. */
function groupUserBetSlips(bets: Bet[]): BetSlipGroup[] {
  const buckets = new Map<string, BetSlipGroup>();
  const ordered: BetSlipGroup[] = [];

  for (const bet of bets) {
    const t = new Date(bet.created_at).getTime();
    const bucket = Math.floor(t / 2000); // same ~2s window = one place
    const key = `${bet.game_id}|${bet.bet_kind || 'jodi'}|${bet.status}|${bucket}`;
    let group = buckets.get(key);
    if (!group) {
      group = {
        key,
        game_id: bet.game_id,
        bet_kind: bet.bet_kind,
        status: bet.status,
        created_at: bet.created_at,
        entries: [],
        totalAmount: 0,
        totalPayout: 0,
      };
      buckets.set(key, group);
      ordered.push(group);
    }
    group.entries.push({
      number: bet.selected_number,
      amount: bet.amount,
      payout: bet.payout || 0,
    });
    group.totalAmount += bet.amount;
    group.totalPayout += bet.payout || 0;
    if (new Date(bet.created_at) < new Date(group.created_at)) {
      group.created_at = bet.created_at;
    }
  }

  for (const g of ordered) {
    g.entries.sort((a, b) => a.number - b.number);
  }
  return ordered;
}

function formatSlipNumbers(entries: BetSlipGroup['entries']) {
  return entries
    .map((e) => `${String(e.number).padStart(2, '0')}(${e.amount})`)
    .join(', ');
}

export function AdminScreen({ onBack }: { onBack?: () => void }) {
  const { profile, signOut } = useAuth();
  const [section, setSection] = useState<AdminSection>('overview');
  const [games, setGames] = useState<Game[]>([]);
  const [users, setUsers] = useState<Profile[]>([]);
  const [allBets, setAllBets] = useState<Bet[]>([]);
  const [pendingBets, setPendingBets] = useState<Bet[]>([]);
  const [results, setResults] = useState<ResultHistory[]>([]);
  const [editResult, setEditResult] = useState<Record<string, string>>({});
  const [payoutEdit, setPayoutEdit] = useState<Record<string, string>>({});
  const [closeEdit, setCloseEdit] = useState<Record<string, string>>({});
  const [creditAmt, setCreditAmt] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [toast, setToast] = useState('');
  const [now, setNow] = useState(Date.now());
  const [selectedGameId, setSelectedGameId] = useState<string | null>(null);
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [userBets, setUserBets] = useState<Bet[]>([]);
  const [userBetFilter, setUserBetFilter] = useState<BetHistoryFilter>('24h');
  const [userBetsLoading, setUserBetsLoading] = useState(false);
  const [supportWa, setSupportWa] = useState('');
  const [supportWaEdit, setSupportWaEdit] = useState('');
  const [supportSaving, setSupportSaving] = useState(false);
  const [limitEdit, setLimitEdit] = useState<
    Record<string, { minBet: string; minCross: string; payout: string }>
  >({});
  const [limitSaving, setLimitSaving] = useState<string | null>(null);

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
      const list = sortGames(g.data as Game[]);
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

  // Auto-refresh digit totals while watching Games / Entries / Overview
  useEffect(() => {
    if (section !== 'games' && section !== 'bets' && section !== 'overview') return;
    void refreshLive();
    const poll = window.setInterval(() => {
      void refreshLive();
    }, 2500);
    return () => window.clearInterval(poll);
  }, [section, selectedGameId]);

  // Instant updates when any entry is inserted/updated
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
      supabase
        .from('results_history')
        .select('*')
        .gte('published_at', new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString())
        .order('published_at', { ascending: false })
        .limit(100),
    ]);
    let nextSelected = selectedGameId;
    if (g.data) {
      const list = sortGames(g.data as Game[]);
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

  const selectedGame = useMemo(
    () => games.find((g) => g.id === selectedGameId) ?? null,
    [games, selectedGameId],
  );
  const isSelectedHarf = isHarfGame(selectedGame);

  const pendingByDigit = useMemo(() => {
    const size = isSelectedHarf ? 10 : 100;
    const totals = Array.from({ length: size }, () => 0);
    for (const bet of pendingBets) {
      if (bet.selected_number >= 0 && bet.selected_number < size) {
        totals[bet.selected_number] += bet.amount;
      }
    }
    return totals;
  }, [pendingBets, isSelectedHarf]);

  const pendingStakeTotal = useMemo(() => pendingByDigit.reduce((a, b) => a + b, 0), [pendingByDigit]);

  const lowestDigit = useMemo(() => {
    if (pendingBets.length === 0) return 0;
    const map = new Map<number, number>();
    for (const bet of pendingBets) {
      map.set(bet.selected_number, (map.get(bet.selected_number) || 0) + bet.amount);
    }
    let bestNum = [...map.keys()][0] ?? 0;
    let bestAmt = map.get(bestNum) ?? 0;
    for (const [n, amt] of map) {
      if (amt < bestAmt || (amt === bestAmt && n < bestNum)) {
        bestNum = n;
        bestAmt = amt;
      }
    }
    return bestNum;
  }, [pendingBets]);

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
    const max = isHarfGame(game) ? 9 : 99;
    if (result === undefined || result === '' || Number(result) < 0 || Number(result) > max) {
      notify(`Enter result 0–${max}`);
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

  const savePayoutMultiplier = async (game: Game) => {
    const raw = payoutEdit[game.id] ?? String(game.payout_multiplier ?? (isHarfGame(game) ? 8 : 90));
    const mult = Number(raw);
    if (!Number.isInteger(mult) || mult < 1 || mult > 1000) {
      notify('Payout must be whole number 1–1000');
      return;
    }
    const { error } = await supabase.rpc('admin_set_payout_multiplier', {
      p_game_id: game.id,
      p_multiplier: mult,
    });
    if (error) {
      notify(error.message || 'Failed to update payout');
      return;
    }
    await loadAll();
    notify(`${game.name} payout set to 1 → ${mult}`);
  };

  const draftLimits = (game: Game) => {
    const cur = limitEdit[game.id];
    if (cur) return cur;
    return {
      minBet: String(game.min_bet ?? (isHarfGame(game) ? 1 : 100)),
      minCross: String(game.min_bet_crossing ?? (isHarfGame(game) ? 1 : 10)),
      payout: String(game.payout_multiplier ?? (isHarfGame(game) ? 8 : 90)),
    };
  };

  const setDraftField = (gameId: string, field: 'minBet' | 'minCross' | 'payout', value: string) => {
    setLimitEdit((prev) => {
      const game = games.find((g) => g.id === gameId);
      const harf = game ? isHarfGame(game) : false;
      const existing = prev[gameId] ?? {
        minBet: String(game?.min_bet ?? (harf ? 1 : 100)),
        minCross: String(game?.min_bet_crossing ?? (harf ? 1 : 10)),
        payout: String(game?.payout_multiplier ?? (harf ? 8 : 90)),
      };
      return {
        ...prev,
        [gameId]: {
          ...existing,
          [field]: value.replace(/[^0-9]/g, '').slice(0, 6),
        },
      };
    });
  };

  const saveGameLimits = async (game: Game) => {
    const d = draftLimits(game);
    const minBet = Number(d.minBet);
    const minCross = Number(d.minCross);
    const payout = Number(d.payout);
    if (!Number.isInteger(minBet) || minBet < 1 || minBet > 100000) {
      notify('Min amount must be whole number 1–100000');
      return;
    }
    if (!Number.isInteger(minCross) || minCross < 1 || minCross > 100000) {
      notify('Crossing min must be whole number 1–100000');
      return;
    }
    if (!Number.isInteger(payout) || payout < 1 || payout > 1000) {
      notify('Payout must be whole number 1–1000 (earn = stake × N)');
      return;
    }
    setLimitSaving(game.id);
    const { error } = await supabase.rpc('admin_set_game_limits', {
      p_game_id: game.id,
      p_min_bet: minBet,
      p_min_bet_crossing: isHarfGame(game) ? minBet : minCross,
      p_payout_multiplier: payout,
    });
    setLimitSaving(null);
    if (error) {
      notify(error.message || 'Failed to save limits');
      return;
    }
    setLimitEdit((prev) => {
      const next = { ...prev };
      delete next[game.id];
      return next;
    });
    await loadAll();
    notify(
      `${game.name}: min ${minBet}${isHarfGame(game) ? '' : ` / crossing ${minCross}`} · payout 1 → ${payout}`,
    );
  };

  const saveBettingClose = async (game: Game) => {
    const local = closeEdit[game.id] ?? toLocalInputValue(game.betting_closes_at);
    const iso = fromLocalInputValue(local);
    if (!iso) {
      notify('Pick a valid last-entry date/time');
      return;
    }
    // Prefer RPC; also write table directly so scrap cannot "lose" the value via UI confusion
    const { error } = await supabase.rpc('admin_set_betting_closes_at', {
      p_game_id: game.id,
      p_closes_at: iso,
    });
    if (error) {
      const { error: upErr } = await supabase
        .from('games')
        .update({ betting_closes_at: iso })
        .eq('id', game.id);
      if (upErr) {
        notify(error.message || upErr.message || 'Failed to set last entry time');
        return;
      }
    }
    setCloseEdit((cur) => {
      const next = { ...cur };
      delete next[game.id];
      return next;
    });
    await loadAll();
    notify(`${game.name} last entry time saved (override ON)`);
  };

  const clearBettingClose = async (game: Game) => {
    const { error } = await supabase.rpc('admin_set_betting_closes_at', {
      p_game_id: game.id,
      p_closes_at: null,
    });
    if (error) {
      const { error: upErr } = await supabase
        .from('games')
        .update({ betting_closes_at: null })
        .eq('id', game.id);
      if (upErr) {
        notify(error.message || upErr.message || 'Failed to clear');
        return;
      }
    }
    setCloseEdit((cur) => {
      const next = { ...cur };
      delete next[game.id];
      return next;
    });
    await loadAll();
    notify(`${game.name} back to scrap default close`);
  };

  const loadUserBets = async (userId: string, filter: BetHistoryFilter) => {
    setUserBetsLoading(true);
    let q = supabase
      .from('bets')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(500);
    const sinceMs =
      filter === '24h'
        ? Date.now() - 24 * 60 * 60 * 1000
        : filter === '7d'
          ? Date.now() - 7 * 24 * 60 * 60 * 1000
          : filter === '30d'
            ? Date.now() - 30 * 24 * 60 * 60 * 1000
            : null;
    if (sinceMs) q = q.gte('created_at', new Date(sinceMs).toISOString());
    const { data, error } = await q;
    setUserBetsLoading(false);
    if (error) {
      notify(error.message || 'Could not load entries');
      setUserBets([]);
      return;
    }
    setUserBets((data as Bet[]) || []);
  };

  const openUser = (userId: string) => {
    setSelectedUserId(userId);
    setUserBetFilter('24h');
    void loadUserBets(userId, '24h');
  };

  const loadSupportWhatsApp = async () => {
    const n = await getSupportWhatsApp();
    setSupportWa(n);
    setSupportWaEdit(n);
  };

  const saveSupportWhatsApp = async () => {
    setSupportSaving(true);
    const { data, error } = await supabase.rpc('admin_set_support_whatsapp', {
      p_number: supportWaEdit,
    });
    setSupportSaving(false);
    if (error) {
      notify(error.message || 'Failed to save WhatsApp number');
      return;
    }
    clearSupportWhatsAppCache();
    const saved = typeof data === 'string' ? data : supportWaEdit.replace(/\D/g, '');
    setSupportWa(saved);
    setSupportWaEdit(saved);
    notify(`Support WhatsApp updated: +${saved}`);
  };

  useEffect(() => {
    if (section === 'settings') void loadSupportWhatsApp();
  }, [section]);

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

  const recordDeposit = async (userId: string) => {
    const amt = Number(creditAmt[userId] || 0);
    if (!amt || amt <= 0) {
      notify('Enter deposit amount (positive)');
      return;
    }
    const { error } = await supabase.rpc('admin_record_deposit', {
      p_user_id: userId,
      p_amount: amt,
      p_note: 'Admin confirmed deposit',
    });
    if (error) {
      notify(error.message || 'Deposit failed');
      return;
    }
    setCreditAmt((c) => ({ ...c, [userId]: '' }));
    await loadAll();
    notify(`Deposit Rs ${amt} recorded (+ coins; referral checked)`);
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
                  <span>Entries</span>
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
              <LayoutDashboard size={16} /> Live games
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
                      <strong>
                        {game.name}
                        {isHarfGame(game) ? ' · HARF' : ''}
                      </strong>
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
                  {isHarfGame(g) ? 'HARF' : g.short_code}
                </button>
              ))}
            </div>

            {games
              .filter((g) => !selectedGameId || g.id === selectedGameId)
              .map((game) => {
                const ms = game.next_result_at ? new Date(game.next_result_at).getTime() - now : 0;
                const harf = isHarfGame(game);
                const maxOverride = harf ? 9 : 99;
                const digitSlice = harf ? pendingByDigit : pendingByDigit.slice(0, 10);
                const extraMarket = harf
                  ? []
                  : pendingByDigit
                      .map((amt, n) => ({ n, amt }))
                      .filter((x) => x.n >= 10 && x.amt > 0);
                return (
                  <div key={game.id} className="admin-game-card">
                    <div className="admin-game-info">
                      <strong>
                        {game.name} ({game.short_code})
                        {harf ? <span className="harf-badge"> PLAY HARF</span> : <span className="market-badge"> MARKET</span>}
                      </strong>
                      <small>
                        Result: {game.result || '--'} · Next: {formatCountdown(ms)}
                        {game.external_name ? ` · Ext: ${game.external_name}` : ''}
                        {game.last_scraped_result
                          ? ` · Scraped ${game.last_scraped_result}${
                              game.last_scraped_at
                                ? ` @ ${new Date(game.last_scraped_at).toLocaleTimeString()}`
                                : ''
                            }`
                          : ''}
                      </small>
                      <span className={`game-status ${game.is_active ? 'on' : 'off'}`}>
                        {game.is_active ? 'ON' : 'OFF'}
                      </span>
                    </div>

                    <p className="digit-totals-label">
                      Live open-round totals · {pendingBets.length} entries · {pendingStakeTotal} coins (lowest →{' '}
                      {lowestDigit})
                      <span className="live-dot" aria-hidden /> Live
                    </p>
                    <div className="digit-totals">
                      {digitSlice.map((amt, n) => (
                        <div key={n} className={`digit-total ${n === lowestDigit ? 'lowest' : ''}`}>
                          <em>{n}</em>
                          <b>{amt}</b>
                        </div>
                      ))}
                    </div>
                    {extraMarket.length > 0 && (
                      <div className="digit-totals extra">
                        {extraMarket.map(({ n, amt }) => (
                          <div key={n} className={`digit-total ${n === lowestDigit ? 'lowest' : ''}`}>
                            <em>{n}</em>
                            <b>{amt}</b>
                          </div>
                        ))}
                      </div>
                    )}

                    <div className="admin-game-actions stacked">
                      {harf && (
                        <div className="admin-payout-row">
                          <label>
                            Wheel payout (1 → N)
                            <input
                              className="result-input"
                              value={
                                payoutEdit[game.id] ??
                                String(game.payout_multiplier ?? 8)
                              }
                              onChange={(e) =>
                                setPayoutEdit((cur) => ({
                                  ...cur,
                                  [game.id]: e.target.value.replace(/[^0-9]/g, '').slice(0, 4),
                                }))
                              }
                              inputMode="numeric"
                              placeholder="8"
                            />
                          </label>
                          <button
                            type="button"
                            className="publish-button"
                            onClick={() => void savePayoutMultiplier(game)}
                          >
                            Save payout
                          </button>
                        </div>
                      )}
                      {!harf && (
                        <div className="admin-payout-row">
                          <label>
                            Last entry time (stop users)
                            <input
                              className="result-input"
                              type="datetime-local"
                              value={
                                closeEdit[game.id] !== undefined
                                  ? closeEdit[game.id]
                                  : toLocalInputValue(game.betting_closes_at) ||
                                    toLocalInputValue(
                                      new Date(
                                        effectiveBettingCloseMs(game, now) ?? Date.now(),
                                      ).toISOString(),
                                    )
                              }
                              onChange={(e) =>
                                setCloseEdit((cur) => ({ ...cur, [game.id]: e.target.value }))
                              }
                            />
                          </label>
                          <div className="admin-close-actions">
                            <button
                              type="button"
                              className="publish-button"
                              onClick={() => void saveBettingClose(game)}
                            >
                              Save close
                            </button>
                            <button
                              type="button"
                              className="settle-button"
                              onClick={() => void clearBettingClose(game)}
                            >
                              Scrap default
                            </button>
                          </div>
                          <small className="admin-close-hint">
                            {hasActiveBettingCloseOverride(game, now)
                              ? `Override ON · users stop at ${new Date(game.betting_closes_at!).toLocaleString()} (scrap cannot change this until round ends)`
                              : `Scrap default · users stop at ${
                                  (() => {
                                    const ms = effectiveBettingCloseMs(game, now);
                                    return ms ? new Date(ms).toLocaleString() : '—';
                                  })()
                                }`}
                          </small>
                        </div>
                      )}
                      <input
                        className="result-input"
                        placeholder={`Override 0-${maxOverride}`}
                        value={editResult[game.id] ?? ''}
                        onChange={(e) =>
                          setEditResult((cur) => ({
                            ...cur,
                            [game.id]: e.target.value
                              .replace(/[^0-9]/g, '')
                              .slice(0, harf ? 1 : 2),
                          }))
                        }
                        inputMode="numeric"
                      />
                      <button type="button" className="publish-button" onClick={() => publishOverride(game)}>
                        Override & settle
                      </button>
                      <button
                        type="button"
                        className="settle-button"
                        onClick={() => forceSettle(game)}
                        disabled={!harf}
                        title={harf ? 'Lowest-total settle' : 'Markets need scraped/admin override'}
                      >
                        {harf ? 'Auto settle now' : 'Needs official result'}
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
            {!selectedUserId ? (
              <>
                <input
                  className="admin-search"
                  placeholder="Search name, phone, or id..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
                <div className="admin-user-cards">
                  {filteredUsers.map((u) => (
                    <div key={u.id} className="admin-user-card">
                      <button type="button" className="admin-user-open" onClick={() => openUser(u.id)}>
                        <strong>
                          {u.display_name}
                          {u.is_admin && <b className="admin-tag">ADMIN</b>}
                        </strong>
                        <small>
                          {u.phone || 'N/A'} · {u.coins} coins · tap for entry history
                        </small>
                      </button>
                      <div className="credit-row">
                        <input
                          placeholder="+/- coins"
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
                          Coins
                        </button>
                        <button
                          type="button"
                          className="deposit-btn"
                          onClick={() => recordDeposit(u.id)}
                          title="Record deposit (referral if ≥2000)"
                        >
                          Deposit
                        </button>
                      </div>
                    </div>
                  ))}
                  {filteredUsers.length === 0 && <p className="empty-state">No users found.</p>}
                </div>
              </>
            ) : (
              <div className="admin-user-detail">
                {(() => {
                  const u = users.find((x) => x.id === selectedUserId);
                  if (!u) return <p className="empty-state">User not found.</p>;
                  return (
                    <>
                      <div className="page-title-row tight">
                        <button
                          type="button"
                          className="back-button"
                          onClick={() => {
                            setSelectedUserId(null);
                            setUserBets([]);
                          }}
                          aria-label="Back"
                        >
                          <ArrowLeft size={18} />
                        </button>
                        <div>
                          <span className="small-label">USER ENTRIES</span>
                          <h2>{u.display_name}</h2>
                          <small>
                            {u.phone || 'N/A'} · {u.coins} coins · {u.id.slice(0, 8)}
                          </small>
                        </div>
                      </div>
                      <div className="filter-chips tight">
                        {(
                          [
                            { id: '24h' as const, label: 'Last 24h' },
                            { id: '7d' as const, label: '7 days' },
                            { id: '30d' as const, label: '30 days' },
                            { id: 'all' as const, label: 'All' },
                          ] as const
                        ).map((f) => (
                          <button
                            key={f.id}
                            type="button"
                            className={userBetFilter === f.id ? 'on' : ''}
                            onClick={() => {
                              setUserBetFilter(f.id);
                              void loadUserBets(u.id, f.id);
                            }}
                          >
                            {f.label}
                          </button>
                        ))}
                      </div>
                      {userBetsLoading ? (
                        <p className="empty-state">Loading entries…</p>
                      ) : userBets.length === 0 ? (
                        <p className="empty-state">No entries in this period.</p>
                      ) : (
                        <div className="admin-bet-cards">
                          {groupUserBetSlips(userBets).map((slip) => {
                            const game = games.find((g) => g.id === slip.game_id);
                            const nums = formatSlipNumbers(slip.entries);
                            return (
                              <div key={slip.key} className="admin-bet-card admin-slip-card">
                                <div className="admin-slip-body">
                                  <strong>
                                    {gameLabel(game)} · {kindLabel(slip.bet_kind)}
                                  </strong>
                                  <p className="admin-slip-nums">{nums}</p>
                                  <small>
                                    {slip.entries.length} number{slip.entries.length === 1 ? '' : 's'} · Total{' '}
                                    {slip.totalAmount} coins · {slip.status}
                                    {slip.status === 'won' ? ` · +${slip.totalPayout}` : ''}
                                    <br />
                                    {new Date(slip.created_at).toLocaleString()}
                                  </small>
                                </div>
                                <b
                                  className={
                                    slip.status === 'won'
                                      ? 'text-green'
                                      : slip.status === 'lost'
                                        ? 'text-red'
                                        : ''
                                  }
                                >
                                  {slip.status}
                                </b>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </>
                  );
                })()}
              </div>
            )}
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
                        {gameLabel(game)}
                        {bet.bet_kind ? ` · ${bet.bet_kind}` : ''} · #{bet.selected_number} · {bet.amount} coins ·{' '}
                        {new Date(bet.created_at).toLocaleString()}
                      </small>
                    </div>
                    <b className={bet.status === 'won' ? 'text-green' : bet.status === 'lost' ? 'text-red' : ''}>
                      {bet.status}
                    </b>
                  </div>
                );
              })}
              {allBets.length === 0 && <p className="empty-state">No entries yet.</p>}
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
                      <strong>
                        {game?.name ?? '—'}
                        {isHarfGame(game) ? ' · HARF' : ''}
                      </strong>
                      <small>{new Date(r.published_at).toLocaleString()}</small>
                    </div>
                  </div>
                );
              })}
              {results.length === 0 && <p className="empty-state">No results yet.</p>}
            </div>
          </section>
        )}

        {section === 'limits' && (
          <section className="admin-pane">
            <h2 className="admin-pane-title">Min amount & payout (per game)</h2>
            <p className="admin-close-hint" style={{ marginBottom: 12 }}>
              Win amount = stake × payout. Example: play 10 with payout 90 → earn 900 coins.
            </p>
            <div className="admin-limits-list">
              {sortGames(games).map((game) => {
                const harf = isHarfGame(game);
                const d = draftLimits(game);
                return (
                  <div key={game.id} className="admin-game-card">
                    <div className="admin-game-info">
                      <strong>
                        {game.name} ({game.short_code})
                        {harf ? (
                          <span className="harf-badge"> PLAY HARF</span>
                        ) : (
                          <span className="market-badge"> MARKET</span>
                        )}
                      </strong>
                      <small>
                        Live: min {game.min_bet ?? (harf ? 1 : 100)}
                        {!harf ? ` · crossing ${game.min_bet_crossing ?? 10}` : ''}
                        {' · '}payout 1 → {game.payout_multiplier ?? (harf ? 8 : 90)}
                      </small>
                    </div>
                    <div className="admin-game-actions stacked">
                      <div className="admin-payout-row admin-limits-row">
                        <label>
                          Min amount (Open / Jodi / Harf)
                          <input
                            className="result-input"
                            value={d.minBet}
                            onChange={(e) => setDraftField(game.id, 'minBet', e.target.value)}
                            inputMode="numeric"
                            placeholder={harf ? '1' : '100'}
                          />
                        </label>
                        {!harf && (
                          <label>
                            Min Crossing / Jodi Cut
                            <input
                              className="result-input"
                              value={d.minCross}
                              onChange={(e) => setDraftField(game.id, 'minCross', e.target.value)}
                              inputMode="numeric"
                              placeholder="10"
                            />
                          </label>
                        )}
                        <label>
                          Payout (1 → N)
                          <input
                            className="result-input"
                            value={d.payout}
                            onChange={(e) => setDraftField(game.id, 'payout', e.target.value)}
                            inputMode="numeric"
                            placeholder={harf ? '8' : '90'}
                          />
                        </label>
                        <button
                          type="button"
                          className="publish-button"
                          disabled={limitSaving === game.id}
                          onClick={() => void saveGameLimits(game)}
                        >
                          {limitSaving === game.id ? 'Saving…' : 'Save'}
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
              {games.length === 0 && <p className="empty-state">No games.</p>}
            </div>
          </section>
        )}

        {section === 'settings' && (
          <section className="admin-pane">
            <h2 className="admin-pane-title">
              <Settings size={16} /> App settings
            </h2>
            <div className="admin-payout-row" style={{ display: 'grid' }}>
              <label>
                Support WhatsApp (Add Money / chat)
                <input
                  className="result-input"
                  value={supportWaEdit}
                  onChange={(e) =>
                    setSupportWaEdit(e.target.value.replace(/[^0-9+]/g, '').slice(0, 16))
                  }
                  placeholder="919XXXXXXXXX"
                  inputMode="tel"
                />
              </label>
              <button
                type="button"
                className="publish-button"
                disabled={supportSaving}
                onClick={() => void saveSupportWhatsApp()}
              >
                {supportSaving ? 'Saving…' : 'Save number'}
              </button>
              <small className="admin-close-hint">
                Digits with country code (no spaces). Current live: +{supportWa || '…'}. Used for Add Money,
                Withdraw, Home WhatsApp button, and player Settings chat.
              </small>
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
