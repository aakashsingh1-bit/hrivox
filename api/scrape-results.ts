import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { BROWSER_FETCH_HEADERS, lookupParsedResult, parseSattaKingHtml } from '../src/lib/sattaParse';

/**
 * Vercel serverless scrape — satta-king often blocks Supabase Edge IPs (403).
 * Set in Vercel Project → Settings → Environment Variables:
 *   SUPABASE_URL (or VITE_SUPABASE_URL)
 *   SUPABASE_SERVICE_ROLE_KEY
 *   VITE_SUPABASE_ANON_KEY (for JWT check)
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
    // Allow service role for cron; otherwise require user token
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
