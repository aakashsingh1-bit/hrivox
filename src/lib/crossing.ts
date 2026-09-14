/** Crossing V2: n² pairs from base digits; optional A×B; Jodi Cut drops doubles. */

export const MARKET_MIN_BET = 100;

export function expandCrossing(baseDigits: string, amount: number, jodiCut: boolean) {
  return expandCrossingPair(baseDigits, '', amount, jodiCut);
}

/** Left × Right digit product. Empty right → left × left (needs ≥2 digits). */
export function expandCrossingPair(
  leftDigits: string,
  rightDigits: string,
  amount: number,
  jodiCut: boolean,
) {
  const empty = { rows: [] as { label: string; number: number; amount: number }[], total: 0, count: 0 };
  const left = leftDigits
    .replace(/\D/g, '')
    .slice(0, 8)
    .split('')
    .map((d) => Number(d));
  const rightRaw = rightDigits.replace(/\D/g, '').slice(0, 8);
  const right = (rightRaw || leftDigits.replace(/\D/g, '').slice(0, 8))
    .split('')
    .map((d) => Number(d));

  if (!left.length || !right.length) return empty;
  if (!rightRaw && left.length < 2) return empty;

  const rows: { label: string; number: number; amount: number }[] = [];
  for (const a of left) {
    for (const b of right) {
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
