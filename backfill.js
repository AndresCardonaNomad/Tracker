// backfill.js — populate the "Response Time" tab with several PAST weeks at once.
// Each week becomes one row; "Response Time Detail" ends on the most recent week.
// Safe to re-run (rows upsert by week label).
//
//   node backfill.js                 -> last 8 weeks
//   BACKFILL_WEEKS=12 node backfill.js
//   node backfill.js --dry           -> compute + print only, no Sheets write
import 'dotenv/config';
import config from './config.js';
import { collect } from './lib/collect.js';
import { aggregate } from './lib/metrics.js';
import { classifyNeedsResponse } from './lib/llm-classify.js';
import { writeResults, weekLabel } from './lib/sheets.js';
import { formatMinutes } from './lib/business-hours.js';

const WEEKS = parseInt(process.env.BACKFILL_WEEKS || '8', 10);
const DRY = process.argv.includes('--dry');
const now = Math.floor(Date.now() / 1000);

console.log(`Backfilling the last ${WEEKS} weeks into "${process.env.RESULTS_TAB || 'Response Time'}"...\n`);

for (let i = WEEKS - 1; i >= 0; i--) {
  const latest = now - i * 7 * 86400;
  const oldest = latest - 7 * 86400;
  const window = { oldest, latest };
  const label = weekLabel(window, config.weekLabelStyle, config.timezone);

  const { tickets, channelsById, users } = await collect({ window, log: () => {} }, config);
  await classifyNeedsResponse(tickets, config);
  const results = aggregate(tickets, config, channelsById);
  results.byResponder = results.byResponder.map((r) => ({ ...r, key: users.get(r.key)?.name || r.key }));
  const o = results.overall;

  if (o.clientMessages === 0) { console.log(`${label}: no client messages — skipped`); continue; }

  if (!DRY && process.env.RESULTS_SPREADSHEET_ID) {
    await writeResults(results, config, process.env, window);
  }
  console.log(`${label}: ${o.slaHitRate ?? 'n/a'}% hit | median ${formatMinutes(o.medianMinutes)} | p90 ${formatMinutes(o.p90Minutes)} | ${o.clientMessages} msgs (${o.answered} ans, ${o.unanswered} unans, ${o.excluded} excl)`);
}

console.log(`\nDone. One row per week in "${process.env.RESULTS_TAB || 'Response Time'}".`);
if (DRY) console.log('[--dry] Nothing was written to Sheets.');
