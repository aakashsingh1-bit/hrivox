import { useEffect, useMemo, useState } from 'react';
import { ArrowLeft, Coins, FolderOpen } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase, type Game } from '@/lib/supabase';
import { playBetOk, playTap } from '@/lib/sounds';

type SubTab = 'open' | 'jantari' | 'crossing';
type SlipItem = { key: string; label: string; number: number; amount: number };

type Props = {
  gameId: string;
  onBack: () => void;
};

export function MarketPlayScreen({ gameId, onBack }: Props) {
  const { profile, refreshProfile } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [tab, setTab] = useState<SubTab>('open');
  const [slip, setSlip] = useState<SlipItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');

  // Open Game
  const [openNum, setOpenNum] = useState('');
  const [openAmt, setOpenAmt] = useState('');

  // Jantari
  const [jantari, setJantari] = useState<Record<number, string>>({});

  // Crossing
  const [jodiCut, setJodiCut] = useState(false);
  const [crossA, setCrossA] = useState('');
  const [crossB, setCrossB] = useState('');
  const [crossAmt, setCrossAmt] = useState('');
  const [crossRows, setCrossRows] = useState<{ label: string; number: number; amount: number }[]>([]);

  useEffect(() => {
    void (async () => {
      const { data } = await supabase.from('games').select('*').eq('id', gameId).maybeSingle();
      if (data) setGame(data as Game);
    })();
  }, [gameId]);

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2500);
  };

  const totalAmount = useMemo(() => {
    const slipTotal = slip.reduce((s, i) => s + i.amount, 0);
    const jantariTotal = Object.values(jantari).reduce((s, v) => s + (Number(v) || 0), 0);
    const crossTotal = crossRows.reduce((s, r) => s + r.amount, 0);
    if (tab === 'open') return slipTotal;
    if (tab === 'jantari') return jantariTotal;
    return crossTotal;
  }, [slip, jantari, crossRows, tab]);

  const addOpen = () => {
    playTap();
    const n = Number(openNum);
    const a = Number(openAmt);
    if (Number.isNaN(n) || n < 0 || n > 99) {
      notify('Enter number 0–99');
      return;
    }
    if (!a || a <= 0) {
      notify('Enter amount');
      return;
    }
    setSlip((cur) => [
      ...cur,
      { key: `${Date.now()}-${n}`, label: String(n).padStart(2, '0'), number: n, amount: a },
    ]);
    setOpenNum('');
    setOpenAmt('');
  };

  const addCrossing = () => {
    playTap();
    const a = Number(crossA);
    const b = Number(crossB);
    const amt = Number(crossAmt);
    if (Number.isNaN(a) || a < 0 || a > 9 || Number.isNaN(b) || b < 0 || b > 9) {
      notify('Enter digits 0–9 for both numbers');
      return;
    }
    if (!amt || amt <= 0) {
      notify('Enter amount');
      return;
    }
    const pair = a * 10 + b;
    const rows = [{ label: `${a}x${b}`, number: pair, amount: amt }];
    if (jodiCut && a !== b) {
      rows.push({ label: `${b}x${a}`, number: b * 10 + a, amount: amt });
    }
    setCrossRows((cur) => [...cur, ...rows]);
    setCrossA('');
    setCrossB('');
    setCrossAmt('');
  };

  const buildBets = (): { number: number; amount: number }[] => {
    if (tab === 'open') {
      return slip.map((s) => ({ number: s.number, amount: s.amount }));
    }
    if (tab === 'jantari') {
      return Object.entries(jantari)
        .filter(([, v]) => Number(v) > 0)
        .map(([num, amt]) => ({ number: Number(num), amount: Number(amt) }));
    }
    return crossRows.map((r) => ({ number: r.number, amount: r.amount }));
  };

  const submit = async () => {
    if (!profile || !game) return;
    const bets = buildBets();
    if (!bets.length) {
      notify('Add at least one entry');
      return;
    }
    const total = bets.reduce((s, b) => s + b.amount, 0);
    if (total > profile.coins) {
      notify('Insufficient coins');
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc('place_bets', {
      p_game_id: game.id,
      p_bets: bets,
    });
    setBusy(false);
    if (error) {
      notify(error.message || 'Bet failed');
      return;
    }
    playBetOk();
    await refreshProfile();
    setSlip([]);
    setJantari({});
    setCrossRows([]);
    notify('Bet placed ✓');
  };

  if (!game) {
    return (
      <div className="market-play-screen">
        <p className="empty-state">Loading…</p>
      </div>
    );
  }

  return (
    <div className="market-play-screen">
      <header className="market-play-header">
        <button type="button" className="market-back" onClick={onBack} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <strong>{tab === 'open' ? 'Open Game' : tab === 'jantari' ? 'Jantari' : 'Crossing'}</strong>
        <span className="market-play-coins">
          <Coins size={16} fill="#f4b831" color="#f4b831" />
          {profile?.coins ?? 0}
        </span>
      </header>

      <div className="market-play-body">
        {tab === 'open' && (
          <>
            <div className="mp-card">
              <label className="mp-field">
                <span>Number</span>
                <input
                  value={openNum}
                  onChange={(e) => setOpenNum(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                  placeholder="Enter Number"
                  inputMode="numeric"
                />
              </label>
            </div>
            <div className="mp-card">
              <label className="mp-field">
                <span>Amount</span>
                <input
                  value={openAmt}
                  onChange={(e) => setOpenAmt(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                  placeholder="Enter Amount"
                  inputMode="numeric"
                />
              </label>
              <button type="button" className="mp-add" onClick={addOpen}>
                Add
              </button>
            </div>
            {slip.length > 0 && (
              <div className="mp-slip">
                <div className="mp-slip-head">
                  <span>Number</span>
                  <span>Amount</span>
                </div>
                {slip.map((s) => (
                  <div key={s.key} className="mp-slip-row">
                    <span>{s.label}</span>
                    <span>{s.amount}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}

        {tab === 'jantari' && (
          <div className="jantari-grid">
            {Array.from({ length: 9 }, (_, row) => {
              const start = row * 10 + 1;
              const nums = Array.from({ length: 10 }, (_, i) => start + i).filter((n) => n <= 90);
              return (
                <div key={row} className="jantari-block">
                  <div className="jantari-nums">
                    {nums.map((n) => (
                      <span key={n}>{String(n).padStart(2, '0')}</span>
                    ))}
                  </div>
                  <div className="jantari-inputs">
                    {nums.map((n) => (
                      <input
                        key={n}
                        value={jantari[n] || ''}
                        onChange={(e) =>
                          setJantari((cur) => ({
                            ...cur,
                            [n]: e.target.value.replace(/[^0-9]/g, '').slice(0, 5),
                          }))
                        }
                        inputMode="numeric"
                        aria-label={`Amount for ${n}`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {tab === 'crossing' && (
          <>
            <div className="mp-card crossing-card">
              <label className="jodi-cut">
                <input type="checkbox" checked={jodiCut} onChange={(e) => setJodiCut(e.target.checked)} />
                Jodi Cut
              </label>
              <div className="cross-nums">
                <input
                  value={crossA}
                  onChange={(e) => setCrossA(e.target.value.replace(/[^0-9]/g, '').slice(0, 1))}
                  placeholder="Number"
                  inputMode="numeric"
                />
                <span className="cross-x">x</span>
                <input
                  value={crossB}
                  onChange={(e) => setCrossB(e.target.value.replace(/[^0-9]/g, '').slice(0, 1))}
                  placeholder="Number"
                  inputMode="numeric"
                />
              </div>
              <input
                className="cross-amt"
                value={crossAmt}
                onChange={(e) => setCrossAmt(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="Amount"
                inputMode="numeric"
              />
              <button type="button" className="mp-add" onClick={addCrossing}>
                + Add
              </button>
            </div>
            <div className="mp-slip">
              <div className="mp-slip-head">
                <span>Number</span>
                <span>Amount</span>
              </div>
              {crossRows.map((r, i) => (
                <div key={`${r.label}-${i}`} className="mp-slip-row">
                  <span>{r.label}</span>
                  <span>{r.amount}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {tab === 'open' && (
        <div className="mp-continue-bar">
          <div className="mp-total">
            <strong>₹ {totalAmount}/-</strong>
            <small>Total Amount</small>
          </div>
          <button type="button" className="mp-continue" onClick={submit} disabled={busy}>
            {busy ? '…' : 'Continue'}
          </button>
        </div>
      )}

      {(tab === 'jantari' || tab === 'crossing') && (
        <div className="mp-continue-bar">
          <div className="mp-total">
            <strong>₹ {totalAmount}/-</strong>
            <small>Total Amount</small>
          </div>
          <button type="button" className="mp-continue" onClick={submit} disabled={busy}>
            {busy ? '…' : 'Continue'}
          </button>
        </div>
      )}

      <nav className="market-sub-nav">
        {(
          [
            { id: 'open' as const, label: 'Open Game' },
            { id: 'jantari' as const, label: 'Jantari' },
            { id: 'crossing' as const, label: 'Crossing' },
          ] as const
        ).map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? 'active' : ''}
            onClick={() => {
              playTap();
              setTab(item.id);
            }}
          >
            <FolderOpen size={20} />
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
