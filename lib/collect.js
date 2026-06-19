// lib/collect.js — pull Slack data, tag roles, and produce tickets.
// Shared by run.js (full) and pilot.js (subset, verbose). Read-only on Slack.

import slack from './slack.js';
import { classifyUser, isClientChannel } from './classify.js';
import { computeChannelTickets } from './metrics.js';

// Slack subtypes that are not real conversational messages.
const SKIP_SUBTYPES = new Set([
  'channel_join', 'channel_leave', 'channel_topic', 'channel_purpose',
  'channel_name', 'channel_archive', 'channel_unarchive', 'message_changed',
  'message_deleted', 'pinned_item', 'bot_add', 'bot_remove', 'reminder_add',
]);

function normalize(msg, users, ownTeamId, config) {
  if (msg.subtype && SKIP_SUBTYPES.has(msg.subtype)) return null;
  const role = msg.user
    ? classifyUser(msg.user, users, ownTeamId, config)
    : 'bot'; // bot_message / app posts have no user
  return {
    ts: parseFloat(msg.ts),
    user: msg.user || null,
    text: msg.text || '',
    thread_ts: msg.thread_ts || undefined,
    role,
    reactions: (msg.reactions || []).map((r) => ({ name: r.name, count: r.count })),
  };
}

export async function collect({ channelFilter = null, log = () => {}, window = null } = {}, config) {
  const [ownTeamId, users] = await Promise.all([slack.getOwnTeamId(), slack.fetchUsers()]);
  log(`Roster: ${users.size} users. Own team: ${ownTeamId}`);

  let channels = await slack.fetchChannels();
  if (channelFilter) channels = channelFilter(channels);
  log(`Bot is in ${channels.length} channel(s) to scan.`);

  // Use an explicit window if given (backfill), else the rolling lookback.
  const latest = window ? window.latest : Math.floor(Date.now() / 1000);
  const oldest = window ? window.oldest : latest - config.lookbackDays * 86400;

  const allTickets = [];
  const channelsById = new Map();
  const summary = [];

  for (const ch of channels) {
    let raw;
    try {
      raw = await slack.fetchHistory(ch.id, oldest, latest);
    } catch (e) {
      log(`  ! skip #${ch.name}: ${e.message}`);
      continue;
    }

    // Pull thread replies for any root message that has them.
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
