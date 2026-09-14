/**
 * Parse satta-king-fast.com HTML board rows:
 * name, draw time, yesterday, today (XX or digits).
 */

export type SattaBoardEntry = {
  name: string;
  timeLabel: string;
  yesterday: string;
  today: string;
  pending: boolean;
};

function normalize(s: string) {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanCell(raw: string) {
  return raw.replace(/\s+/g, ' ').trim().toUpperCase();
}

export function parseSattaKingBoard(html: string): SattaBoardEntry[] {
  const rows: SattaBoardEntry[] = [];
  const rowRe =
    /class=['"]game-result[^'"]*['"][\s\S]*?class=['"]game-name['"][^>]*>\s*([^<]+?)\s*<\/h3>\s*<h3 class=['"]game-time['"][^>]*>\s*([^<]+?)\s*<\/h3>[\s\S]*?class=['"]yesterday-number['"][\s\S]*?<h3>\s*([^<]+?)\s*<\/h3>[\s\S]*?class=['"]today-number['"][\s\S]*?<h3>\s*([^<]+?)\s*<\/h3>/gi;

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const name = normalize(m[1]);
    if (!name || name.includes('SHOW YOUR GAME')) continue;
    const timeLabel = m[2].replace(/^at\s+/i, '').trim();
    const yesterday = cleanCell(m[3]);
    const today = cleanCell(m[4]);
    const pending = today === 'XX' || today === '--' || !/^\d{1,2}$/.test(today);
    rows.push({
      name,
      timeLabel,
      yesterday: /^\d{1,2}$/.test(yesterday) ? yesterday.padStart(2, '0') : yesterday,
      today: pending ? 'XX' : today.padStart(2, '0'),
      pending,
    });
  }
  return rows;
}

/** Legacy map: only declared digits (skips XX). */
export function parseSattaKingHtml(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of parseSattaKingBoard(html)) {
    if (!row.pending) out[row.name] = row.today;
  }

  const chartRows = [
    ...html.matchAll(
      /<tr[^>]*Class=["']day-number["'][^>]*>\s*<td[^>]*>\s*(\d{1,2})\s*<\/td>\s*<td[^>]*>\s*([^<]+)<\/td>\s*<td[^>]*>\s*([^<]+)<\/td>\s*<td[^>]*>\s*([^<]+)<\/td>\s*<td[^>]*>\s*([^<]+)<\/td>/gi,
    ),
  ];
  if (chartRows.length) {
    const last = chartRows[chartRows.length - 1];
    for (const [n, v] of [
      ['DESAWAR', last[2].trim()],
      ['FARIDABAD', last[3].trim()],
      ['GHAZIABAD', last[4].trim()],
      ['GALI', last[5].trim()],
    ] as const) {
      if (/^\d{1,2}$/.test(v) && !out[n]) out[n] = v.padStart(2, '0');
    }
  }
  return out;
}

export function lookupBoardEntry(
  rows: SattaBoardEntry[],
  externalName: string,
): SattaBoardEntry | null {
  const key = normalize(externalName);
  const exact = rows.find((r) => r.name === key);
  if (exact) return exact;
  // Prefer shortest contains-match so GHAZIABAD wins over GHAZIABAD DIN when querying GHAZIABAD
  const partial = rows
    .filter((r) => r.name === key || r.name.startsWith(key + ' ') || key.startsWith(r.name + ' '))
    .sort((a, b) => a.name.length - b.name.length);
  if (partial.length) return partial[0];
  const fuzzy = rows
    .filter((r) => r.name.includes(key) || key.includes(r.name))
    .sort((a, b) => a.name.length - b.name.length);
  return fuzzy[0] || null;
}

export function lookupParsedResult(
  parsed: Record<string, string>,
  externalName: string,
): string | null {
  const key = normalize(externalName);
  if (parsed[key]) return parsed[key];
  for (const [n, v] of Object.entries(parsed)) {
    if (n === key) return v;
  }
  for (const [n, v] of Object.entries(parsed)) {
    if (n.includes(key) || key.includes(n)) return v;
  }
  return null;
}

export const BROWSER_FETCH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
  Referer: 'https://www.google.com/',
};
