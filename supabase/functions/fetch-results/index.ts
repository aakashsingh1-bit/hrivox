// Fetch official results — prefers HTML body; otherwise fetches source URL.
// Note: satta-king-fast.com often returns 403 to Supabase Edge IPs.
// Production scrape uses Vercel /api/scrape-results instead.
// Deploy: supabase functions deploy fetch-results

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

function normalizeName(s: string) {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseResults(html: string): Record<string, string> {
  const out: Record<string, string> = {};

  const rowRe =
    /class=["']game-result[^"']*["'][\s\S]*?class=["']game-name["'][^>]*>\s*([^<]+?)\s*<\/h3>[\s\S]*?class=["']today-number["'][\s\S]*?<h3>\s*([^<]+?)\s*<\/h3>/gi;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(html)) !== null) {
    const name = normalizeName(m[1]);
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

function lookupResult(parsed: Record<string, string>, externalName: string): string | null {
  const key = normalizeName(externalName);
  if (parsed[key]) return parsed[key];
  for (const [n, v] of Object.entries(parsed)) {
    if (n.includes(key) || key.includes(n)) return v;
  }
  return null;
}

Deno.serve(async (req) => {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    const cronSecret = Deno.env.get('CRON_SECRET');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

    const bearer = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const isCron = Boolean(cronSecret && bearer === cronSecret);
    const isService = Boolean(serviceKey && (bearer === serviceKey || authHeader.includes(serviceKey)));
    let isUser = false;
    if (bearer && !isCron && !isService) {
      const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || serviceKey, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      });
      const { data: userData } = await userClient.auth.getUser();
      isUser = Boolean(userData?.user);
    }
    if (cronSecret) {
      if (!isCron && !isService && !isUser) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }
    } else if (!isService && !isUser && bearer) {
      const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || serviceKey, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      });
      const { data: userData } = await userClient.auth.getUser();
      if (!userData?.user && !isService) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }
    }

    const admin = createClient(supabaseUrl, serviceKey);

    let html = '';
    try {
      const body = req.method !== 'GET' ? await req.json().catch(() => ({})) : {};
      if (body && typeof body.html === 'string' && body.html.length > 100) {
        html = body.html;
      }
    } catch {
      /* ignore */
    }

    if (!html) {
      const browserHeaders: Record<string, string> = {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
        Referer: 'https://www.google.com/',
      };
      const sourceUrl = Deno.env.get('RESULT_SOURCE_URL') || 'https://satta-king-fast.com/';
      const res = await fetch(sourceUrl, { headers: browserHeaders, redirect: 'follow' });
      if (!res.ok) {
        return new Response(
          JSON.stringify({
            error: `Fetch failed ${res.status}`,
            hint: 'Use Vercel /api/scrape-results (site blocks Supabase Edge IPs). Or POST { html: "..." }.',
          }),
          { status: 502, headers: { 'Content-Type': 'application/json' } },
        );
      }
      html = await res.text();
    }

    const parsed = parseResults(html);

    const { data: games, error: gErr } = await admin
      .from('games')
      .select('id, name, short_code, external_name, next_result_at, is_active')
      .neq('short_code', 'HF')
      .eq('is_active', true);

    if (gErr) {
      return new Response(JSON.stringify({ error: gErr.message }), { status: 500 });
    }

    const settled: { game: string; result: string }[] = [];
    const skipped: string[] = [];
    const now = Date.now();

    for (const g of games || []) {
      const ext = g.external_name || g.name;
      const result = lookupResult(parsed, ext);
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

    return new Response(
      JSON.stringify({
        at: new Date().toISOString(),
        parsedCount: Object.keys(parsed).length,
        settled,
        skipped,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
