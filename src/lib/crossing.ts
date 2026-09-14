/** Crossing V2: n² pairs from base digits; Jodi Cut drops doubles. */

export function expandCrossing(baseDigits: string, amount: number, jodiCut: boolean) {
  const digits = baseDigits.replace(/\D/g, '').slice(0, 8).split('').map((d) => Number(d));
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

export function assertBetAmountsAllowed(
  amounts: number[],
  nextResultAt: string | null | undefined,
  now = Date.now(),
): string | null {
  if (!isFinalHour(nextResultAt, now)) return null;
  if (amounts.some((a) => a > 200)) return 'Max bet Rs 200 in final hour';
  return null;
}

export const JANTARI_DIGITS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 0] as const;
