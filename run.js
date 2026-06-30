// run.js — full weekly run: pull all client channels, compute, write to Sheets.
//   node run.js            -> compute + write to Google Sheets
//   node run.js --dry      -> compute + print only, no Sheets write
import 'dotenv/config';
import config from './config.js';
import { collect } from './lib/collect.js';
import { aggregate } from './lib/metrics.js';
import { classifyNeedsResponse } from './lib/llm-classify.js';
import { writeResults, weekLabel } from './lib/sheets.js';
import { formatMinutes, startOfISOWeekSec } from './lib/business-hours.js';

const DRY = process.argv.includes('--dry');

// --week-offset N : 0 = current ISO week (default), -1 = last full ISO week.
const offArg = process.argv.find((a) => a.startsWith('--week-offset'));
const weekOffset = offArg ? parseInt(offArg.split('=')[1] ?? process.argv[process.argv.indexOf(offArg) + 1], 10) || 0 : 0;

// Measure an ISO week (Monday 00:00 local -> end) so the nightly number lines
// up exactly with the weekly rows / backfill. offset shifts whole weeks back.
const now = Math.floor(Date.now() / 1000);
const thisWeekStart = startOfISOWeekSec(now, config);
const oldest = thisWeekStart + weekOffset * 7 * 86400;
// For a past week, end 1s before next Monday so the ISO week label lands inside
// that week (not on the boundary, which would mislabel it as the next week).
const latest = weekOffset < 0 ? oldest + 7 * 86400 - 1 : now;
const window = { oldest, latest };
const { tickets, channelsById, users } = await collect({ log: (m) => console.error(m), window }, config);
await classifyNeedsResponse(tickets, config, { log: (m) => console.error(m) });
const results = aggregate(tickets, config, channelsById);

// Resolve responder ids -> display names for readability.
results.byResponder = results.byResponder.map((r) => ({ ...r, key: users.get(r.key)?.name || r.key }));

const o = results.overall;
const label = weekLabel(window, config.weekLabelStyle, config.timezone);

console.log(`\n=== Client Response Time — ${label} ===`);
console.log(`SLA (${config.slaBusinessMinutes} business min) hit rate : ${o.slaHitRate ?? 'n/a'}%`);
console.log(`Median first response               : ${formatMinutes(o.medianMinutes)}`);
console.log(`p90 first response                  : ${formatMinutes(o.p90Minutes)}`);
console.log(`Client messages / answered / unans. : ${o.clientMessages} / ${o.answered} / ${o.unanswered}`);
console.log(`Excluded (no-action / fyi / ack)    : ${o.excluded}`);
console.log(`Client channels measured            : ${results.byChannel.length}`);

console.log(`\n--- By team ---`);
for (const t of results.byTeam) {
  console.log(`  ${t.team.padEnd(12)} ${String(t.slaHitRate ?? 'n/a').padStart(5)}%  med ${formatMinutes(t.medianMinutes)}  (${t.answered}/${t.clientMessages})`);
}
console.log(`\n--- Worst channels ---`);
for (const c of results.byChannel.slice(0, 10)) {
  console.log(`  ${(c.channelName || c.channelId).padEnd(24)} ${String(c.slaHitRate ?? 'n/a').padStart(5)}%  med ${formatMinutes(c.medianMinutes)}  (${c.answered}/${c.clientMessages})`);
}

if (DRY) {
  console.log('\n[--dry] Skipped Google Sheets write.');
} else if (!process.env.RESULTS_SPREADSHEET_ID) {
  console.log('\nNo RESULTS_SPREADSHEET_ID set — skipped Sheets write. (Use --dry to silence this.)');
} else {
  const out = await writeResults(results, config, process.env, window);
  console.log(`\nWrote summary row to "${out.summaryTab}" and detail to "${out.detailTab}".`);
}
