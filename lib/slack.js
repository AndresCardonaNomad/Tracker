// lib/slack.js — thin Slack Web API client built on global fetch (Node 18+).
// Handles pagination and 429 rate-limit backoff. Read-only.

const SLACK_API = 'https://slack.com/api';

function token() {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error('SLACK_BOT_TOKEN is not set (see .env.example)');
  return t;
}

// Core caller: handles Slack's ok/error envelope + 429 Retry-After backoff.
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
      // ratelimited can also arrive in-body on some tiers
      if (json.error === 'ratelimited') { await sleep(2000); continue; }
      throw new Error(`Slack ${method} failed: ${json.error}`);
    }

    if (!paginate) return json;
    if (collect) out.push(...(collect(json) || []));
    cursor = json.response_metadata?.next_cursor;
    if (!cursor) break;
    await sleep(150); // gentle pacing between pages
  }
  return out;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// -- Workspace identity (our own team_id, to detect Slack Connect guests) -----
export async function getOwnTeamId() {
  const json = await call('auth.test');
  return json.team_id;
}

// -- Users: id -> { id, name, isBot, isRestricted, isUltraRestricted, teamId, email }
export async function fetchUsers() {
  const members = await call('users.list', { limit: '200' }, {
    paginate: true,
    collect: (j) => j.members,
  });
  const map = new Map();
  for (const m of members) {
    map.set(m.id, {
      id: m.id,
      name: m.profile?.display_name || m.real_name || m.name || m.id,
      email: m.profile?.email || null,
      isBot: !!m.is_bot || m.id === 'USLACKBOT',
      isRestricted: !!m.is_restricted,            // multi-channel guest
      isUltraRestricted: !!m.is_ultra_restricted, // single-channel guest
      teamId: m.team_id || null,
      deleted: !!m.deleted,
    });
  }
  return map;
}

// -- Channels the bot is a member of (public + private). -----------------------
export async function fetchChannels() {
  const chans = await call('users.conversations', {
    types: 'public_channel,private_channel',
    exclude_archived: 'true',
    limit: '200',
  }, { paginate: true, collect: (j) => j.channels });
  return chans.map((c) => ({ id: c.id, name: c.name, isPrivate: !!c.is_private }));
}

// -- Full message history for a channel within [oldest, latest] (unix secs). ---
// Returns top-level messages. Thread replies fetched separately per parent.
export async function fetchHistory(channelId, oldest, latest) {
  return call('conversations.history', {
    channel: channelId,
    oldest: String(oldest),
    latest: String(latest),
    inclusive: 'true',
    limit: '200',
  }, { paginate: true, collect: (j) => j.messages });
}

// -- Replies for a single thread (parent ts). Includes the parent as [0]. -----
export async function fetchReplies(channelId, threadTs, oldest, latest) {
  return call('conversations.replies', {
    channel: channelId,
    ts: threadTs,
    oldest: String(oldest),
    latest: String(latest),
    inclusive: 'true',
    limit: '200',
  }, { paginate: true, collect: (j) => j.messages });
}

export default { getOwnTeamId, fetchUsers, fetchChannels, fetchHistory, fetchReplies };
