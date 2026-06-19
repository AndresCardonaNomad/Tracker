// lib/metrics.js — turn role-tagged messages into "tickets" and aggregate them.
//
// A ticket = a client message that needs a response. It is opened by the first
// unanswered client message in a conversation and closed by the first team
// human reply. Consecutive client messages with no team reply in between
// collapse into ONE ticket opened at the EARLIEST message (fair to the client).
//
// Conversations: a thread is one conversation; all non-threaded main-channel
// messages share the 'main' conversation. This keeps thread replies from being
// matched to unrelated main-channel messages.

import { businessMinutesBetween } from './business-hours.js';

const convKey = (m) => (m.thread_ts ? `t:${m.thread_ts}` : 'main');

// Input messages are already normalized:
//   { ts:Number(sec), user:String, text:String, thread_ts:String|undefined,
//     role:'client'|'team'|'bot'|'unknown', reactions:[{name,count}] }
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
            channelId: channel.id,
            channelName: channel.name,
            openedTs: m.ts,
            clientUser: m.user,
            text: m.text || '',
            reactions: m.reactions || [],
            followUps: 0,
          };
        } else {
          open.followUps += 1; // client double-texted before a reply
        }
      } else if (m.role === 'team') {
        if (open) {
          open.responseTs = m.ts;
          open.responder = m.user;
          tickets.push(finalize(open, config));
          open = null;
        }
        // team message with no pending client ticket: ignored
      }
      // bot / unknown: ignored
    }
    if (open) tickets.push(finalize(open, config)); // unanswered at window close
  }
  return tickets;
}

function hasReaction(reactions, name) {
  return (reactions || []).some((r) => r.name === name);
}

// Pure-acknowledgement / closer detector. Used only to exclude UNANSWERED
// client messages that don't need a reply ("thanks", "got it", "perfect 👍").
// A message counts as an ack only if EVERY word is an ack word — so a real
// request like "take it down" is never excluded.
const ACK_TOKENS = new Set([
  'thanks', 'thank', 'thankyou', 'thx', 'ty', 'tysm', 'tq',
  'you', 'u', 'so', 'much', 'a', 'lot', 'really', 'very',
  'ok', 'okay', 'okey', 'k', 'kk', 'oki',
  'got', 'it', 'gotcha', 'noted', 'understood', 'received',
  'perfect', 'great', 'awesome', 'amazing', 'excellent', 'nice', 'cool', 'sweet',
  'appreciate', 'appreciated', 'appreciate it',
  'sounds', 'good', 'sound', 'looks',
  'no', 'worries', 'np', 'problem', 'prob',
  'yes', 'yep', 'yup', 'yeah', 'ya', 'sure', 'sounds good',
  'done', 'love', 'this', 'that', 'them', 'all', 'set',
  'cheers', 'yw', 'welcome', 'and', 'the',
]);

function normalizeAck(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/<@[^>]+>/g, ' ')          // strip @mentions
    .replace(/<[^>]+>/g, ' ')           // strip links/refs
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}️]/gu, ' ') // strip emoji
    .replace(/[^a-z\s]/g, ' ')          // strip punctuation/digits
    .replace(/\s+/g, ' ')
    .trim();
}

export function isAcknowledgement(text) {
  const t = normalizeAck(text);
  if (!t) return true;                  // emoji-only / punctuation-only
  const tokens = t.split(' ').filter(Boolean);
  if (tokens.length === 0) return true;
  if (tokens.length > 6) return false;  // too long to be a pure closer
  return tokens.every((tok) => ACK_TOKENS.has(tok));
}

function finalize(t, config) {
  // Excluded: explicitly marked no-action.
  if (hasReaction(t.reactions, config.noActionEmoji)) {
    return { ...t, status: 'no_action' };
  }

  if (t.responseTs != null) {
    const businessMinutes = businessMinutesBetween(t.openedTs, t.responseTs, config);
    return {
      ...t,
      status: 'answered',
      businessMinutes,
      withinSla: businessMinutes <= config.slaBusinessMinutes,
    };
  }

  // Unanswered. Treat pure acknowledgements / closers as no-action noise
  // ("thanks", "got it", "perfect 👍") so they don't count as misses.
  if (config.excludeAcknowledgements && isAcknowledgement(t.text)) {
    return { ...t, status: 'fyi_ignored' };
  }

  // Optionally also drop very short unanswered messages by raw length.
  if (
    config.ignoreUnansweredShorterThan > 0 &&
    t.text.trim().length < config.ignoreUnansweredShorterThan
  ) {
    return { ...t, status: 'fyi_ignored' };
  }

  // Optionally let an emoji ack count as "handled" (excluded from timing).
  if (config.countEmojiAsResponse && (t.reactions || []).length > 0) {
    return { ...t, status: 'ack_only' };
  }

  return { ...t, status: 'unanswered' };
}

// ---- aggregation ----------------------------------------------------------

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

// tickets: flat array across all channels. channelsById: Map id->{id,name}.
export function aggregate(tickets, config, channelsById = new Map()) {
  // SLA denominator excludes no_action / fyi_ignored / ack_only.
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

  // Per responder ("who DID respond").
  const byResponder = groupStats(answered, (t) => t.responder, config);

  // Per channel.
  const byChannelMap = new Map();
  for (const t of counted) {
    const key = t.channelId;
    if (!byChannelMap.has(key)) {
      byChannelMap.set(key, { channelId: t.channelId, channelName: t.channelName, list: [] });
    }
    byChannelMap.get(key).list.push(t);
  }
  const byChannel = [...byChannelMap.values()].map((c) => ({
    channelId: c.channelId,
    channelName: c.channelName,
    team: assignedTeam({ id: c.channelId, name: c.channelName }, config),
    ...statsFor(c.list, config),
  })).sort((a, b) => (a.slaHitRate ?? 0) - (b.slaHitRate ?? 0)); // worst first

  // Per assigned team ("who SHOULD have answered").
  const byTeamMap = new Map();
  for (const c of byChannel) {
    if (!byTeamMap.has(c.team)) byTeamMap.set(c.team, []);
    const orig = byChannelMap.get(c.channelId).list;
    byTeamMap.get(c.team).push(...orig);
  }
  const byTeam = [...byTeamMap.entries()].map(([team, list]) => ({
    team, ...statsFor(list, config),
  })).sort((a, b) => (a.slaHitRate ?? 0) - (b.slaHitRate ?? 0));

  return { overall, byResponder, byChannel, byTeam };
}

function statsFor(list, config) {
  const counted = list.filter((t) => t.status === 'answered' || t.status === 'unanswered');
  const answered = counted.filter((t) => t.status === 'answered');
  const times = answered.map((t) => t.businessMinutes);
  const within = answered.filter((t) => t.withinSla).length;
  return {
    clientMessages: counted.length,
    answered: answered.length,
    unanswered: counted.length - answered.length,
    slaHitRate: counted.length ? round1((within / counted.length) * 100) : null,
    medianMinutes: median(times),
    p90Minutes: percentile(times, 90),
  };
}

function groupStats(answeredTickets, keyFn, config) {
  const m = new Map();
  for (const t of answeredTickets) {
    const k = keyFn(t);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(t);
  }
  return [...m.entries()].map(([key, list]) => ({
    key,
    responses: list.length,
    medianMinutes: median(list.map((t) => t.businessMinutes)),
    withinSla: list.filter((t) => t.withinSla).length,
    slaHitRate: round1((list.filter((t) => t.withinSla).length / list.length) * 100),
  })).sort((a, b) => b.responses - a.responses);
}

const round1 = (n) => Math.round(n * 10) / 10;

export default { computeChannelTickets, aggregate };
