// pilot.js — validate on a small set of channels BEFORE scaling to 100.
// Never writes to Sheets. Prints the client-detection audit so you can eyeball
// whether guests were labelled correctly and what counts as a response.
//
//   node pilot.js                         -> first 10 channels the bot is in
//   PILOT_CHANNELS="a,b,c" node pilot.js  -> only these channel names/ids
import 'dotenv/config';
import config from './config.js';
import { collect } from './lib/collect.js';
import { aggregate } from './lib/metrics.js';
import { classifyNeedsResponse } from './lib/llm-classify.js';
import { formatMinutes } from './lib/business-hours.js';

const want = (process.env.PILOT_CHANNELS || '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT = parseInt(process.env.PILOT_LIMIT || '10', 10);

const channelFilter = (channels) => {
  if (want.length) return channels.filter((c) => want.includes(c.name) || want.includes(c.id));
  return channels.slice(0, LIMIT);
};

const { tickets, channelsById, users, summary, window } = await collect(
  { channelFilter, log: (m) => console.error(m) },
  config
);
await classifyNeedsResponse(tickets, config, { log: (m) => console.error(m) });

console.log(`\n=== PILOT — channel detection audit ===`);
console.log(`(window: last ${config.lookbackDays} days, tz ${config.timezone}, SLA ${config.slaBusinessMinutes}m)\n`);
console.log('  CLIENT?  msgs  clientMsgs  channel');
for (const s of summary) {
  console.log(`  ${(s.isClient ? 'YES' : 'no ').padEnd(7)} ${String(s.msgs).padStart(4)}  ${String(s.clientMsgs).padStart(9)}   #${s.name}`);
}

console.log(`\n=== Sample tickets (first 15) ===`);
for (const t of tickets.slice(0, 15)) {
  const who = users.get(t.clientUser)?.name || t.clientUser;
  const resp = t.responder ? (users.get(t.responder)?.name || t.responder) : '—';
  const time = t.status === 'answered' ? formatMinutes(t.businessMinutes) : t.status;
  const snippet = (t.text || '').replace(/\s+/g, ' ').slice(0, 50);
  console.log(`  [${t.status.padEnd(10)}] #${t.channelName} | ${who} -> ${resp} | ${time} | "${snippet}"`);
}

const results = aggregate(tickets, config, channelsById);
const o = results.overall;
console.log(`\n=== Rollup (pilot only) ===`);
console.log(`SLA hit rate : ${o.slaHitRate ?? 'n/a'}%  | median ${formatMinutes(o.medianMinutes)} | p90 ${formatMinutes(o.p90Minutes)}`);
console.log(`Client msgs  : ${o.clientMessages} (answered ${o.answered}, unanswered ${o.unanswered}, excluded ${o.excluded})`);
console.log(`\nReview the CLIENT? column and sample tickets above. If anything is mislabelled,`);
console.log(`adjust clientOverrides / teamOverrides / channelScope in config.js, then re-run.`);
