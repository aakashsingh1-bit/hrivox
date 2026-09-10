import { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAuth } from '@/lib/auth';
import { supabase, formatCountdown, type Bet, type Game, type ResultHistory } from '@/lib/supabase';
import { ArrowLeft, Volume2, VolumeX, Coins, PartyPopper, Frown } from 'lucide-react';
import { playBetOk, playLose, playSpinStart, playTick, playWin, unlockAudio } from '@/lib/sounds';
import { isMuted, setMuted as persistMuted } from '@/lib/prefs';

/** Clockwise from top on wheel art: 1,2,3,4,5,6,7,8,9,0 */
const WHEEL_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;
const SEG = 36;

function arrowAngleForNumber(n: number) {
  const idx = WHEEL_ORDER.indexOf(n as (typeof WHEEL_ORDER)[number]);
  if (idx < 0) return 0;
  return idx * SEG;
}

type Outcome = {
  type: 'won' | 'lost';
  digit: number;
  stake: number;
  payout: number;
};

type Props = {
  gameId: string;
  mode: 'full' | 'harf';
  onBack: () => void;
};

export function PlayScreen({ gameId, mode, onBack }: Props) {
  const { profile, refreshProfile } = useAuth();
  const profileRef = useRef(profile);
  profileRef.current = profile;

  const [game, setGame] = useState<Game | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [harfDigit, setHarfDigit] = useState<number | null>(null);
  const [harfAmount, setHarfAmount] = useState('');
  const [last5, setLast5] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [muted, setMutedState] = useState(isMuted());
  const [arrowRotation, setArrowRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [sparkDigit, setSparkDigit] = useState<number | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);

  const lastPublishedRef = useRef<string>('');
  const spinningResultRef = useRef(false);
  const tickTimer = useRef<number | null>(null);
  const sparkTimer = useRef<number | null>(null);
  const gameRef = useRef<Game | null>(null);

  useEffect(() => {
    const onMute = (e: Event) => setMutedState(Boolean((e as CustomEvent).detail));
    window.addEventListener('hrivox-mute', onMute);
    return () => window.removeEventListener('hrivox-mute', onMute);
  }, []);

  useEffect(() => {
    void loadGame(false);
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const settlePoll = window.setInterval(() => {
      void pollSettle();
    }, 5000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(settlePoll);
      if (tickTimer.current) window.clearInterval(tickTimer.current);
      if (sparkTimer.current) window.clearTimeout(sparkTimer.current);
    };
  }, [gameId]);

  useEffect(() => {
    if (game) void loadLast5(game.id);
  }, [game?.id]);

  // When countdown hits zero, settle immediately
  useEffect(() => {
    if (!game?.next_result_at) return;
    const ms = new Date(game.next_result_at).getTime() - now;
    if (ms <= 0 && ms > -15000) {
      void pollSettle();
    }
  }, [now, game?.next_result_at]);

  const pollSettle = async () => {
    try {
      await supabase.rpc('try_settle_due');
    } catch {
      /* ignore */
    }
    await loadGame(true);
    await refreshProfile();
  };

  const loadGame = async (checkNewResult: boolean) => {
    const { data } = await supabase.from('games').select('*').eq('id', gameId).maybeSingle();
    if (!data) return;
    const g = data as Game;
    gameRef.current = g;
    setGame(g);

    const published = g.result_published_at || '';
    const digit = g.result !== '' && g.result != null ? Number(g.result) : NaN;

    if (!checkNewResult) {
      if (published) lastPublishedRef.current = published;
      if (!Number.isNaN(digit)) setArrowRotation(arrowAngleForNumber(digit));
      return;
    }

    if (
      published &&
      published !== lastPublishedRef.current &&
      !Number.isNaN(digit) &&
      !spinningResultRef.current
    ) {
      lastPublishedRef.current = published;
      spinToResult(digit, g);
    }
  };

  const loadLast5 = async (id: string) => {
    const { data } = await supabase
      .from('results_history')
      .select('*')
      .eq('game_id', id)
      .order('published_at', { ascending: false })
      .limit(5);
    if (data) setLast5((data as ResultHistory[]).map((r) => r.result));
  };

  const sfx = (fn: () => void) => {
    if (!muted) fn();
  };

  const notify = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(''), 2800);
  };

  const triggerSpark = (digit: number) => {
    setSparkDigit(digit);
    if (sparkTimer.current) window.clearTimeout(sparkTimer.current);
    sparkTimer.current = window.setTimeout(() => setSparkDigit(null), 2400);
  };

  const loadRoundOutcome = async (winningDigit: number, publishedAt: string | null) => {
    const user = profileRef.current;
    if (!user) return;

    const fetchBets = async () => {
      const { data } = await supabase
        .from('bets')
        .select('*')
        .eq('user_id', user.id)
        .eq('game_id', gameId)
        .in('status', ['won', 'lost'])
        .order('created_at', { ascending: false })
        .limit(50);
      return (data as Bet[]) || [];
    };

    // Retry a few times — settle may finish slightly after UI sees new result
    let bets: Bet[] = [];
    for (let i = 0; i < 4; i++) {
      bets = await fetchBets();
      if (bets.length) break;
      await new Promise((r) => window.setTimeout(r, 400));
    }
    if (!bets.length) return;

    const publishedMs = publishedAt ? new Date(publishedAt).getTime() : Date.now();
    const roundBets = bets.filter((b) => {
      const created = new Date(b.created_at).getTime();
      return created <= publishedMs + 8000 && publishedMs - created < 75 * 60 * 1000;
    });
    if (!roundBets.length) return;

    const storageKey = `hrivox_outcome_${gameId}_${publishedAt || winningDigit}`;
    try {
      if (sessionStorage.getItem(storageKey) === '1') return;
    } catch {
      /* ignore */
    }

    const wonOnly = roundBets.filter((b) => b.status === 'won');
    const lostOnly = roundBets.filter((b) => b.status === 'lost');

    if (wonOnly.length) {
      const stake = wonOnly.reduce((s, b) => s + b.amount, 0);
      const payout = wonOnly.reduce((s, b) => s + (b.payout || b.amount * 8), 0);
      setOutcome({ type: 'won', digit: winningDigit, stake, payout });
      sfx(() => playWin(winningDigit));
    } else if (lostOnly.length) {
      const stake = lostOnly.reduce((s, b) => s + b.amount, 0);
      setOutcome({ type: 'lost', digit: winningDigit, stake, payout: 0 });
      sfx(playLose);
    } else {
      return;
    }

    try {
      sessionStorage.setItem(storageKey, '1');
    } catch {
      /* ignore */
    }
  };

  const spinToDigit = (
    digit: number,
    opts?: { announceResult?: boolean; publishedAt?: string | null },
  ) => {
    if (Number.isNaN(digit) || digit < 0 || digit > 9) return;
    setSpinning(true);
    if (opts?.announceResult) spinningResultRef.current = true;
    sfx(playSpinStart);
    if (tickTimer.current) window.clearInterval(tickTimer.current);
    tickTimer.current = window.setInterval(() => sfx(playTick), 90);

    const target = arrowAngleForNumber(digit);
    setArrowRotation((prev) => {
      const normalized = ((prev % 360) + 360) % 360;
      const want = ((target % 360) + 360) % 360;
      let delta = want - normalized;
      if (delta <= 0) delta += 360;
      return prev + delta + 360 * 5;
    });

    window.setTimeout(() => {
      if (tickTimer.current) window.clearInterval(tickTimer.current);
      setSpinning(false);
      spinningResultRef.current = false;
      triggerSpark(digit);
      if (opts?.announceResult) {
        void loadRoundOutcome(digit, opts.publishedAt ?? null);
        void loadLast5(gameId);
        void refreshProfile();
      }
    }, 4200);
  };

  const spinToResult = (digit: number, g: Game) => {
    spinToDigit(digit, { announceResult: true, publishedAt: g.result_published_at });
  };

  const nextMs = game?.next_result_at ? new Date(game.next_result_at).getTime() - now : 0;
  const countdown = formatCountdown(nextMs);
  const bettingClosed = nextMs > 0 && nextMs < 30000;
  const totalFull = Object.values(amounts).reduce((s, v) => s + (Number(v) || 0), 0);
  const totalHarf = harfDigit !== null && Number(harfAmount) > 0 ? Number(harfAmount) : 0;
  const totalAmount = mode === 'harf' ? totalHarf : totalFull;
  const last5Label = useMemo(() => (last5.length ? `${last5.join(' | ')} |` : '—'), [last5]);

  const updateAmount = (num: number, val: string) => {
    setAmounts((cur) => ({ ...cur, [num]: val.replace(/[^0-9]/g, '').slice(0, 5) }));
  };

  const handleSubmit = async () => {
    if (!profile || !game) return;
    if (totalAmount === 0) {
      notify(mode === 'harf' ? 'Select digit + amount' : 'Enter amount on at least one number');
      return;
    }
    if (!game.is_active) {
      notify('This game is currently OFF');
      return;
    }
    if (bettingClosed || nextMs <= 0) {
      notify('Betting closed for this round');
      return;
    }
    if (totalAmount > profile.coins) {
      notify('Insufficient coins');
      return;
    }

    setSubmitting(true);
    const bets =
      mode === 'harf'
        ? [{ number: harfDigit as number, amount: Number(harfAmount) }]
        : Object.entries(amounts)
            .filter(([, v]) => Number(v) > 0)
            .map(([num, amt]) => ({ number: Number(num), amount: Number(amt) }));

    const focusNumber =
      mode === 'harf'
        ? (harfDigit as number)
        : bets.reduce((best, b) => (b.amount > best.amount ? b : best), bets[0]).number;

    const { error } = await supabase.rpc('place_bets', {
      p_game_id: game.id,
      p_bets: bets,
    });

    if (error) {
      notify(error.message || 'Failed to place bet');
      setSubmitting(false);
      return;
    }

    sfx(playBetOk);
    spinToDigit(focusNumber);
    await refreshProfile();
    setAmounts({});
    setHarfDigit(null);
    setHarfAmount('');
    notify(mode === 'harf' ? `Harf ${focusNumber} placed ✓` : `Bet placed ✓`);
    setSubmitting(false);
  };

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
              <small>Stake {outcome.stake} · Payout 1 → 8</small>
            </>
          ) : (
            <>
              <Frown size={36} />
              <h2>Better luck next time</h2>
              <p>
                Result was <b>{outcome.digit}</b>
              </p>
              <strong className="result-payout loss">−{outcome.stake} coins</strong>
              <small>Lowest-bet number wins each hour</small>
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
      <div className="play-screen play-casino">
        <p className="empty-state" style={{ color: '#ccc' }}>
          Loading...
        </p>
      </div>
    );
  }

  return (
    <div className="play-screen play-casino">
      <div className="play-nav-row">
        <button type="button" className="sound-fab inline" onClick={onBack} aria-label="Back">
          <ArrowLeft size={18} />
        </button>
        <div className="play-nav-title">
          <small>{mode === 'harf' ? 'PLAY HARF' : 'PLAY GAME'}</small>
          <strong>{game.name}</strong>
        </div>
        <button
          type="button"
          className="sound-fab inline"
          onClick={() => {
            unlockAudio();
            const next = !muted;
            persistMuted(next);
            setMutedState(next);
          }}
          aria-label="Sound"
        >
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </div>

      <div className="wheel-stage">
        <img className="wheel-base" src="/wheel.png?v=5" alt="Wheel" draggable={false} />
        <div
          className={`wheel-arrow-wrap ${spinning ? 'is-spinning' : ''}`}
          style={{ transform: `rotate(${arrowRotation}deg)` }}
        >
          <img className="wheel-arrow" src="/wheel-arrow.png?v=5" alt="" draggable={false} />
        </div>
        {sparkDigit !== null && (
          <div
            className="wheel-spark"
            style={{ transform: `rotate(${arrowAngleForNumber(sparkDigit)}deg)` }}
            aria-hidden
          >
            <span className="wheel-spark-burst" />
            <span className="wheel-spark-ray r1" />
            <span className="wheel-spark-ray r2" />
            <span className="wheel-spark-ray r3" />
          </div>
        )}
      </div>

      <div className="stat-grid">
        <div className="stat-cell">
          <label>Wallet</label>
          <div className="stat-box">{profile?.coins ?? 0}</div>
        </div>
        <div className="stat-cell">
          <label>Last 5 Result</label>
          <div className="stat-box small">{last5Label}</div>
        </div>
        <div className="stat-cell">
          <label>Next Result</label>
          <div className="stat-box">{countdown}</div>
        </div>
        <div className="stat-cell">
          <label>Last Result</label>
          <div className="stat-box">{game.result || '--'}</div>
        </div>
      </div>

      <div className="gold-lights">
        <span className="gold-lights-inner">{mode === 'harf' ? `${game.name} · HARF` : game.name}</span>
      </div>

      {mode === 'full' ? (
        <section className="bet-grid">
          {Array.from({ length: 10 }, (_, n) => (
            <label key={n} className={`${amounts[n] ? 'filled' : ''} ${sparkDigit === n ? 'spark-num' : ''}`}>
              <em>{n}</em>
              <input
                value={amounts[n] || ''}
                onChange={(e) => updateAmount(n, e.target.value)}
                placeholder="Amount"
                inputMode="numeric"
                disabled={!game.is_active || bettingClosed || spinning}
              />
            </label>
          ))}
        </section>
      ) : (
        <section className="harf-panel">
          <p className="harf-help">Select one digit (Harf), then enter amount</p>
          <div className="harf-digits">
            {Array.from({ length: 10 }, (_, n) => (
              <button
                key={n}
                type="button"
                className={`${harfDigit === n ? 'on' : ''} ${sparkDigit === n ? 'spark-num' : ''}`}
                onClick={() => setHarfDigit(n)}
                disabled={!game.is_active || bettingClosed || spinning}
              >
                {n}
              </button>
            ))}
          </div>
          <label className="harf-amount">
            <span>Amount for digit {harfDigit ?? '—'}</span>
            <input
              value={harfAmount}
              onChange={(e) => setHarfAmount(e.target.value.replace(/[^0-9]/g, '').slice(0, 5))}
              placeholder="Amount"
              inputMode="numeric"
              disabled={harfDigit === null || !game.is_active || bettingClosed || spinning}
            />
          </label>
        </section>
      )}

      <div className="bet-row">
        <button type="button" className="pill-red" disabled>
          {totalAmount}/-
        </button>
        <button
          type="button"
          className="pill-red"
          onClick={handleSubmit}
          disabled={submitting || !game.is_active || bettingClosed || spinning}
        >
          {submitting ? '...' : 'Bet Ok'}
        </button>
      </div>

      {toast &&
        createPortal(
          <div className="toast">
            <Coins size={16} /> {toast}
          </div>,
          document.body,
        )}

      {outcomeModal}
    </div>
  );
}
