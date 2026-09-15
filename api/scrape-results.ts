import { createClient } from '@supabase/supabase-js';
import type { VercelRequest, VercelResponse } from '@vercel/node';

/** Inlined parser — Vercel ESM cannot import ../src (ERR_MODULE_NOT_FOUND). */

type SattaBoardEntry = {
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

function parseSattaKingBoard(html: string): SattaBoardEntry[] {
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

function lookupBoardEntry(rows: SattaBoardEntry[], externalName: string): SattaBoardEntry | null {
  const key = normalize(externalName);
  const exact = rows.find((r) => r.name === key);
  if (exact) return exact;
  const partial = rows
    .filter((r) => r.name === key || r.name.startsWith(key + ' ') || key.startsWith(r.name + ' '))
    .sort((a, b) => a.name.length - b.name.length);
  if (partial.length) return partial[0];
  const fuzzy = rows
    .filter((r) => r.name.includes(key) || key.includes(r.name))
    .sort((a, b) => a.name.length - b.name.length);
  return fuzzy[0] || null;
}

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

const OFFICIAL: Record<string, { openH: number; openM: number; drawH: number; drawM: number }> = {
  DW: { openH: 6, openM: 0, drawH: 5, drawM: 0 },
  SG: { openH: 6, openM: 0, drawH: 16, drawM: 30 },
  FB: { openH: 6, openM: 0, drawH: 18, drawM: 0 },
  GZ: { openH: 6, openM: 0, drawH: 21, drawM: 55 },
  GL: { openH: 6, openM: 0, drawH: 23, drawM: 25 },
};

function istParts(ms: number) {
  const d = new Date(ms + IST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
  };
}

function istWallToUtcMs(y: number, mo: number, day: number, h: number, mi: number) {
  return Date.UTC(y, mo - 1, day, h, mi, 0) - IST_OFFSET_MS;
}

function addIstDays(y: number, mo: number, day: number, delta: number) {
  const utc = Date.UTC(y, mo - 1, day) + delta * 86400000;
  const d = new Date(utc);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function nextDrawIso(shortCode: string, now = Date.now()): string | null {
  const sch = OFFICIAL[shortCode];
  if (!sch) return null;
  const p = istParts(now);
  let day = { y: p.y, mo: p.mo, day: p.day };
  let drawMs = istWallToUtcMs(day.y, day.mo, day.day, sch.drawH, sch.drawM);
  if (now >= drawMs) {
    day = addIstDays(day.y, day.mo, day.day, 1);
    drawMs = istWallToUtcMs(day.y, day.mo, day.day, sch.drawH, sch.drawM);
  }
  return new Date(drawMs).toISOString();
}

function parseTimeLabel(label: string): { h: number; m: number } | null {
  const m = label.trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2]);
  const ap = m[3].toUpperCase();
  if (ap === 'PM' && h < 12) h += 12;
  if (ap === 'AM' && h === 12) h = 0;
  return { h, m: mi };
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
  const isVercelCron = req.headers['x-vercel-cron'] === '1';
  if (!isVercelCron) {
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
    const board = parseSattaKingBoard(html);

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: games, error: gErr } = await admin
      .from('games')
      .select(
        'id, name, short_code, external_name, next_result_at, is_active, result, betting_closes_at, last_scraped_result',
      )
      .neq('short_code', 'HF')
      .eq('is_active', true);

    if (gErr) return res.status(500).json({ error: gErr.message });

    const settled: { game: string; result: string }[] = [];
    const synced: { game: string; today: string; pending: boolean }[] = [];
    const clearedClose: string[] = [];
    const skipped: string[] = [];
    const now = Date.now();

    for (const g of games || []) {
      const ext = g.external_name || g.name;
      const entry = lookupBoardEntry(board, ext);
      const nextIso = nextDrawIso(g.short_code, now);
      const parsedClock = entry ? parseTimeLabel(entry.timeLabel) : null;
      const schedule_time = entry?.timeLabel || g.short_code;

      const patch: Record<string, unknown> = {
        last_scraped_at: new Date().toISOString(),
      };
      if (nextIso) patch.next_result_at = nextIso;
      if (entry) {
        patch.last_scraped_result = entry.today;
        patch.schedule_time = schedule_time;
        if (entry.pending && /^\d{1,2}$/.test(entry.yesterday)) {
          patch.result = entry.yesterday;
        }
      } else {
        skipped.push(`${g.short_code}:no-board-row`);
      }

      if (parsedClock && nextIso) {
        const p = istParts(now);
        let day = { y: p.y, mo: p.mo, day: p.day };
        let drawMs = istWallToUtcMs(day.y, day.mo, day.day, parsedClock.h, parsedClock.m);
        if (now >= drawMs) {
          day = addIstDays(day.y, day.mo, day.day, 1);
          drawMs = istWallToUtcMs(day.y, day.mo, day.day, parsedClock.h, parsedClock.m);
        }
        patch.next_result_at = new Date(drawMs).toISOString();
        patch.schedule_time = entry!.timeLabel;
      }

      // Clear admin last-bet override after round ends → next cycle uses scrap default.
      // Do NOT clear while override is still in the future (would reopen early).
      const closeAt = g.betting_closes_at ? new Date(g.betting_closes_at).getTime() : NaN;
      if (!Number.isNaN(closeAt)) {
        const resultOut = entry ? !entry.pending : !isPendingScraped(g.last_scraped_result);
        const nextDrawMs = patch.next_result_at
          ? new Date(String(patch.next_result_at)).getTime()
          : nextIso
            ? new Date(nextIso).getTime()
            : NaN;
        // Round over: result digit out, OR close time passed and next draw already rolled forward past this close
        const pastRound =
          resultOut ||
          (now >= closeAt && !Number.isNaN(nextDrawMs) && nextDrawMs - closeAt > 2 * 60 * 60 * 1000);
        if (pastRound) {
          patch.betting_closes_at = null;
          clearedClose.push(g.short_code);
        }
      }

      await admin.from('games').update(patch).eq('id', g.id);

      if (!entry) continue;
      synced.push({ game: g.short_code, today: entry.today, pending: entry.pending });

      if (entry.pending) {
        skipped.push(`${g.short_code}:pending-XX`);
        continue;
      }

      if (String(g.result).padStart(2, '0') === entry.today) {
        skipped.push(`${g.short_code}:already-settled`);
        continue;
      }

      const { data, error } = await admin.rpc('service_settle_game', {
        p_game_id: g.id,
        p_override: String(Number(entry.today)),
      });
      if (error) skipped.push(`${g.short_code}:${error.message}`);
      else settled.push({ game: g.short_code, result: String(data ?? entry.today) });
    }

    await admin.rpc('settle_due_games');

    return res.status(200).json({
      at: new Date().toISOString(),
      via: 'vercel',
      boardCount: board.length,
      sample: board
        .filter((r) =>
          ['DESAWAR', 'FARIDABAD', 'GHAZIABAD', 'GALI', 'SHRI GANESH'].includes(r.name),
        )
        .map((r) => ({ name: r.name, today: r.today, time: r.timeLabel })),
      synced,
      settled,
      clearedClose,
      skipped,
    });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
}

function isPendingScraped(v: string | null | undefined) {
  if (!v) return true;
  const t = String(v).trim().toUpperCase();
  return t === 'XX' || t === '--' || t === '' || !/^\d{1,2}$/.test(t);
}
