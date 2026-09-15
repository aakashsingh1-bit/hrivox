/** Crossing V2: n² pairs from base digits; Jodi Cut drops doubles (55, 77, …). */

export const MARKET_MIN_BET = 100;
export const CROSSING_MIN_BET = 10;

/** Strip digits; block consecutive same digit (7656232 ok, 7656623 not). Max 8 digits. */
export function sanitizeCrossingDigits(raw: string, maxLen = 8): string {
  let out = '';
  for (const ch of raw.replace(/\D/g, '')) {
    if (out.length >= maxLen) break;
    if (out.length > 0 && out[out.length - 1] === ch) continue;
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
