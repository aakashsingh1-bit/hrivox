/** Crossing V2: n² pairs from unique base digits; Jodi Cut drops doubles (55, 77, …). */

export const MARKET_MIN_BET = 100;
export const CROSSING_MIN_BET = 10;

/** Resolve min stake from game row (falls back to product defaults). */
export function gameMinBet(game: { short_code?: string; min_bet?: number | null } | null | undefined) {
  const n = Number(game?.min_bet);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return game?.short_code === 'HF' ? 1 : MARKET_MIN_BET;
}

export function gameCrossingMinBet(
  game: { short_code?: string; min_bet_crossing?: number | null; min_bet?: number | null } | null | undefined,
) {
  const n = Number(game?.min_bet_crossing);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  if (game?.short_code === 'HF') return gameMinBet(game);
  return CROSSING_MIN_BET;
}

export function gamePayoutMult(
  game: { short_code?: string; payout_multiplier?: number | null } | null | undefined,
) {
  const n = Number(game?.payout_multiplier);
  if (Number.isFinite(n) && n >= 1) return Math.floor(n);
  return game?.short_code === 'HF' ? 8 : 90;
}

/** Digits only; each digit at most once (no repeats). Max 8 digits. */
export function sanitizeCrossingDigits(raw: string, maxLen = 8): string {
  let out = '';
  const seen = new Set<string>();
  for (const ch of raw.replace(/\D/g, '')) {
    if (out.length >= maxLen) break;
    if (seen.has(ch)) continue;
    seen.add(ch);
    out += ch;
  }
  return out;
}

export function expandCrossing(baseDigits: string, amount: number, jodiCut: boolean) {
  const digits = sanitizeCrossingDigits(baseDigits, 8).split('').map((d) => Number(d));
  if (digits.length < 2) {
    return { rows: [] as { label: string; number: number; amount: number }[], total: 0, count: 0 };
  }
  const rows: { label: string; number: number; amount: number }[] = [];
  for (const a of digits) {
    for (const b of digits) {
      if (jodiCut && a === b) continue;
      const number = a * 10 + b;
      rows.push({
        label: String(number).padStart(2, '0'),
        number,
        amount,
      });
    }
  }
  const total = rows.reduce((s, r) => s + r.amount, 0);
  return { rows, total, count: rows.length };
}

export function isFinalHour(nextResultAt: string | null | undefined, now = Date.now()) {
  if (!nextResultAt) return false;
  const ms = new Date(nextResultAt).getTime() - now;
  return ms > 0 && ms <= 60 * 60 * 1000;
}

/** Harf / wheel only — market Jodi/Jantari/Crossing skip final-hour cap. */
export function assertBetAmountsAllowed(
  amounts: number[],
  nextResultAt: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!isFinalHour(nextResultAt, now)) return null;
  if (amounts.some((a) => a > 200)) return 'Max bet Rs 200 in final hour';
  return null;
}

export function assertMarketMinBet(amounts: number[], min = MARKET_MIN_BET): string | null {
  if (amounts.some((a) => a > 0 && a < min)) return `Minimum bet Rs ${min}`;
  return null;
}

export const JANTARI_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;
