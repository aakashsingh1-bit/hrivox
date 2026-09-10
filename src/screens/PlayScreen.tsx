import { useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { supabase, formatCountdown, type Game, type ResultHistory } from '@/lib/supabase';
import { ArrowLeft, Volume2, VolumeX, Coins } from 'lucide-react';
import { playBetOk, playSpinStart, playTick, playWin } from '@/lib/sounds';

/** Clockwise from top pointer on client wheel art: 1,2,3,4,5,6,7,8,9,0 */
const WHEEL_ORDER = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;
const SEG = 36;

function angleForNumber(n: number) {
  const idx = WHEEL_ORDER.indexOf(n as (typeof WHEEL_ORDER)[number]);
  if (idx < 0) return 0;
  return -(idx * SEG);
}

type Props = {
  gameId: string;
  mode: 'full' | 'harf';
  onBack: () => void;
};

export function PlayScreen({ gameId, mode, onBack }: Props) {
  const { profile, refreshProfile } = useAuth();
  const [game, setGame] = useState<Game | null>(null);
  const [amounts, setAmounts] = useState<Record<number, string>>({});
  const [harfDigit, setHarfDigit] = useState<number | null>(null);
  const [harfAmount, setHarfAmount] = useState('');
  const [last5, setLast5] = useState<string[]>([]);
  const [toast, setToast] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [muted, setMuted] = useState(false);
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const lastResultRef = useRef<string>('');
  const tickTimer = useRef<number | null>(null);

  useEffect(() => {
    loadGame();
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    const settlePoll = window.setInterval(async () => {
      try {
        await supabase.rpc('try_settle_due');
        await loadGame(true);
        await refreshProfile();
      } catch {
        /* ignore */
      }
    }, 15000);
    return () => {
      window.clearInterval(timer);
      window.clearInterval(settlePoll);
      if (tickTimer.current) window.clearInterval(tickTimer.current);
    };
  }, [gameId]);

  useEffect(() => {
    if (game) loadLast5(game.id);
  }, [game?.id]);

  const loadGame = async (checkSpin = false) => {
    try {
      await supabase.rpc('try_settle_due');
    } catch {
      /* ignore */
    }
    const { data } = await supabase.from('games').select('*').eq('id', gameId).maybeSingle();
    if (!data) return;
    const g = data as Game;
    setGame(g);
    if (checkSpin && g.result && g.result !== lastResultRef.current && lastResultRef.current !== '') {
      spinToResult(Number(g.result));
    } else if (g.result && !checkSpin) {
      setRotation(angleForNumber(Number(g.result)));
    }
    if (g.result) lastResultRef.current = g.result;
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

  const spinToResult = (digit: number) => {
    if (Number.isNaN(digit) || digit < 0 || digit > 9) return;
    setSpinning(true);
    sfx(playSpinStart);
    if (tickTimer.current) window.clearInterval(tickTimer.current);
    tickTimer.current = window.setInterval(() => sfx(playTick), 90);

    const target = angleForNumber(digit);
    setRotation((prev) => {
      const normalized = ((prev % 360) + 360) % 360;
      const want = ((target % 360) + 360) % 360;
      let delta = want - normalized;
      if (delta > 0) delta -= 360;
      return prev + delta - 360 * 6;
    });

    window.setTimeout(() => {
      if (tickTimer.current) window.clearInterval(tickTimer.current);
      setSpinning(false);
      sfx(() => playWin(digit));
      notify(`Result: ${digit}`);
    }, 4200);
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
    setSpinning(true);
    setRotation((r) => r - 720);
    window.setTimeout(() => setSpinning(false), 1600);

    await refreshProfile();
    setAmounts({});
    setHarfDigit(null);
    setHarfAmount('');
    notify(mode === 'harf' ? 'Harf bet placed ✓' : 'Bet Ok ✓');
    setSubmitting(false);
  };

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
        <button type="button" className="sound-fab inline" onClick={() => setMuted((m) => !m)} aria-label="Sound">
          {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
        </button>
      </div>

      <div className="wheel-stage">
        <div
          className={`wheel-photo ${spinning ? 'is-spinning' : ''}`}
          style={{ transform: `rotate(${rotation}deg)` }}
        >
          <img src="/wheel.png?v=2" alt="Wheel" draggable={false} />
        </div>
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
            <label key={n} className={amounts[n] ? 'filled' : ''}>
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
                className={harfDigit === n ? 'on' : ''}
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

      {toast && (
        <div className="toast">
          <Coins size={16} /> {toast}
        </div>
      )}
    </div>
  );
}
