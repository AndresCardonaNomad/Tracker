# HANDOFF — Client Response Time Tracker (Nomad Content Studio)

> Self-contained handoff. Another instance of Claude, with zero access to the build chat, can rebuild and integrate this from the contents below. Owner: Andres (Nomad Content Studio). Built June 2026.

---

## 1. PURPOSE
Measures how fast the Nomad team responds to clients across all of the agency's client Slack channels (one channel per client, ~100+ at full scale; 8 live during pilot). Clients drop requests in their channel ("take this down", "why hasn't this posted", "swap these two videos"); the tool measures the time from a client message to the team's first reply, rolls it into a single weekly KPI ("Client Response Time"), and writes it — plus a per-team / per-writer / per-channel breakdown — into the director's "Writer Director Scorecard" Google Sheet. It runs automatically every night in the cloud (GitHub Actions), independent of anyone's computer. v1 is a scheduled history-pull (batch) design; a realtime Socket Mode version is a future v2.

---

## 2. EXACT METRIC DEFINITION

**Headline KPI — SLA hit rate:** the % of counted client messages whose first team reply landed within `slaBusinessMinutes` (currently **10 business minutes**). This is the single number on the scorecard.

**Supporting numbers:** median first-response time and p90 first-response time (both in business minutes), reported overall and per breakdown.

**"Ticket" model (one client request = one ticket):**
- A ticket opens on the first client message in a conversation that has no open ticket.
- It closes on the first **team** human reply after it; response time = business minutes between open and that reply.
- **Consecutive client messages with no team reply between them collapse into ONE ticket**, timed from the EARLIEST message (so a client double/triple-texting can't reset the clock; fair to the client).
- A "conversation" = a Slack thread (keyed by `thread_ts`) OR the channel's non-threaded "main" stream. Thread replies are matched only within their thread, so a reply in thread A is never paired to an unrelated main-channel message.

**What counts as a reply:** the first text message from a non-client, non-bot human (i.e. role `team`). 

**Ticket statuses & SLA denominator:**
- `answered` — got a team reply → counted; has `businessMinutes` and `withinSla`.
- `unanswered` — no reply by window close → counted (counts against the rate).
- `no_action` — the client message carries the `:no_action:` reaction (a teammate marked it "no reply needed") → **excluded**.
- `fyi_ignored` — unanswered AND a pure acknowledgement/closer ("thanks", "got it", "perfect 👍"), OR shorter than `ignoreUnansweredShorterThan` chars → **excluded**.
- `ack_only` — only if `countEmojiAsResponse: true` and the message had an emoji but no text reply → excluded (off by default).
- **SLA denominator = answered + unanswered.** Excluded statuses are not counted at all.
- `slaHitRate = (answered within slaBusinessMinutes) / (answered + unanswered) * 100`.

**Acknowledgement detector (anti-noise):** a message is an "ack" only if EVERY word is in an acknowledgement token set (thanks/ok/got it/perfect/etc.), after stripping mentions, links, emoji, punctuation; messages >6 tokens are never acks. This guarantees a real short request like "take it down" is never excluded. Only applied to UNANSWERED messages.

**Business-hours handling:** response time counts only minutes that fall on working days, within working hours, excluding holidays (config: `timezone` America/Bogota, `workingDays` Mon–Fri, `workStartHour` 9, `workEndHour` 17, `holidays` list). Example: a Friday-17:00 client message answered Monday-09:10 ≈ 10 business minutes, not a weekend. Timezone math is done with `Intl.DateTimeFormat` (no external date lib); assumes the tz has a stable UTC offset across a working day (true for Bogota — no DST).

**Anti-gaming:** emoji reactions never count as a response (`countEmojiAsResponse: false`); double-texts collapse and time from the earliest; only the first substantive human reply closes a ticket.

**Edge cases / known limits:** only channels the bot is a member of are scanned; a thread whose parent predates the lookback window can be missed (rare; v2 realtime removes this); users who left the workspace classify as `unknown` and are ignored; Slack doesn't expose reaction timestamps, so emoji acks are presence-only and never timed.

---

## 3. DATA SOURCE
**Slack** (workspace "Nomads Cast", team_id `T0434DPH1B8`), via the Slack Web API (read-only) using a custom bot app's `xoxb-` token.
- `auth.test` → own team_id (to detect Slack Connect external users).
- `users.list` → roster with guest flags. Each user mapped to `{id, name, email, isBot, isRestricted, isUltraRestricted, teamId, deleted}`.
- `users.conversations` → the channels the bot is a member of (public + private).
- `conversations.history` (+ `conversations.replies` per threaded parent) → messages in the lookback window (default 7 days).

**Client vs. team detection (the crux):** clients are invited by email to a single channel, which provisions them as Slack **guests** (`is_restricted` multi-channel / `is_ultra_restricted` single-channel) or, if their email belongs to another Slack org, as **Slack Connect** users (different `team_id`). So a user is classified:
- `client` if guest OR foreign team_id OR in `clientOverrides`.
- `team` if full member of the workspace OR in `teamOverrides` (override wins over guest flag).
- `bot` if `is_bot` / Slackbot. `unknown` if not in roster.
No hand-maintained client list needed; overrides handle edge cases.

**Which channels count (`channelScope`):** `auto` (default) = any channel where ≥1 external user has posted; `prefix` = name starts with `channelPrefix`; `allowlist` = explicit IDs/names. `channelDenylist` always excludes.

Validated on the pilot: all 8 client channels auto-detected correctly with zero overrides. Two names to sanity-check if they recur (Jimmy Douglas / Spencer Reich) — flagged as clients because they're guests; add to `teamOverrides` if either is actually staff.

---

## 4. FILES
Repo root = the project folder. Standalone git repo pushed to GitHub at **github.com/AndresCardonaNomad/Tracker** (private). Also a working copy in the Obsidian vault at `02 Projects/Client Response Time Tracker/`. Tree:

```
Client Response Time Tracker/
  config.js                  # all tunable rules (hours, SLA, scoping, overrides)
  run.js                     # full run: pull -> compute -> write to Sheets
  pilot.js                   # subset run, verbose audit, never writes to Sheets
  run-daily.bat              # Windows wrapper (used by the now-superseded Task Scheduler path)
  package.json               # ESM, Node >=20, deps: dotenv + googleapis
  .gitignore                 # blocks .env, credentials.json, node_modules
  .env.example               # template for secrets
  .github/workflows/daily.yml# GitHub Actions nightly cron (the live runner)
  lib/
    slack.js                 # Slack Web API client (fetch + pagination + 429 backoff)
    classify.js              # client/team/bot classification + channel scoping
    business-hours.js        # business-minutes elapsed between two timestamps
    metrics.js               # ticket pairing + acknowledgement filter + aggregation
    collect.js               # orchestrates Slack pull -> normalize -> tickets
    sheets.js                # writes weekly summary + detail tabs to Google Sheets
  tests/
    logic.test.js            # 11 unit tests (business-hours, classify, metrics)
```

### config.js
```js
// config.js — all tunable rules for the Client Response Time Tracker.
// Everything here is a one-line change. No business logic lives in this file.

export const config = {
  // BUSINESS HOURS — the response clock only ticks during these hours.
  timezone: 'America/Bogota',
  workingDays: [1, 2, 3, 4, 5],      // 0=Sun ... 6=Sat (Mon–Fri)
  workStartHour: 9,                  // 09:00 local
  workEndHour: 17,                   // 17:00 local
  holidays: [],                      // 'YYYY-MM-DD' dates the clock is paused

  // SLA — headline number: % of client msgs answered within N business minutes.
  slaBusinessMinutes: 10,

  // CLIENT-vs-TEAM DETECTION overrides (edge cases only). IDs or emails.
  clientOverrides: [],   // force these users to count as CLIENT
  teamOverrides: [],     // force these users to count as TEAM

  // CHANNEL SCOPING — 'auto' | 'prefix' | 'allowlist'
  channelScope: 'auto',
  channelPrefix: 'client-',
  channelAllowlist: [],
  channelDenylist: [],

  // WHAT COUNTS AS A RESPONSE
  countEmojiAsResponse: false,       // emoji reaction never counts as a reply
  excludeAcknowledgements: true,     // drop unanswered "thanks"/"got it" closers
  ignoreUnansweredShorterThan: 0,    // chars; 0 = disabled (ack filter is primary)
  noActionEmoji: 'no_action',        // teammate adds this emoji to exclude a msg

  // REPORTING WINDOW
  lookbackDays: 7,
  weekLabelStyle: 'iso',             // 'iso' => 2026-W25 ; 'date' => wk ending YYYY-MM-DD

  // ASSIGNED-TEAM MAP (optional) — channel (id or name) -> team/pod.
  channelTeamMap: {},
};

export default config;
```

### lib/slack.js
```js
// lib/slack.js — thin Slack Web API client built on global fetch (Node 18+).
// Handles pagination and 429 rate-limit backoff. Read-only.

const SLACK_API = 'https://slack.com/api';

function token() {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error('SLACK_BOT_TOKEN is not set (see .env.example)');
  return t;
}

async function call(method, params = {}, { paginate = false, collect = null } = {}) {
  const out = [];
  let cursor;
  for (;;) {
    const body = new URLSearchParams({ ...params });
    if (cursor) body.set('cursor', cursor);
    const res = await fetch(`${SLACK_API}/${method}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token()}`,
        'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      },
      body,
    });
    if (res.status === 429) {
      const wait = (parseInt(res.headers.get('retry-after') || '2', 10) + 1) * 1000;
      await sleep(wait);
      continue;
    }
    const json = await res.json();
    if (!json.ok) {
      if (json.error === 'ratelimited') { await sleep(2000); continue; }
      throw new Error(`Slack ${method} failed: ${json.error}`);
    }
    if (!paginate) return json;
    if (collect) out.push(...(collect(json) || []));
    cursor = json.response_metadata?.next_cursor;
    if (!cursor) break;
    await sleep(150);
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function getOwnTeamId() {
  const json = await call('auth.test');
  return json.team_id;
}

export async function fetchUsers() {
  const members = await call('users.list', { limit: '200' }, {
    paginate: true, collect: (j) => j.members,
  });
  const map = new Map();
  for (const m of members) {
    map.set(m.id, {
      id: m.id,
      name: m.profile?.display_name || m.real_name || m.name || m.id,
      email: m.profile?.email || null,
      isBot: !!m.is_bot || m.id === 'USLACKBOT',
      isRestricted: !!m.is_restricted,
      isUltraRestricted: !!m.is_ultra_restricted,
      teamId: m.team_id || null,
      deleted: !!m.deleted,
    });
  }
  return map;
}

export async function fetchChannels() {
  const chans = await call('users.conversations', {
    types: 'public_channel,private_channel',
    exclude_archived: 'true', limit: '200',
  }, { paginate: true, collect: (j) => j.channels });
  return chans.map((c) => ({ id: c.id, name: c.name, isPrivate: !!c.is_private }));
}

export async function fetchHistory(channelId, oldest, latest) {
  return call('conversations.history', {
    channel: channelId, oldest: String(oldest), latest: String(latest),
    inclusive: 'true', limit: '200',
  }, { paginate: true, collect: (j) => j.messages });
}

export async function fetchReplies(channelId, threadTs, oldest, latest) {
  return call('conversations.replies', {
    channel: channelId, ts: threadTs, oldest: String(oldest), latest: String(latest),
    inclusive: 'true', limit: '200',
  }, { paginate: true, collect: (j) => j.messages });
}

export default { getOwnTeamId, fetchUsers, fetchChannels, fetchHistory, fetchReplies };
```

### lib/classify.js
```js
// lib/classify.js — decide who is a CLIENT vs TEAM, and which channels count.
// Pure functions. No network.

export function classifyUser(userId, users, ownTeamId, config) {
  const u = users.get(userId);
  if (!u) return 'unknown';
  if (u.isBot) return 'bot';
  if (inList(u, config.teamOverrides)) return 'team';
  if (inList(u, config.clientOverrides)) return 'client';
  const isGuest = u.isRestricted || u.isUltraRestricted;
  const isForeignOrg = ownTeamId && u.teamId && u.teamId !== ownTeamId;
  if (isGuest || isForeignOrg) return 'client';
  return 'team';
}

function inList(user, list) {
  if (!list || list.length === 0) return false;
  return list.some((entry) => entry === user.id || (user.email && entry === user.email));
}

export function roleMap(userIds, users, ownTeamId, config) {
  const m = new Map();
  for (const id of userIds) m.set(id, classifyUser(id, users, ownTeamId, config));
  return m;
}

export function isClientChannel(channel, channelMessages, users, ownTeamId, config) {
  const denied = config.channelDenylist.some((e) => e === channel.id || e === channel.name);
  if (denied) return false;
  switch (config.channelScope) {
    case 'prefix':
      return (channel.name || '').startsWith(config.channelPrefix);
    case 'allowlist':
      return config.channelAllowlist.some((e) => e === channel.id || e === channel.name);
    case 'auto':
    default: {
      for (const msg of channelMessages) {
        if (!msg.user) continue;
        if (classifyUser(msg.user, users, ownTeamId, config) === 'client') return true;
      }
      return false;
    }
  }
}

export default { classifyUser, roleMap, isClientChannel };
```

### lib/business-hours.js
```js
// lib/business-hours.js — elapsed BUSINESS minutes between two unix timestamps.
// Clock ticks only on working days, within working hours, excluding holidays.
// Timezone-aware via Intl (no external deps). Assumes stable UTC offset across a
// working day (true for America/Bogota — no DST).

function parts(ms, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(new Date(ms)).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  let hour = parseInt(p.hour, 10); if (hour === 24) hour = 0;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return { y: +p.year, mo: +p.month, d: +p.day, asUTC };
}

function offsetAt(ms, tz) { return parts(ms, tz).asUTC - ms; }

function wallToMs(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return guess - offsetAt(guess, tz);
}

export function businessMinutesBetween(startSec, endSec, config) {
  const tz = config.timezone;
  const startMs = startSec * 1000;
  const endMs = endSec * 1000;
  if (endMs <= startMs) return 0;
  const holidays = new Set(config.holidays || []);
  const startParts = parts(startMs, tz);
  let { y, mo, d } = startParts;
  let total = 0;
  for (let i = 0; i < 400; i++) {
    const dayStartMs = wallToMs(y, mo, d, 0, 0, tz);
    if (dayStartMs > endMs) break;
    const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    if (config.workingDays.includes(wd) && !holidays.has(iso)) {
      const winStart = wallToMs(y, mo, d, config.workStartHour, 0, tz);
      const winEnd = wallToMs(y, mo, d, config.workEndHour, 0, tz);
      const lo = Math.max(startMs, winStart);
      const hi = Math.min(endMs, winEnd);
      if (hi > lo) total += hi - lo;
    }
    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    y = next.getUTCFullYear(); mo = next.getUTCMonth() + 1; d = next.getUTCDate();
  }
  return Math.round(total / 60000);
}

export function formatMinutes(min) {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default { businessMinutesBetween, formatMinutes };
```

### lib/metrics.js
```js
// lib/metrics.js — turn role-tagged messages into "tickets" and aggregate them.
// A ticket = a client message that needs a response. Opened by the first
// unanswered client message in a conversation, closed by the first team reply.
// Consecutive client messages with no team reply collapse into ONE ticket
// opened at the EARLIEST message. Threads are their own conversations; all
// non-threaded main-channel messages share the 'main' conversation.

import { businessMinutesBetween } from './business-hours.js';

const convKey = (m) => (m.thread_ts ? `t:${m.thread_ts}` : 'main');

export function computeChannelTickets(channel, messages, config) {
  const byConv = new Map();
  for (const m of messages) {
    const k = convKey(m);
    if (!byConv.has(k)) byConv.set(k, []);
    byConv.get(k).push(m);
  }
  const tickets = [];
  for (const conv of byConv.values()) {
    conv.sort((a, b) => a.ts - b.ts);
    let open = null;
    for (const m of conv) {
      if (m.role === 'client') {
        if (!open) {
          open = {
            channelId: channel.id, channelName: channel.name,
            openedTs: m.ts, clientUser: m.user, text: m.text || '',
            reactions: m.reactions || [], followUps: 0,
          };
        } else { open.followUps += 1; }
      } else if (m.role === 'team') {
        if (open) {
          open.responseTs = m.ts; open.responder = m.user;
          tickets.push(finalize(open, config)); open = null;
        }
      }
    }
    if (open) tickets.push(finalize(open, config));
  }
  return tickets;
}

function hasReaction(reactions, name) {
  return (reactions || []).some((r) => r.name === name);
}

// Pure-acknowledgement detector. A message is an ack only if EVERY word is an
// ack word — so a real request like "take it down" is never excluded.
const ACK_TOKENS = new Set([
  'thanks','thank','thankyou','thx','ty','tysm','tq','you','u','so','much','a','lot','really','very',
  'ok','okay','okey','k','kk','oki','got','it','gotcha','noted','understood','received',
  'perfect','great','awesome','amazing','excellent','nice','cool','sweet','appreciate','appreciated',
  'sounds','good','sound','looks','no','worries','np','problem','prob','yes','yep','yup','yeah','ya',
  'sure','done','love','this','that','them','all','set','cheers','yw','welcome','and','the',
]);

function normalizeAck(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/<@[^>]+>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu, ' ')
    .replace(/[^a-z\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAcknowledgement(text) {
  const t = normalizeAck(text);
  if (!t) return true;
  const tokens = t.split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length > 6) return false;
  return tokens.every((tok) => ACK_TOKENS.has(tok));
}

function finalize(t, config) {
  if (hasReaction(t.reactions, config.noActionEmoji)) return { ...t, status: 'no_action' };
  if (t.responseTs != null) {
    const businessMinutes = businessMinutesBetween(t.openedTs, t.responseTs, config);
    return { ...t, status: 'answered', businessMinutes, withinSla: businessMinutes <= config.slaBusinessMinutes };
  }
  if (config.excludeAcknowledgements && isAcknowledgement(t.text)) return { ...t, status: 'fyi_ignored' };
  if (config.ignoreUnansweredShorterThan > 0 && t.text.trim().length < config.ignoreUnansweredShorterThan) {
    return { ...t, status: 'fyi_ignored' };
  }
  if (config.countEmojiAsResponse && (t.reactions || []).length > 0) return { ...t, status: 'ack_only' };
  return { ...t, status: 'unanswered' };
}

const median = (arr) => percentile(arr, 50);
function percentile(arr, p) {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * s.length) - 1;
  return s[Math.min(Math.max(idx, 0), s.length - 1)];
}

function assignedTeam(channel, config) {
  return config.channelTeamMap[channel.name] || config.channelTeamMap[channel.id] || 'Unassigned';
}

export function aggregate(tickets, config, channelsById = new Map()) {
  const counted = tickets.filter((t) => t.status === 'answered' || t.status === 'unanswered');
  const answered = counted.filter((t) => t.status === 'answered');
  const times = answered.map((t) => t.businessMinutes);
  const withinSla = answered.filter((t) => t.withinSla).length;
  const overall = {
    clientMessages: counted.length,
    answered: answered.length,
    unanswered: counted.length - answered.length,
    excluded: tickets.length - counted.length,
    slaHitRate: counted.length ? round1((withinSla / counted.length) * 100) : null,
    medianMinutes: median(times),
    p90Minutes: percentile(times, 90),
  };
  const byResponder = groupStats(answered, (t) => t.responder, config);
  const byChannelMap = new Map();
  for (const t of counted) {
    const key = t.channelId;
    if (!byChannelMap.has(key)) byChannelMap.set(key, { channelId: t.channelId, channelName: t.channelName, list: [] });
    byChannelMap.get(key).list.push(t);
  }
  const byChannel = [...byChannelMap.values()].map((c) => ({
    channelId: c.channelId, channelName: c.channelName,
    team: assignedTeam({ id: c.channelId, name: c.channelName }, config),
    ...statsFor(c.list, config),
  })).sort((a, b) => (a.slaHitRate ?? 0) - (b.slaHitRate ?? 0));
  const byTeamMap = new Map();
  for (const c of byChannel) {
    if (!byTeamMap.has(c.team)) byTeamMap.set(c.team, []);
    byTeamMap.get(c.team).push(...byChannelMap.get(c.channelId).list);
  }
  const byTeam = [...byTeamMap.entries()].map(([team, list]) => ({ team, ...statsFor(list, config) }))
    .sort((a, b) => (a.slaHitRate ?? 0) - (b.slaHitRate ?? 0));
  return { overall, byResponder, byChannel, byTeam };
}

function statsFor(list, config) {
  const counted = list.filter((t) => t.status === 'answered' || t.status === 'unanswered');
  const answered = counted.filter((t) => t.status === 'answered');
  const times = answered.map((t) => t.businessMinutes);
  const within = answered.filter((t) => t.withinSla).length;
  return {
    clientMessages: counted.length, answered: answered.length,
    unanswered: counted.length - answered.length,
    slaHitRate: counted.length ? round1((within / counted.length) * 100) : null,
    medianMinutes: median(times), p90Minutes: percentile(times, 90),
  };
}

function groupStats(answeredTickets, keyFn, config) {
  const m = new Map();
  for (const t of answeredTickets) { const k = keyFn(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); }
  return [...m.entries()].map(([key, list]) => ({
    key, responses: list.length, medianMinutes: median(list.map((t) => t.businessMinutes)),
    withinSla: list.filter((t) => t.withinSla).length,
    slaHitRate: round1((list.filter((t) => t.withinSla).length / list.length) * 100),
  })).sort((a, b) => b.responses - a.responses);
}

const round1 = (n) => Math.round(n * 10) / 10;

export default { computeChannelTickets, aggregate };
```

### lib/collect.js
```js
// lib/collect.js — pull Slack data, tag roles, and produce tickets.
// Shared by run.js (full) and pilot.js (subset, verbose). Read-only on Slack.

import slack from './slack.js';
import { classifyUser, isClientChannel } from './classify.js';
import { computeChannelTickets } from './metrics.js';

const SKIP_SUBTYPES = new Set([
  'channel_join', 'channel_leave', 'channel_topic', 'channel_purpose',
  'channel_name', 'channel_archive', 'channel_unarchive', 'message_changed',
  'message_deleted', 'pinned_item', 'bot_add', 'bot_remove', 'reminder_add',
]);

function normalize(msg, users, ownTeamId, config) {
  if (msg.subtype && SKIP_SUBTYPES.has(msg.subtype)) return null;
  const role = msg.user ? classifyUser(msg.user, users, ownTeamId, config) : 'bot';
  return {
    ts: parseFloat(msg.ts),
    user: msg.user || null,
    text: msg.text || '',
    thread_ts: msg.thread_ts || undefined,
    role,
    reactions: (msg.reactions || []).map((r) => ({ name: r.name, count: r.count })),
  };
}

export async function collect({ channelFilter = null, log = () => {} } = {}, config) {
  const [ownTeamId, users] = await Promise.all([slack.getOwnTeamId(), slack.fetchUsers()]);
  log(`Roster: ${users.size} users. Own team: ${ownTeamId}`);
  let channels = await slack.fetchChannels();
  if (channelFilter) channels = channelFilter(channels);
  log(`Bot is in ${channels.length} channel(s) to scan.`);
  const latest = Math.floor(Date.now() / 1000);
  const oldest = latest - config.lookbackDays * 86400;
  const allTickets = [];
  const channelsById = new Map();
  const summary = [];
  for (const ch of channels) {
    let raw;
    try { raw = await slack.fetchHistory(ch.id, oldest, latest); }
    catch (e) { log(`  ! skip #${ch.name}: ${e.message}`); continue; }
    const seen = new Set(raw.map((m) => m.ts));
    const parents = raw.filter((m) => m.thread_ts && m.reply_count > 0);
    for (const p of parents) {
      try {
        const replies = await slack.fetchReplies(ch.id, p.thread_ts, oldest, latest);
        for (const r of replies) if (!seen.has(r.ts)) { raw.push(r); seen.add(r.ts); }
      } catch { /* ignore one bad thread */ }
    }
    const isClient = isClientChannel(ch, raw, users, ownTeamId, config);
    const normalized = raw.map((m) => normalize(m, users, ownTeamId, config)).filter(Boolean);
    const clientMsgs = normalized.filter((m) => m.role === 'client').length;
    summary.push({ name: ch.name, id: ch.id, isClient, msgs: normalized.length, clientMsgs });
    if (!isClient) continue;
    channelsById.set(ch.id, { id: ch.id, name: ch.name });
    const tickets = computeChannelTickets(ch, normalized, config);
    allTickets.push(...tickets);
  }
  return { tickets: allTickets, channelsById, summary, users, ownTeamId, window: { oldest, latest } };
}

export default { collect };
```

### lib/sheets.js
```js
// lib/sheets.js — write weekly results to Google Sheets via service account.
// Output: <RESULTS_TAB> = one upserted summary row per week (scorecard feed);
//         <RESULTS_TAB> Detail = overwritten each run (by team/writer/channel).

import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { formatMinutes } from './business-hours.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials.json');

async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

export function weekLabel(window, style) {
  const d = new Date(window.latest * 1000);
  if (style === 'date') return `wk ending ${d.toISOString().slice(0, 10)}`;
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

async function ensureTab(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId, requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }
}

function normalizeSpreadsheetId(value) {
  if (!value) return value;
  const m = String(value).match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : String(value).trim();
}

export async function writeResults(results, config, env, window) {
  const sheets = await getSheets();
  const spreadsheetId = normalizeSpreadsheetId(env.RESULTS_SPREADSHEET_ID);
  const tab = env.RESULTS_TAB || 'Response Time';
  const detailTab = `${tab} Detail`;
  const label = weekLabel(window, config.weekLabelStyle);
  const o = results.overall;
  await ensureTab(sheets, spreadsheetId, tab);
  await ensureTab(sheets, spreadsheetId, detailTab);

  const header = ['Week', 'SLA Hit %', 'Median', 'p90', 'Client Msgs', 'Answered', 'Unanswered', 'Channels', 'Updated'];
  const row = [
    label, o.slaHitRate ?? '', formatMinutes(o.medianMinutes), formatMinutes(o.p90Minutes),
    o.clientMessages, o.answered, o.unanswered, results.byChannel.length, new Date().toISOString(),
  ];
  const existing = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${tab}!A:A` });
  const labels = (existing.data.values || []).map((r) => r[0]);
  if (labels.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `${tab}!A1`, valueInputOption: 'RAW', requestBody: { values: [header, row] },
    });
  } else {
    const idx = labels.indexOf(label);
    if (idx > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `${tab}!A${idx + 1}`, valueInputOption: 'RAW', requestBody: { values: [row] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId, range: `${tab}!A:A`, valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS', requestBody: { values: [row] },
      });
    }
  }

  const block = [];
  block.push([`Client Response Time — detail for ${label}`]);
  block.push([]);
  block.push(['BY TEAM (assigned channels)']);
  block.push(['Team', 'SLA Hit %', 'Median', 'p90', 'Client Msgs', 'Answered', 'Unanswered']);
  for (const t of results.byTeam) block.push([t.team, t.slaHitRate ?? '', formatMinutes(t.medianMinutes), formatMinutes(t.p90Minutes), t.clientMessages, t.answered, t.unanswered]);
  block.push([]);
  block.push(['BY WRITER (who responded)']);
  block.push(['Writer (user id)', 'Responses', 'SLA Hit %', 'Median', 'Within SLA']);
  for (const r of results.byResponder) block.push([r.key, r.responses, r.slaHitRate ?? '', formatMinutes(r.medianMinutes), r.withinSla]);
  block.push([]);
  block.push(['BY CHANNEL (worst first)']);
  block.push(['Channel', 'Team', 'SLA Hit %', 'Median', 'p90', 'Client Msgs', 'Answered', 'Unanswered']);
  for (const c of results.byChannel) block.push([c.channelName, c.team, c.slaHitRate ?? '', formatMinutes(c.medianMinutes), formatMinutes(c.p90Minutes), c.clientMessages, c.answered, c.unanswered]);

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${detailTab}!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `${detailTab}!A1`, valueInputOption: 'RAW', requestBody: { values: block },
  });
  return { label, summaryTab: tab, detailTab };
}

export default { writeResults, weekLabel };
```

### run.js
```js
// run.js — full weekly run: pull all client channels, compute, write to Sheets.
//   node run.js        -> compute + write to Google Sheets
//   node run.js --dry  -> compute + print only, no Sheets write
import 'dotenv/config';
import config from './config.js';
import { collect } from './lib/collect.js';
import { aggregate } from './lib/metrics.js';
import { writeResults, weekLabel } from './lib/sheets.js';
import { formatMinutes } from './lib/business-hours.js';

const DRY = process.argv.includes('--dry');
const { tickets, channelsById, users, window } = await collect({ log: (m) => console.error(m) }, config);
const results = aggregate(tickets, config, channelsById);
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
for (const t of results.byTeam) console.log(`  ${t.team.padEnd(12)} ${String(t.slaHitRate ?? 'n/a').padStart(5)}%  med ${formatMinutes(t.medianMinutes)}  (${t.answered}/${t.clientMessages})`);
console.log(`\n--- Worst channels ---`);
for (const c of results.byChannel.slice(0, 10)) console.log(`  ${(c.channelName || c.channelId).padEnd(24)} ${String(c.slaHitRate ?? 'n/a').padStart(5)}%  med ${formatMinutes(c.medianMinutes)}  (${c.answered}/${c.clientMessages})`);

if (DRY) console.log('\n[--dry] Skipped Google Sheets write.');
else if (!process.env.RESULTS_SPREADSHEET_ID) console.log('\nNo RESULTS_SPREADSHEET_ID set — skipped Sheets write.');
else {
  const out = await writeResults(results, config, process.env, window);
  console.log(`\nWrote summary row to "${out.summaryTab}" and detail to "${out.detailTab}".`);
}
```

### pilot.js
```js
// pilot.js — validate on a small set of channels BEFORE scaling. Never writes
// to Sheets. Prints the client-detection audit + sample tickets.
//   node pilot.js                         -> first 10 channels the bot is in
//   PILOT_CHANNELS="a,b,c" node pilot.js  -> only these channel names/ids
import 'dotenv/config';
import config from './config.js';
import { collect } from './lib/collect.js';
import { aggregate } from './lib/metrics.js';
import { formatMinutes } from './lib/business-hours.js';

const want = (process.env.PILOT_CHANNELS || '').split(',').map((s) => s.trim()).filter(Boolean);
const LIMIT = parseInt(process.env.PILOT_LIMIT || '10', 10);
const channelFilter = (channels) => {
  if (want.length) return channels.filter((c) => want.includes(c.name) || want.includes(c.id));
  return channels.slice(0, LIMIT);
};
const { tickets, channelsById, users, summary } = await collect({ channelFilter, log: (m) => console.error(m) }, config);

console.log(`\n=== PILOT — channel detection audit ===`);
console.log(`(window: last ${config.lookbackDays} days, tz ${config.timezone}, SLA ${config.slaBusinessMinutes}m)\n`);
console.log('  CLIENT?  msgs  clientMsgs  channel');
for (const s of summary) console.log(`  ${(s.isClient ? 'YES' : 'no ').padEnd(7)} ${String(s.msgs).padStart(4)}  ${String(s.clientMsgs).padStart(9)}   #${s.name}`);
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
```

### .github/workflows/daily.yml
```yaml
name: Client Response Time Tracker (daily)

on:
  schedule:
    - cron: '0 5 * * *'   # 05:00 UTC = 00:00 America/Bogota
  workflow_dispatch:

jobs:
  run:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout code
        uses: actions/checkout@v4
      - name: Set up Node
        uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Install dependencies
        run: npm ci
      - name: Write Google service-account key
        run: printf '%s' "$GOOGLE_CREDENTIALS_JSON" > credentials.json
        env:
          GOOGLE_CREDENTIALS_JSON: ${{ secrets.GOOGLE_CREDENTIALS_JSON }}
      - name: Run tracker
        run: node run.js
        env:
          SLACK_BOT_TOKEN: ${{ secrets.SLACK_BOT_TOKEN }}
          RESULTS_SPREADSHEET_ID: ${{ secrets.RESULTS_SPREADSHEET_ID }}
          RESULTS_TAB: 'Response Time'
```

### package.json
```json
{
  "name": "client-response-time-tracker",
  "version": "1.0.0",
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "pilot": "node pilot.js",
    "run": "node run.js",
    "test": "node --test tests/*.test.js"
  },
  "dependencies": {
    "dotenv": "^16.4.5",
    "googleapis": "^140.0.1"
  }
}
```

### .env.example
```
SLACK_BOT_TOKEN=xoxb-your-token-here
RESULTS_SPREADSHEET_ID=your-spreadsheet-id-here
RESULTS_TAB=Response Time
# credentials.json (Google service-account key) lives next to this file.
```

### .gitignore
```
node_modules/
.env
credentials.json
*.local.json
.cache/
```

### tests/logic.test.js
```js
// 11 unit tests for the pure logic. Run: npm test  (node --test tests/*.test.js)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessMinutesBetween, formatMinutes } from '../lib/business-hours.js';
import { classifyUser } from '../lib/classify.js';
import { computeChannelTickets, aggregate, isAcknowledgement } from '../lib/metrics.js';

const config = {
  timezone: 'America/Bogota', workingDays: [1,2,3,4,5], workStartHour: 9, workEndHour: 18,
  holidays: [], slaBusinessMinutes: 60, noActionEmoji: 'no_action', countEmojiAsResponse: false,
  ignoreUnansweredShorterThan: 0, channelTeamMap: {},
};
const bog = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h + 5, mi) / 1000; // Bogota local -> unix

test('same-day elapsed', () => { assert.equal(businessMinutesBetween(bog(2026,6,15,9,0), bog(2026,6,15,9,30), config), 30); });
test('overnight pauses outside hours', () => { assert.equal(businessMinutesBetween(bog(2026,6,15,17,30), bog(2026,6,16,9,30), config), 60); });
test('weekend does not count', () => { assert.equal(businessMinutesBetween(bog(2026,6,19,17,0), bog(2026,6,22,10,0), config), 120); });
test('before-hours message starts clock at open', () => { assert.equal(businessMinutesBetween(bog(2026,6,15,7,0), bog(2026,6,15,9,20), config), 20); });
test('holiday excluded', () => { const c = {...config, holidays:['2026-06-15']}; assert.equal(businessMinutesBetween(bog(2026,6,15,9,0), bog(2026,6,16,9,45), c), 45); });
test('formatMinutes', () => { assert.equal(formatMinutes(20),'20m'); assert.equal(formatMinutes(73),'1h 13m'); assert.equal(formatMinutes(120),'2h'); });

test('classify guest/member/bot/connect/override', () => {
  const users = new Map([
    ['Uguest',{id:'Uguest',isBot:false,isRestricted:false,isUltraRestricted:true,teamId:'T1'}],
    ['Umember',{id:'Umember',isBot:false,isRestricted:false,isUltraRestricted:false,teamId:'T1'}],
    ['Ubot',{id:'Ubot',isBot:true}],
    ['Uforeign',{id:'Uforeign',isBot:false,teamId:'T2'}],
    ['Uover',{id:'Uover',isBot:false,isRestricted:true,teamId:'T1'}],
  ]);
  const c = {...config, clientOverrides:[], teamOverrides:['Uover']};
  assert.equal(classifyUser('Uguest',users,'T1',c),'client');
  assert.equal(classifyUser('Umember',users,'T1',c),'team');
  assert.equal(classifyUser('Ubot',users,'T1',c),'bot');
  assert.equal(classifyUser('Uforeign',users,'T1',c),'client');
  assert.equal(classifyUser('Uover',users,'T1',c),'team');
});

const mk = (ts, role, opts = {}) => ({ ts, user: opts.user || (role==='client'?'Uc':'Ut'), text: opts.text || 'x', role, thread_ts: opts.thread_ts, reactions: opts.reactions || [] });

test('ticket pairing, collapse, threads, exclusions', () => {
  const c = {...config, clientOverrides:[], teamOverrides:[]};
  const alpha = computeChannelTickets({id:'C1',name:'alpha'}, [
    mk(bog(2026,6,15,9,0),'client',{text:'hi'}), mk(bog(2026,6,15,9,20),'team'),
    mk(bog(2026,6,15,11,0),'client',{text:'double1'}), mk(bog(2026,6,15,11,5),'client',{text:'double2'}), mk(bog(2026,6,15,11,40),'team'),
  ], c);
  assert.equal(alpha.length, 2);
  assert.equal(alpha[0].businessMinutes, 20);
  assert.equal(alpha[1].businessMinutes, 40);
  assert.equal(alpha[1].followUps, 1);
  const bravo = computeChannelTickets({id:'C2',name:'bravo'}, [
    mk(bog(2026,6,15,13,0),'client',{thread_ts:String(bog(2026,6,15,13,0)),text:'q'}),
    mk(bog(2026,6,15,13,10),'team',{thread_ts:String(bog(2026,6,15,13,0))}),
    mk(bog(2026,6,15,16,0),'client',{text:'no reply'}),
  ], c);
  assert.equal(bravo.find(t=>t.status==='answered').businessMinutes, 10);
  assert.ok(bravo.find(t=>t.status==='unanswered'));
  const charlie = computeChannelTickets({id:'C3',name:'charlie'}, [ mk(bog(2026,6,15,15,0),'client',{reactions:[{name:'no_action',count:1}]}) ], c);
  assert.equal(charlie[0].status, 'no_action');
  const agg = aggregate([...alpha,...bravo,...charlie], c, new Map([['C1',{id:'C1',name:'alpha'}],['C2',{id:'C2',name:'bravo'}],['C3',{id:'C3',name:'charlie'}]]));
  assert.equal(agg.overall.clientMessages, 4);
  assert.equal(agg.overall.answered, 3);
  assert.equal(agg.overall.unanswered, 1);
  assert.equal(agg.overall.excluded, 1);
  assert.equal(agg.overall.slaHitRate, 75);
  assert.equal(agg.overall.medianMinutes, 20);
  assert.equal(agg.overall.p90Minutes, 40);
});

test('acknowledgement detector', () => {
  for (const s of ['thanks','Thanks!','thank you','ok thanks so much','got it','perfect 👍','🙏','all good thanks','noted, thank you'])
    assert.equal(isAcknowledgement(s), true);
  for (const s of ['take it down','why hasnt this posted','can we swap these two','take this video down please','is this live yet'])
    assert.equal(isAcknowledgement(s), false);
});

test('unanswered closer excluded, real request counts', () => {
  const c = {...config, excludeAcknowledgements:true};
  const t = computeChannelTickets({id:'C8',name:'ack'}, [
    mk(bog(2026,6,15,9,0),'client',{text:'take this down'}),
    mk(bog(2026,6,15,9,1),'team'),
    mk(bog(2026,6,15,9,2),'client',{text:'Thanks!'}),
  ], c);
  assert.equal(t.find(x=>x.text==='Thanks!').status, 'fyi_ignored');
});

test('emoji reaction never counts as a response by default', () => {
  const t = computeChannelTickets({id:'C9',name:'z'}, [ mk(bog(2026,6,15,9,0),'client',{reactions:[{name:'eyes',count:1}]}) ], config);
  assert.equal(t[0].status, 'unanswered');
});
```

---

## 5. CONFIG & SECRETS

**Tunables** — all in `config.js` (see file above): timezone, working days/hours, holidays, `slaBusinessMinutes` (10), client/team overrides, channel scoping, acknowledgement filter, no-action emoji, lookback days, week-label style, channel→team map.

**Secrets / env vars** (never committed; `.gitignore` blocks them):
- `SLACK_BOT_TOKEN` — bot token `xoxb-…` from the custom Slack app.
- `RESULTS_SPREADSHEET_ID` — the scorecard sheet ID or full URL (code extracts the ID).
- `RESULTS_TAB` — defaults to "Response Time".
- `credentials.json` — Google service-account JSON key, placed next to the project. Service account email: `dashboard-reader@fit-freehold-493721-g6.iam.gserviceaccount.com` (reused from the Performance Dashboard). The target sheet must share Editor access with this email. In GitHub Actions, the JSON is stored as secret `GOOGLE_CREDENTIALS_JSON` and written to `credentials.json` at runtime.

**Required Slack bot scopes:** `channels:history`, `groups:history`, `channels:read`, `groups:read`, `users:read`, `reactions:read` (and `users:read.email` only if using email-based overrides). The bot must be a **member of each channel** to read it (public it can self-join; private must be invited).

**Google scope used by the code:** `https://www.googleapis.com/auth/spreadsheets`.

---

## 6. HOW IT RUNS
- **Local manual:** `npm install` then `node pilot.js` (audit, no writes) or `node run.js` (writes to Sheets; `--dry` to skip the write). `npm test` runs the 11 unit tests.
- **Production (live):** GitHub Actions, repo **github.com/AndresCardonaNomad/Tracker** (private). Workflow `.github/workflows/daily.yml` runs nightly at `cron: '0 5 * * *'` (UTC) = midnight America/Bogota, plus manual `workflow_dispatch`. Steps: checkout → setup Node 20 → `npm ci` → write `credentials.json` from secret → `node run.js`. No dependency on any personal computer. (Note: GitHub pauses scheduled workflows after 60 days of no commits; any push or manual run resets it.)
- An earlier Windows Task Scheduler path (`run-daily.bat`) was set up but superseded by GitHub Actions and can be removed.

---

## 7. OUTPUT
Writes to the Google Sheet identified by `RESULTS_SPREADSHEET_ID` — currently the **"Writer Director Scorecard"** workbook (id `17FBwgqZ8Fn1bt5Ho7ylfvLt2lW-C68RDeHe8IUYQv7g`). Two tabs (auto-created if missing):
- **"Response Time"** — one upserted row per ISO week: `Week | SLA Hit % | Median | p90 | Client Msgs | Answered | Unanswered | Channels | Updated`. Re-running the same week overwrites that row (idempotent).
- **"Response Time Detail"** — overwritten each run: stacked tables BY TEAM, BY WRITER (who responded; user IDs), BY CHANNEL (worst first).

The scorecard's own "Client Response Time" KPI cell is wired to the latest week with:
`=IFERROR(INDEX('Response Time'!B:B, COUNTA('Response Time'!A:A)) & "%", "—")`
and a status cell with tunable thresholds (suggested 80% ON TRACK / 65% WATCH).

Also writes nothing to Slack (read-only there).

---

## 8. CURRENT STATUS
- **Live and verified.** Code complete; 11/11 unit tests pass.
- Pilot ran against 8 client channels: all 8 auto-detected as client (zero overrides). Latest result (week 2026-W25, SLA 10 business min): **69.6% hit rate, median 1m, p90 57m, 23 client msgs (22 answered, 1 unanswered, 2 excluded as acknowledgements)**.
- GitHub Actions test run succeeded end-to-end and wrote both tabs to the scorecard.
- **Pending:** invite the bot to the remaining client channels (only 8 of ~100+ so far) so the nightly number covers everyone. Optional: confirm the SLA bar (10 min is strict; median is 1m but p90 57m). Optional: verify two guest names (Jimmy Douglas, Spencer Reich) are real clients vs staff.

---

## 9. KEY DECISIONS
- **Build vs buy:** custom build chosen (full control, no per-seat fees, exact scorecard fit, data stays in-house).
- **Batch (history-pull) for v1 instead of realtime Events API:** no always-on server, backfills history immediately so trend exists from day one, and reuses one metric engine. Realtime Socket Mode is a planned v2 (would enable live end-of-day alerts and remove the thread-before-window edge case).
- **Client detection via Slack guest/Connect flags** rather than a maintained client list — because clients are provisioned as guests by single-channel email invite. Overrides handle the rare exceptions.
- **SLA hit rate as the headline (not mean):** bounded 0–100%, intuitive, resistant to outliers and to gaming; median + p90 expose the tail. Mean was rejected (one ignored message wrecks it; easily gamed).
- **Business-hours clock** so nights/weekends don't unfairly penalize response time.
- **Acknowledgement filter + double-text collapse + emoji-never-counts** to keep the metric fair and hard to game.
- **Hosting on GitHub Actions** (not the user's PC, not a paid VM) — free, always-on, secrets handled securely, fits the user's existing git usage; also keeps the run off the OneDrive-synced files (which had a files-on-demand truncation quirk locally).
- **Separate repo** (`AndresCardonaNomad/Tracker`) rather than nesting inside the already-git-tracked Obsidian vault.

---

## 10. OVERLAP with a "reply rate" / Slack reply-speed project
This tool IS the Slack client-response-speed system. If a separate "reply rate" build exists, likely overlaps:
- **Same data pull** (Slack `conversations.history` + `users.list`), **same client-vs-team detection** (guest/Connect flags), and **same business-hours engine** could be shared.
- **Likely-different metric:** "reply rate" probably means **% of client messages that got any reply** (coverage), whereas this measures **speed within an SLA** (hit rate) plus median/p90. These are complementary: % answered (coverage) + % answered fast (speed).
- **Clean merge options:** (a) add "reply rate / % answered" as an extra column in this tool's existing `aggregate()` and Sheets output (it already computes `answered` / `unanswered` per scope, so % answered is a one-line addition) and let the same nightly GitHub Actions run produce both numbers; or (b) keep them separate but both feed the same scorecard. Recommended: fold "reply rate" into this tool as a second metric — it's nearly free given the ticket data already exists (`answered / (answered+unanswered)`).
- Watch for **definition conflicts:** what counts as a "reply", business-hours vs raw time, and which messages are excluded (acks/no-action) must be reconciled so both numbers are consistent.
```
