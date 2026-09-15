/**
 * V2 Crossing expansion tests (run: node --experimental-strip-types src/lib/crossing.test.mjs)
 * or: node --input-type=module --experimental-strip-types src/lib/crossing.test.mjs
 */
import { expandCrossing, assertBetAmountsAllowed, assertMarketMinBet } from './crossing.ts';
import { isMarketBettingOpen, nextDrawWindow, formatMarketRange } from './marketSchedule.ts';

const cases = [
  ['573', 10, false, 9, 90],
  ['573', 10, true, 6, 60],
  ['5734', 10, false, 16, 160],
  ['5734', 10, true, 12, 120],
  ['57349', 10, false, 25, 250],
  ['57349', 10, true, 20, 200],
  ['573490', 10, false, 36, 360],
  ['573490', 10, true, 30, 300],
  ['5734902', 10, false, 49, 490],
  ['5734902', 10, true, 42, 420],
  ['57349021', 10, false, 64, 640],
  ['57349021', 10, true, 56, 560],
];

let failed = 0;
for (const [base, amt, cut, count, total] of cases) {
  const r = expandCrossing(base, amt, cut);
  if (r.count !== count || r.total !== total) {
    console.error('FAIL', { base, cut, got: r, expected: { count, total } });
    failed++;
  }
}

const soon = new Date(Date.now() + 20 * 60 * 1000).toISOString();
if (assertBetAmountsAllowed([201], soon) !== 'Max bet Rs 200 in final hour') {
  console.error('FAIL bet cap');
  failed++;
}

if (assertMarketMinBet([99]) !== 'Minimum bet Rs 100') {
  console.error('FAIL market min');
  failed++;
}
if (assertMarketMinBet([100]) !== null) {
  console.error('FAIL market min ok');
  failed++;
}

// 00:39 IST ≈ Desawar open, evening markets closed (before 06:00 open)
const istMidnightish = Date.UTC(2026, 8, 14, 19, 9, 0); // 2026-09-15 00:39 IST
const dwOpen = isMarketBettingOpen(
  { short_code: 'DW', is_active: true, last_scraped_result: 'XX', result: '35' },
  istMidnightish,
);
const fbOpen = isMarketBettingOpen(
  { short_code: 'FB', is_active: true, last_scraped_result: 'XX', result: '30' },
  istMidnightish,
);
if (!dwOpen) {
  console.error('FAIL Desawar should be open at 00:39 IST', nextDrawWindow('DW', istMidnightish));
  failed++;
}
if (fbOpen) {
  console.error('FAIL Faridabad should be closed at 00:39 IST', nextDrawWindow('FB', istMidnightish));
  failed++;
}

if (formatMarketRange('DW') !== '(06:00 am - 05:00 am)') {
  console.error('FAIL range DW', formatMarketRange('DW'));
  failed++;
}

// 09:04 IST — Desawar result out (89) must be closed/red even though next window is open
const istMorning = Date.UTC(2026, 8, 15, 3, 34, 0); // 2026-09-15 09:04 IST
const dwClosedAfterResult = isMarketBettingOpen(
  { short_code: 'DW', is_active: true, last_scraped_result: '89', result: '89' },
  istMorning,
);
const fbOpenMorning = isMarketBettingOpen(
  { short_code: 'FB', is_active: true, last_scraped_result: 'XX', result: '30' },
  istMorning,
);
if (dwClosedAfterResult) {
  console.error('FAIL Desawar must be closed when scrape digit 89');
  failed++;
}
if (!fbOpenMorning) {
  console.error('FAIL Faridabad should stay open at 09:04 with XX');
  failed++;
}

if (failed) {
  console.error(`Failed ${failed}`);
  process.exit(1);
}
console.log('All V2 crossing/cap/schedule checks passed');
