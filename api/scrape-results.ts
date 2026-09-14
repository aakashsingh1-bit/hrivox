import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Inlined parser — Vercel ESM cannot import ../src (ERR_MODULE_NOT_FOUND). */
function parseSattaKingHtml(html: string): Record<string, string> {
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
    if (/^\d{1,2}$/.test(today)) out[name] = today.padStart(2, '0');
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
      if (/^\d{1,2}$/.test(v)) out[n] = v.padStart(2, '0');
    }
  }
  return out;
}

function lookupParsedResult(parsed: Record<string, string>, externalName: string): string | null {
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

const BROWSER_FETCH_HEADERS: Record<string, string> = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
  Referer: 'https://www.google.com/',
};

/**
 * Vercel serverless scrape — satta-king often blocks Supabase Edge IPs (403).
 * Env: SUPABASE_URL (or VITE_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY, VITE_SUPABASE_ANON_KEY
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabaseUrl = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  const anonKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({
      error: 'Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on Vercel',
    });
  }

  const authHeader = req.headers.authorization || '';
  const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
  if (bearer && anonKey) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${bearer}` } },
    });
    const { data: userData } = await userClient.auth.getUser();
    if (!userData?.user && bearer !== serviceKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
  } else if (bearer !== serviceKey) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const sourceUrl = process.env.RESULT_SOURCE_URL || 'https://satta-king-fast.com/';
    const page = await fetch(sourceUrl, { headers: BROWSER_FETCH_HEADERS, redirect: 'follow' });
    if (!page.ok) {
      return res.status(502).json({
        error: `Fetch failed ${page.status}`,
        hint: 'Vercel could not load satta-king-fast.com',
      });
    }
    const html = await page.text();
    const parsed = parseSattaKingHtml(html);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: games, error: gErr } = await admin
      .from('games')
      .select('id, name, short_code, external_name, next_result_at, is_active')
      .neq('short_code', 'HF')
      .eq('is_active', true);

    if (gErr) return res.status(500).json({ error: gErr.message });

    const settled: { game: string; result: string }[] = [];
    const skipped: string[] = [];
    const now = Date.now();

    for (const g of games || []) {
      const ext = g.external_name || g.name;
      const result = lookupParsedResult(parsed, ext);
      await admin
        .from('games')
        .update({
          last_scraped_result: result,
          last_scraped_at: new Date().toISOString(),
        })
        .eq('id', g.id);

      if (!result) {
        skipped.push(`${g.short_code}:no-result`);
        continue;
      }

      const due = g.next_result_at && new Date(g.next_result_at).getTime() <= now;
      if (!due) {
        skipped.push(`${g.short_code}:not-due`);
        continue;
      }

      const { data, error } = await admin.rpc('service_settle_game', {
        p_game_id: g.id,
        p_override: String(Number(result)),
      });
      if (error) skipped.push(`${g.short_code}:${error.message}`);
      else settled.push({ game: g.short_code, result: String(data ?? result) });
    }

    await admin.rpc('settle_due_games');

    return res.status(200).json({
      at: new Date().toISOString(),
      via: 'vercel',
      parsedCount: Object.keys(parsed).length,
      sample: Object.fromEntries(Object.entries(parsed).slice(0, 8)),
      settled,
      skipped,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}
