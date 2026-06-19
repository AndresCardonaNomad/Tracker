// run.js — full weekly run: pull all client channels, compute, write to Sheets.
//   node run.js            -> compute + write to Google Sheets
//   node run.js --dry      -> compute + print only, no Sheets write
import 'dotenv/config';
import config from './config.js';
import { collect } from './lib/collect.js';
import { aggregate } from './lib/metrics.js';
import { writeResults, weekLabel } from './lib/sheets.js';
import { formatMinutes } from './lib/business-hours.js';

const DRY = process.argv.includes('--dry');

const { tickets, channelsById, users, window } = await collect({ log: (m) => console.error(m) }, config);
const results = aggregate(tickets, config, channelsById);

// Resolve responder ids -> display names for readability.
results.byResponder = results.byResponder.map((r) => ({ ...r, key: users.get(r.key)?.name || r.key }));

const o = results.overall;
const label = weekLabel(window, config.weekLabelStyle);

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
