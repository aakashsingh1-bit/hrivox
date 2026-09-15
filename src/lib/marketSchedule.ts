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

/** Next betting window for a market (open → draw). */
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
};

/**
 * Green only when satta today is still XX/pending AND wall clock is inside
 * [day-open, draw − 30s). Digit on the board (result out) → red/closed immediately.
 */
export function isMarketBettingOpen(game: MarketOpenInput, now = Date.now()): boolean {
  if (!game.is_active) return false;

  // Satta-king today column has a digit → that draw is over; stay closed until XX again.
  if (!isScrapedPending(game.last_scraped_result)) return false;

  const win = nextDrawWindow(game.short_code, now);
  if (win) {
    return now >= win.openMs && now < win.drawMs - 30_000;
  }

  if (!game.next_result_at) return game.is_active;
  return new Date(game.next_result_at).getTime() - now > 30_000;
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
