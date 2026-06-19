// lib/classify.js — decide who is a CLIENT vs TEAM, and which channels count.
// Pure functions. No network. Takes the user map (from slack.js) + config.

// Returns 'client' | 'team' | 'bot' | 'unknown' for a given user id.
export function classifyUser(userId, users, ownTeamId, config) {
  const u = users.get(userId);
  if (!u) return 'unknown';            // user left workspace / not in roster
  if (u.isBot) return 'bot';

  // Excluded users (e.g. videographers): ignored entirely — never open a ticket,
  // never count as a response. Reacting is enough; no reply expected.
  if (inList(u, config.excludeUsers)) return 'ignore';

  // Overrides win over everything.
  if (inList(u, config.teamOverrides)) return 'team';
  if (inList(u, config.clientOverrides)) return 'client';

  // Auto signals -> external = client.
  const isGuest = u.isRestricted || u.isUltraRestricted;
  const isForeignOrg = ownTeamId && u.teamId && u.teamId !== ownTeamId;
  if (isGuest || isForeignOrg) return 'client';

  // Full member of our workspace.
  return 'team';
}

function inList(user, list) {
  if (!list || list.length === 0) return false;
  const norm = (s) => String(s || '').trim().toLowerCase();
  const cands = [user.id, user.email, user.name, user.realName].map(norm).filter(Boolean);
  return list.some((entry) => cands.includes(norm(entry)));
}

// Build a quick id->role lookup for a whole channel's participant set.
export function roleMap(userIds, users, ownTeamId, config) {
  const m = new Map();
  for (const id of userIds) m.set(id, classifyUser(id, users, ownTeamId, config));
  return m;
}

// Does this channel count as a CLIENT channel we should measure?
// channelMessages: array of raw Slack messages (used only for 'auto' mode).
export function isClientChannel(channel, channelMessages, users, ownTeamId, config) {
  const denied = config.channelDenylist.some(
    (e) => e === channel.id || e === channel.name
  );
  if (denied) return false;

  switch (config.channelScope) {
    case 'prefix':
      return (channel.name || '').startsWith(config.channelPrefix);
    case 'allowlist':
      return config.channelAllowlist.some((e) => e === channel.id || e === channel.name);
    case 'auto':
    default: {
      // A client channel is one where at least one human author is external.
      for (const msg of channelMessages) {
        if (!msg.user) continue;
        if (classifyUser(msg.user, users, ownTeamId, config) === 'client') return true;
      }
      return false;
    }
  }
}

export default { classifyUser, roleMap, isClientChannel };
