// Fetch official results from satta-king-fast.com and settle due markets.
// Deploy: supabase functions deploy fetch-results
// Schedule cron every 1–5 minutes.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.57.4';

function normalizeName(s: string) {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Parse markdown-ish / HTML table text into name → latest result digit string */
function parseResults(html: string): Record<string, string> {
  const out: Record<string, string> = {};
  // Strip tags lightly
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ');

  // Patterns like: GALI at 11:25 PM ... 72 or FARIDABAD ... 30
  const re =
    /([A-Z][A-Z0-9 .'\-]{2,40}?)\s+at\s+\d{1,2}:\d{2}\s*(?:AM|PM)?[^\d]{0,40}?(\d{1,2}|XX|--)\s+(\d{1,2}|XX|--)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const name = normalizeName(m[1]);
    const today = m[3];
    if (/^\d{1,2}$/.test(today)) {
      out[name] = today.padStart(2, '0');
    }
  }

  // Monthly chart header DSWR FRBD GZBD GALI last row
  const chart = text.match(
    /DATE\s+DSWR\s+FRBD\s+GZBD\s+GALI[\s\S]{0,800}?(\d{2})\s+(\d{1,2}|XX)\s+(\d{1,2}|XX)\s+(\d{1,2}|XX)\s+(\d{1,2}|XX)/i,
  );
  if (chart) {
    const map: [string, string][] = [
      ['DESAWAR', chart[2]],
      ['FARIDABAD', chart[3]],
      ['GHAZIABAD', chart[4]],
      ['GALI', chart[5]],
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
  // fuzzy contains
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

    // Allow: cron secret, service role, or any authenticated user JWT
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
      // no cron secret configured: require valid user or service
      const userClient = createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY') || serviceKey, {
        global: { headers: { Authorization: `Bearer ${bearer}` } },
      });
      const { data: userData } = await userClient.auth.getUser();
      if (!userData?.user && !isService) {
        return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 });
      }
    }

    const admin = createClient(supabaseUrl, serviceKey);

    // Site often blocks datacenter/bot UAs with 403 — use a normal browser profile
    const browserHeaders: Record<string, string> = {
      'User-Agent':
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
      'Accept-Language': 'en-IN,en-US;q=0.9,en;q=0.8',
      'Cache-Control': 'no-cache',
      Pragma: 'no-cache',
      'Upgrade-Insecure-Requests': '1',
      Referer: 'https://www.google.com/',
    };

    const sourceUrl = Deno.env.get('RESULT_SOURCE_URL') || 'https://satta-king-fast.com/';
    let res = await fetch(sourceUrl, { headers: browserHeaders, redirect: 'follow' });

    // One retry without Referer if first attempt blocked
    if (res.status === 403 || res.status === 429) {
      const { Referer: _r, ...rest } = browserHeaders;
      res = await fetch(sourceUrl, { headers: rest, redirect: 'follow' });
    }

    if (!res.ok) {
      return new Response(
        JSON.stringify({
          error: `Fetch failed ${res.status}`,
          hint:
            'Source site blocked the server IP. Use Admin Override for now, or set RESULT_SOURCE_URL secret to an allowed mirror.',
        }),
        { status: 502, headers: { 'Content-Type': 'application/json' } },
      );
    }
    const html = await res.text();
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
      if (error) {
        skipped.push(`${g.short_code}:${error.message}`);
      } else {
        settled.push({ game: g.short_code, result: String(data ?? result) });
      }
    }

    // Also settle Harf via lowest-bet when due
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
