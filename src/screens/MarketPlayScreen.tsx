import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Coins, FolderOpen, Frown, PartyPopper } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { supabase, type Bet, type Game } from '@/lib/supabase';
import { playBetOk, playLose, playTap, playWin } from '@/lib/sounds';
import {
  assertMarketMinBet,
  expandCrossing,
  gameCrossingMinBet,
  gameMinBet,
  gamePayoutMult,
  JANTARI_DIGITS,
  sanitizeCrossingDigits,
} from '@/lib/crossing';
import { isMarketBettingOpen, scrapedDigit } from '@/lib/marketSchedule';
import {
  loadGame,
  loadMyGameBets,
  requestMarketResults,
  summarizeRoundOutcome,
} from '@/lib/results';

type SubTab = 'open' | 'jantari' | 'crossing';
type SlipItem = { key: string; label: string; number: number; amount: number; kind?: string };
type BetPayload = { number: number; amount: number; kind?: string };
type Outcome = { type: 'won' | 'lost'; digit: number; stake: number; payout: number };

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
  const [now, setNow] = useState(Date.now());
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const [openNum, setOpenNum] = useState('');
  const [openAmt, setOpenAmt] = useState('');
  const [openDigits, setOpenDigits] = useState<Record<number, string>>({});
  const [closeDigits, setCloseDigits] = useState<Record<number, string>>({});
  const [jodiCut, setJodiCut] = useState(false);
  const [crossBase, setCrossBase] = useState('');
  const [crossAmt, setCrossAmt] = useState('');
  const [crossRows, setCrossRows] = useState<{ label: string; number: number; amount: number }[]>([]);

  const lastPublishedRef = useRef('');
  const announcedRef = useRef('');
  const gameRef = useRef<Game | null>(null);

  const refreshLive = async () => {
    const g = await loadGame(gameId);
    if (g) {
      setGame(g);
      gameRef.current = g;
    }
    if (profile?.id) {
      const bets = await loadMyGameBets(profile.id, gameId);
      return { game: g, bets };
    }
    return { game: g, bets: [] as Bet[] };
  };

  useEffect(() => {
    void refreshLive().then(({ game: g }) => {
      if (g?.result_published_at) lastPublishedRef.current = g.result_published_at;
    });
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const poll = window.setInterval(() => {
      void (async () => {
        const g0 = gameRef.current;
        const due =
          g0?.next_result_at && new Date(g0.next_result_at).getTime() <= Date.now() + 15000;
        if (due) await requestMarketResults();
        const { game: g, bets } = await refreshLive();
        if (!g?.result_published_at) return;
        const pub = g.result_published_at;
        if (pub === lastPublishedRef.current) return;
        lastPublishedRef.current = pub;
        const digit = Number(g.result);
        if (Number.isNaN(digit)) return;
        const related = bets.filter(
          (b) =>
            (b.status === 'won' || b.status === 'lost') &&
            new Date(b.created_at).getTime() > Date.now() - 3 * 60 * 60 * 1000,
        );
        if (!related.length) return;
        if (announcedRef.current === pub) return;
        announcedRef.current = pub;
        const summary = summarizeRoundOutcome(related, digit);
        if (!summary) return;
        setOutcome(summary);
        if (summary.type === 'won') playWin();
        else playLose();
        await refreshProfile();
      })();
    }, 4000);
    return () => {
      window.clearInterval(tick);
      window.clearInterval(poll);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId, profile?.id]);

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 3200);
  };

  const bettingOpen = game ? isMarketBettingOpen(game, now) : false;
  /** Only today's satta digit — not yesterday while market is still XX/open. */
  const outDigit = scrapedDigit(game?.last_scraped_result);

  const totalAmount = useMemo(() => {
    const slipTotal = slip.reduce((s, i) => s + i.amount, 0);
    const openTotal = Object.values(openDigits).reduce((s, v) => s + (Number(v) || 0), 0);
    const closeTotal = Object.values(closeDigits).reduce((s, v) => s + (Number(v) || 0), 0);
    const crossTotal = crossRows.reduce((s, r) => s + r.amount, 0);
    if (tab === 'open') return slipTotal;
    if (tab === 'jantari') return openTotal + closeTotal;
    return crossTotal;
  }, [slip, openDigits, closeDigits, crossRows, tab]);

  const addOpen = () => {
    playTap();
    if (!bettingOpen) {
      notify('Closed');
      return;
    }
    const n = Number(openNum);
    const a = Number(openAmt);
    if (Number.isNaN(n) || n < 0 || n > 99) {
      notify('Enter number 0–99');
      return;
    }
    const minOpen = gameMinBet(game);
    if (!a || a < minOpen) {
      notify(`Minimum amount Rs ${minOpen}`);
      return;
    }
    setSlip((cur) => [
      ...cur,
      { key: `${Date.now()}-${n}`, label: String(n).padStart(2, '0'), number: n, amount: a, kind: 'jodi' },
    ]);
    setOpenNum('');
    setOpenAmt('');
  };

  const addCrossing = () => {
    playTap();
    if (!bettingOpen) {
      notify('Closed');
      return;
    }
    const base = sanitizeCrossingDigits(crossBase);
    const amt = Number(crossAmt);
    if (base.length < 2) {
      notify('Enter 2–8 unique digits (no digit repeats)');
      return;
    }
    const minCross = gameCrossingMinBet(game);
    if (!amt || amt < minCross) {
      notify(`Minimum amount Rs ${minCross}`);
      return;
    }
    const { rows } = expandCrossing(base, amt, jodiCut);
    if (!rows.length) {
      notify('No combinations');
      return;
    }
    setCrossRows((cur) => [...cur, ...rows]);
    setCrossBase('');
    setCrossAmt('');
  };

  const crossPreview = useMemo(() => {
    const base = sanitizeCrossingDigits(crossBase);
    const amt = Number(crossAmt) || 0;
    const minCross = gameCrossingMinBet(game);
    if (base.length < 2 || amt < minCross) return null;
    return expandCrossing(base, amt, jodiCut);
  }, [crossBase, crossAmt, jodiCut, game]);

  const buildBets = (): BetPayload[] => {
    if (tab === 'open') {
      return slip.map((s) => ({ number: s.number, amount: s.amount, kind: 'jodi' }));
    }
    if (tab === 'jantari') {
      const bets: BetPayload[] = [];
      for (const d of JANTARI_DIGITS) {
        const o = Number(openDigits[d] || 0);
        if (o > 0) bets.push({ number: d, amount: o, kind: 'open' });
        const c = Number(closeDigits[d] || 0);
        if (c > 0) bets.push({ number: d, amount: c, kind: 'close' });
      }
      return bets;
    }
    return crossRows.map((r) => ({ number: r.number, amount: r.amount, kind: 'crossing' }));
  };

  const submit = async () => {
    if (!profile || !game) return;
    if (!bettingOpen) {
      notify('Closed');
      return;
    }
    const bets = buildBets();
    if (!bets.length) {
      notify('Add at least one entry');
      return;
    }
    const minBet = tab === 'crossing' ? gameCrossingMinBet(game) : gameMinBet(game);
    const minErr = assertMarketMinBet(bets.map((b) => b.amount), minBet);
    if (minErr) {
      notify(minErr);
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
      notify(error.message || 'Entry failed');
      return;
    }
    playBetOk();
    await refreshProfile();
    setSlip([]);
    setOpenDigits({});
    setCloseDigits({});
    setCrossRows([]);
    notify('Entry placed ✓');
    await refreshLive();
  };

  const digitRow = (
    label: string,
    values: Record<number, string>,
    setValues: Dispatch<SetStateAction<Record<number, string>>>,
  ) => (
    <div className="jantari-kind-block">
      <div className="jantari-kind-label">{label}</div>
      <div className="jantari-kind-nums">
        {JANTARI_DIGITS.map((n) => (
          <span key={n}>{n}</span>
        ))}
      </div>
      <div className="jantari-kind-inputs">
        {JANTARI_DIGITS.map((n) => (
          <input
            key={n}
            value={values[n] || ''}
            onChange={(e) => {
              const v = e.target.value.replace(/[^0-9]/g, '').slice(0, 5);
              setValues((cur) => ({ ...cur, [n]: v }));
            }}
            inputMode="numeric"
            aria-label={`${label} ${n}`}
            placeholder="0"
          />
        ))}
      </div>
    </div>
  );

  const outcomeModal =
    outcome &&
    createPortal(
      <div className="result-modal" role="dialog" aria-modal="true">
        <div className={`result-modal-card ${outcome.type}`}>
          {outcome.type === 'won' ? (
            <>
              <PartyPopper size={36} />
              <h2>Congratulations!</h2>
              <p>
                Result <b>{outcome.digit}</b> · You won
              </p>
              <strong className="result-payout">+{outcome.payout} coins</strong>
              <small>Stake {outcome.stake} · Payout 1 → {gamePayoutMult(game)}</small>
            </>
          ) : (
            <>
              <Frown size={36} />
              <h2>Better luck next time</h2>
              <p>
                Result was <b>{outcome.digit}</b>
              </p>
              <strong className="result-payout loss">−{outcome.stake} coins</strong>
              <small>Official market result · also shown in red on Play Game list</small>
            </>
          )}
          <button type="button" className="result-modal-btn" onClick={() => setOutcome(null)}>
            OK
          </button>
        </div>
      </div>,
      document.body,
    );

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

      {!bettingOpen && (
        <p className="mp-closed-banner" onClick={() => notify('Closed')}>
          Closed for this market
        </p>
      )}

      {outDigit && (
        <p className="mp-result-red market-last-result">
          Result: <strong>{outDigit}</strong>
        </p>
      )}

      <div className="market-play-body">
        {tab === 'open' && (
          <>
            <div className="mp-form-panel">
              <p className="mp-min-hint" style={{ gridColumn: '1 / -1', margin: '0 0 4px' }}>
                Min Rs {gameMinBet(game)} · Payout 1 → {gamePayoutMult(game)}
              </p>
              <input
                className="mp-plain-input"
                value={openNum}
                onChange={(e) => setOpenNum(e.target.value.replace(/[^0-9]/g, '').slice(0, 2))}
                placeholder="Number"
                inputMode="numeric"
              />
              <input
                className="mp-plain-input"
                value={openAmt}
                onChange={(e) => setOpenAmt(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="Amount"
                inputMode="numeric"
              />
              <button type="button" className="mp-add" onClick={addOpen}>
                + Add
              </button>
            </div>
            <div className="mp-slip flat">
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
          </>
        )}

        {tab === 'jantari' && (
          <div className="jantari-v2">
            <p className="mp-min-hint">
              Minimum Rs {gameMinBet(game)} per number · Crossing min Rs {gameCrossingMinBet(game)} ·
              Payout 1 → {gamePayoutMult(game)}
            </p>
            {digitRow('Dhai / Open / अंदर', openDigits, setOpenDigits)}
            {digitRow('Harup / Close / बाहर', closeDigits, setCloseDigits)}
          </div>
        )}

        {tab === 'crossing' && (
          <>
            <div className="mp-form-panel crossing-panel">
              <p className="mp-min-hint" style={{ margin: '0 0 6px' }}>
                Min Rs {gameCrossingMinBet(game)} per combo · Payout 1 → {gamePayoutMult(game)}
              </p>
              <label className="jodi-cut">
                <input type="checkbox" checked={jodiCut} onChange={(e) => setJodiCut(e.target.checked)} />
                Jodi Cut
              </label>
              <input
                className="mp-plain-input"
                value={crossBase}
                onChange={(e) => setCrossBase(sanitizeCrossingDigits(e.target.value))}
                placeholder="Number (unique digits only)"
                inputMode="numeric"
              />
              <input
                className="mp-plain-input"
                value={crossAmt}
                onChange={(e) => setCrossAmt(e.target.value.replace(/[^0-9]/g, '').slice(0, 6))}
                placeholder="Amount"
                inputMode="numeric"
              />
              {crossPreview && (
                <p className="cross-preview">
                  {crossPreview.count} combos · Total ₹{crossPreview.total}/-
                  {jodiCut ? ' (Jodi Cut)' : ''}
                </p>
              )}
              <button type="button" className="mp-add" onClick={addCrossing}>
                + Add
              </button>
            </div>
            <div className="mp-slip flat">
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

      <div className="mp-continue-bar">
        <div className="mp-total">
          <strong>₹ {totalAmount}/-</strong>
          <small>Total Amount</small>
        </div>
        <button type="button" className="mp-continue" onClick={submit} disabled={busy}>
          {busy ? '…' : 'Continue'}
        </button>
      </div>

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
      {outcomeModal}
    </div>
  );
}
