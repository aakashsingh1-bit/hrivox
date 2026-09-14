/**
 * Parse satta-king-fast.com HTML into name → today's result (2-digit string).
 * Matches rows like:
 *   <h3 class="game-name">GALI</h3> ... <td class="today-number"><h3>XX</h3>
 */
export function parseSattaKingHtml(html: string): Record<string, string> {
  const out: Record<string, string> = {};

  const normalize = (s: string) =>
    s
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

  const rowRe =
    /class=["']game-result[^"']*["'][\s\S]*?class=["']game-name["'][^>]*>\s*([^<]+?)\s*<\/h3>[\s\S]*?class=["']today-number["'][\s\S]*?<h3>\s*([^<]+?)\s*<\/h3>/gi;

  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const name = normalize(m[1]);
    const today = m[2].trim();
    if (!name || name.includes('SHOW YOUR GAME')) continue;
    if (/^\d{1,2}$/.test(today)) {
      out[name] = today.padStart(2, '0');
    }
  }

  const chartRows = [
    ...html.matchAll(
      /<tr[^>]*Class=["']day-number["'][^>]*>\s*<td[^>]*>\s*(\d{1,2})\s*<\/td>\s*<td[^>]*>\s*([^<]+)<\/td>\s*<td[^>]*>\s*([^<]+)<\/td>\s*<td[^>]*>\s*([^<]+)<\/td>\s*<td[^>]*>\s*([^<]+)<\/td>/gi,
    ),
  ];
  if (chartRows.length) {
    const last = chartRows[chartRows.length - 1];
    const map: [string, string][] = [
      ['DESAWAR', last[2].trim()],
      ['FARIDABAD', last[3].trim()],
      ['GHAZIABAD', last[4].trim()],
      ['GALI', last[5].trim()],
    ];
    for (const [n, v] of map) {
      if (/^\d{1,2}$/.test(v)) out[n] = v.padStart(2, '0');
    }
  }

  return out;
}

export function lookupParsedResult(parsed: Record<string, string>, externalName: string): string | null {
  const key = externalName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (parsed[key]) return parsed[key];
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
