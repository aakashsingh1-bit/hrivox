/** Official satta-king draw clocks (IST) for HRIVOX markets. */

export type MarketCode = 'DW' | 'SG' | 'FB' | 'GZ' | 'GL';

export type MarketSchedule = {
  shortCode: MarketCode;
  /** Day open (IST). Overnight draws (before open) use previous calendar day's open. */
  openHour: number;
  openMinute: number;
  drawHour: number;
  drawMinute: number;
};

/** Mirrors satta-king-fast.com board times. */
export const MARKET_SCHEDULE: Record<MarketCode, MarketSchedule> = {
  DW: { shortCode: 'DW', openHour: 6, openMinute: 0, drawHour: 5, drawMinute: 0 },
  SG: { shortCode: 'SG', openHour: 6, openMinute: 0, drawHour: 16, drawMinute: 30 },
  FB: { shortCode: 'FB', openHour: 6, openMinute: 0, drawHour: 18, drawMinute: 0 },
  GZ: { shortCode: 'GZ', openHour: 6, openMinute: 0, drawHour: 21, drawMinute: 55 },
  GL: { shortCode: 'GL', openHour: 6, openMinute: 0, drawHour: 23, drawMinute: 25 },
};

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function istParts(ms: number) {
  const d = new Date(ms + IST_OFFSET_MS);
  return {
    y: d.getUTCFullYear(),
    mo: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    h: d.getUTCHours(),
    mi: d.getUTCMinutes(),
    s: d.getUTCSeconds(),
  };
}

/** Wall-clock IST → UTC ms. */
export function istWallToUtcMs(y: number, mo: number, day: number, h: number, mi: number) {
  return Date.UTC(y, mo - 1, day, h, mi, 0) - IST_OFFSET_MS;
}

function addIstDays(y: number, mo: number, day: number, delta: number) {
  const utc = Date.UTC(y, mo - 1, day) + delta * 86400000;
  const d = new Date(utc);
  return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function isOvernight(sch: MarketSchedule) {
  return sch.drawHour * 60 + sch.drawMinute < sch.openHour * 60 + sch.openMinute;
}

export type DrawWindow = {
  openMs: number;
  drawMs: number;
  openLabel: string;
  drawLabel: string;
};

function fmtIst12(h: number, mi: number) {
  const am = h < 12;
  let hr = h % 12;
  if (hr === 0) hr = 12;
  const suffix = am ? 'am' : 'pm';
  return `${String(hr).padStart(2, '0')}:${String(mi).padStart(2, '0')} ${suffix}`;
}

/** Next play window for a market (open → draw). */
export function nextDrawWindow(shortCode: string, now = Date.now()): DrawWindow | null {
  const sch = MARKET_SCHEDULE[shortCode as MarketCode];
  if (!sch) return null;

  const p = istParts(now);
  let drawDay = { y: p.y, mo: p.mo, day: p.day };
  let drawMs = istWallToUtcMs(drawDay.y, drawDay.mo, drawDay.day, sch.drawHour, sch.drawMinute);

  if (now >= drawMs) {
    drawDay = addIstDays(drawDay.y, drawDay.mo, drawDay.day, 1);
    drawMs = istWallToUtcMs(drawDay.y, drawDay.mo, drawDay.day, sch.drawHour, sch.drawMinute);
  }

  let openDay = { ...drawDay };
  if (isOvernight(sch)) {
    openDay = addIstDays(drawDay.y, drawDay.mo, drawDay.day, -1);
  }
  const openMs = istWallToUtcMs(openDay.y, openDay.mo, openDay.day, sch.openHour, sch.openMinute);

  return {
    openMs,
    drawMs,
    openLabel: fmtIst12(sch.openHour, sch.openMinute),
    drawLabel: fmtIst12(sch.drawHour, sch.drawMinute),
  };
}

export function formatMarketRange(shortCode: string): string {
  const sch = MARKET_SCHEDULE[shortCode as MarketCode];
  if (!sch) return '';
  return `(${fmtIst12(sch.openHour, sch.openMinute)} - ${fmtIst12(sch.drawHour, sch.drawMinute)})`;
}

/** Format a UTC ms instant as IST 12h clock. */
export function formatIstTimeFromMs(ms: number) {
  const d = new Date(ms + IST_OFFSET_MS);
  return fmtIst12(d.getUTCHours(), d.getUTCMinutes());
}

/** Today XX / missing → pending; digit → result out. */
export function isScrapedPending(lastScraped: string | null | undefined): boolean {
  if (!lastScraped) return true;
  const t = lastScraped.trim().toUpperCase();
  if (t === 'XX' || t === '--' || t === '') return true;
  return !/^\d{1,2}$/.test(t);
}

export function scrapedDigit(lastScraped: string | null | undefined): string | null {
  if (!lastScraped) return null;
  const t = lastScraped.trim();
  if (/^\d{1,2}$/.test(t)) return t.padStart(2, '0');
  return null;
}

export type MarketOpenInput = {
  short_code: string;
  is_active: boolean;
  last_scraped_result?: string | null;
  result?: string | null;
  next_result_at?: string | null;
  betting_closes_at?: string | null;
};

/** Effective last-entry cutoff (ms). Admin override wins until that round ends; else draw − 30s. */
export function effectiveBettingCloseMs(game: MarketOpenInput, now = Date.now()): number | null {
  const win = nextDrawWindow(game.short_code, now);

  if (game.betting_closes_at) {
    const t = new Date(game.betting_closes_at).getTime();
    if (!Number.isNaN(t)) {
      // Stale override from a previous round (before this window opened) → ignore, use scrap
      if (win && t < win.openMs) {
        /* fall through */
      } else {
        return t;
      }
    }
  }

  if (win) return win.drawMs - 30_000;
  if (game.next_result_at) return new Date(game.next_result_at).getTime() - 30_000;
  return null;
}

/** True when admin override is active for the current round (not stale). */
export function hasActiveBettingCloseOverride(game: MarketOpenInput, now = Date.now()): boolean {
  if (!game.betting_closes_at) return false;
  const t = new Date(game.betting_closes_at).getTime();
  if (Number.isNaN(t)) return false;
  const win = nextDrawWindow(game.short_code, now);
  if (win && t < win.openMs) return false;
  return true;
}

/**
 * List label: day-open → effective last-entry (admin override if set, else scrap draw).
 */
export function formatMarketListRange(game: MarketOpenInput, now = Date.now()): string {
  const sch = MARKET_SCHEDULE[game.short_code as MarketCode];
  const openLabel = sch
    ? fmtIst12(sch.openHour, sch.openMinute)
    : nextDrawWindow(game.short_code, now)?.openLabel || '—';

  if (hasActiveBettingCloseOverride(game, now) && game.betting_closes_at) {
    const closeMs = new Date(game.betting_closes_at).getTime();
    return `(${openLabel} - ${formatIstTimeFromMs(closeMs)})`;
  }

  const official = formatMarketRange(game.short_code);
  if (official) return official;

  const win = nextDrawWindow(game.short_code, now);
  if (win) return `(${win.openLabel} - ${win.drawLabel})`;
  return '';
}

/**
 * Green only when satta today is still XX/pending AND before last-entry time
 * (admin override or scrap draw − 30s). Digit out → red/closed.
 */
export function isMarketBettingOpen(game: MarketOpenInput, now = Date.now()): boolean {
  if (!game.is_active) return false;

  if (!isScrapedPending(game.last_scraped_result)) return false;

  const win = nextDrawWindow(game.short_code, now);
  if (win && now < win.openMs) return false;

  const closeMs = effectiveBettingCloseMs(game, now);
  if (closeMs != null) return now < closeMs;

  return game.is_active;
}

/** Digit to show on red (closed) rows — today's scrape, else last result. */
export function displayResultDigit(game: MarketOpenInput): string | null {
  const today = scrapedDigit(game.last_scraped_result);
  if (today) return today;
  if (game.result && /^\d{1,2}$/.test(String(game.result).trim())) {
    return String(game.result).trim().padStart(2, '0');
  }
  return null;
}
