// Unit tests for the pure logic: business hours, classifier, metrics.
// Run: npm test   (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { businessMinutesBetween, formatMinutes } from '../lib/business-hours.js';
import { classifyUser } from '../lib/classify.js';
import { computeChannelTickets, aggregate, isAcknowledgement } from '../lib/metrics.js';

const config = {
  timezone: 'America/Bogota',      // UTC-5, no DST
  workingDays: [1, 2, 3, 4, 5],
  workStartHour: 9,
  workEndHour: 18,
  holidays: [],
  slaBusinessMinutes: 60,
  noActionEmoji: 'no_action',
  countEmojiAsResponse: false,
  ignoreUnansweredShorterThan: 0,
  channelTeamMap: {},
};

// Bogota local wall-clock -> unix seconds (UTC = local + 5h).
const bog = (y, mo, d, h, mi = 0) => Date.UTC(y, mo - 1, d, h + 5, mi) / 1000;

// ---- business hours -------------------------------------------------------
test('same-day elapsed', () => {
  assert.equal(businessMinutesBetween(bog(2026, 6, 15, 9, 0), bog(2026, 6, 15, 9, 30), config), 30);
});

test('overnight pauses outside hours', () => {
  // Mon 17:30 -> Tue 09:30  = 30 (Mon) + 30 (Tue) = 60
  assert.equal(businessMinutesBetween(bog(2026, 6, 15, 17, 30), bog(2026, 6, 16, 9, 30), config), 60);
});

test('weekend does not count', () => {
  // Fri 17:00 -> Mon 10:00 = 60 (Fri) + 0 (weekend) + 60 (Mon) = 120
  assert.equal(businessMinutesBetween(bog(2026, 6, 19, 17, 0), bog(2026, 6, 22, 10, 0), config), 120);
});

test('before-hours message starts clock at open', () => {
  // Mon 07:00 -> Mon 09:20 = clock starts 09:00 => 20
  assert.equal(businessMinutesBetween(bog(2026, 6, 15, 7, 0), bog(2026, 6, 15, 9, 20), config), 20);
});

test('holiday excluded', () => {
  const c = { ...config, holidays: ['2026-06-15'] };
  // Mon is a holiday; Tue 09:00->09:45 = 45
  assert.equal(businessMinutesBetween(bog(2026, 6, 15, 9, 0), bog(2026, 6, 16, 9, 45), c), 45);
});

test('formatMinutes', () => {
  assert.equal(formatMinutes(20), '20m');
  assert.equal(formatMinutes(73), '1h 13m');
  assert.equal(formatMinutes(120), '2h');
});

// ---- classifier -----------------------------------------------------------
test('classify guest vs member vs bot vs override', () => {
  const users = new Map([
    ['Uguest', { id: 'Uguest', isBot: false, isRestricted: false, isUltraRestricted: true, teamId: 'T1' }],
    ['Umember', { id: 'Umember', isBot: false, isRestricted: false, isUltraRestricted: false, teamId: 'T1' }],
    ['Ubot', { id: 'Ubot', isBot: true }],
    ['Uforeign', { id: 'Uforeign', isBot: false, teamId: 'T2' }],
    ['Uover', { id: 'Uover', isBot: false, isRestricted: true, teamId: 'T1' }],
  ]);
  const c = { ...config, clientOverrides: [], teamOverrides: ['Uover'] };
  assert.equal(classifyUser('Uguest', users, 'T1', c), 'client');
  assert.equal(classifyUser('Umember', users, 'T1', c), 'team');
  assert.equal(classifyUser('Ubot', users, 'T1', c), 'bot');
  assert.equal(classifyUser('Uforeign', users, 'T1', c), 'client'); // Slack Connect
  assert.equal(classifyUser('Uover', users, 'T1', c), 'team');      // override wins over guest flag
});

// ---- metrics --------------------------------------------------------------
const mk = (ts, role, opts = {}) => ({ ts, user: opts.user || (role === 'client' ? 'Uc' : 'Ut'), text: opts.text || 'x', role, thread_ts: opts.thread_ts, reactions: opts.reactions || [] });

test('ticket pairing, collapse, threads, exclusions', () => {
  const c = { ...config, clientOverrides: [], teamOverrides: [] };

  // alpha: answered 20m, then double-text answered 40m
  const alpha = computeChannelTickets({ id: 'C1', name: 'alpha' }, [
    mk(bog(2026, 6, 15, 9, 0), 'client', { text: 'hi' }),
    mk(bog(2026, 6, 15, 9, 20), 'team'),
    mk(bog(2026, 6, 15, 11, 0), 'client', { text: 'double1' }),
    mk(bog(2026, 6, 15, 11, 5), 'client', { text: 'double2' }),
    mk(bog(2026, 6, 15, 11, 40), 'team'),
  ], c);
  assert.equal(alpha.length, 2);
  assert.equal(alpha[0].businessMinutes, 20);
  assert.equal(alpha[1].businessMinutes, 40);
  assert.equal(alpha[1].followUps, 1); // collapsed double-text

  // bravo: thread answered 10m + standalone unanswered
  const bravo = computeChannelTickets({ id: 'C2', name: 'bravo' }, [
    mk(bog(2026, 6, 15, 13, 0), 'client', { thread_ts: String(bog(2026, 6, 15, 13, 0)), text: 'q' }),
    mk(bog(2026, 6, 15, 13, 10), 'team', { thread_ts: String(bog(2026, 6, 15, 13, 0)) }),
    mk(bog(2026, 6, 15, 16, 0), 'client', { text: 'no reply' }),
  ], c);
  const answeredBravo = bravo.find((t) => t.status === 'answered');
  const unansBravo = bravo.find((t) => t.status === 'unanswered');
  assert.equal(answeredBravo.businessMinutes, 10);
  assert.ok(unansBravo);

  // charlie: no-action emoji excluded
  const charlie = computeChannelTickets({ id: 'C3', name: 'charlie' }, [
    mk(bog(2026, 6, 15, 15, 0), 'client', { reactions: [{ name: 'no_action', count: 1 }] }),
  ], c);
  assert.equal(charlie[0].status, 'no_action');

  // aggregate
  const all = [...alpha, ...bravo, ...charlie];
  const agg = aggregate(all, c, new Map([['C1', { id: 'C1', name: 'alpha' }], ['C2', { id: 'C2', name: 'bravo' }], ['C3', { id: 'C3', name: 'charlie' }]]));
  assert.equal(agg.overall.clientMessages, 4); // 3 answered + 1 unanswered
  assert.equal(agg.overall.answered, 3);
  assert.equal(agg.overall.unanswered, 1);
  assert.equal(agg.overall.excluded, 1);       // no_action
  assert.equal(agg.overall.slaHitRate, 75);    // 3 of 4 within 60m
  assert.equal(agg.overall.medianMinutes, 20); // [10,20,40]
  assert.equal(agg.overall.p90Minutes, 40);
});

test('acknowledgement detector: closers excluded, real requests kept', () => {
  // pure closers -> ack
  for (const s of ['thanks', 'Thanks!', 'thank you', 'ok thanks so much', 'got it', 'perfect 👍', '🙏', 'Thanks!!!', 'all good thanks', 'noted, thank you']) {
    assert.equal(isAcknowledgement(s), true, `should be ack: "${s}"`);
  }
  // real requests -> NOT ack
  for (const s of ['take it down', 'why hasnt this posted', 'can we swap these two', 'take this video down please', 'is this live yet']) {
    assert.equal(isAcknowledgement(s), false, `should NOT be ack: "${s}"`);
  }
});

test('unanswered "thanks" is excluded, unanswered real request counts', () => {
  const c = { ...config, excludeAcknowledgements: true };
  const t = computeChannelTickets({ id: 'C8', name: 'ack' }, [
    mk(bog(2026, 6, 15, 9, 0), 'client', { text: 'take this down' }), // real, unanswered
    mk(bog(2026, 6, 15, 9, 1), 'team'),                               // answers it
    mk(bog(2026, 6, 15, 9, 2), 'client', { text: 'Thanks!' }),        // closer, unanswered
  ], c);
  const closer = t.find((x) => x.text === 'Thanks!');
  assert.equal(closer.status, 'fyi_ignored'); // excluded, not a miss
});

test('emoji reaction never counts as a response by default', () => {
  const t = computeChannelTickets({ id: 'C9', name: 'z' }, [
    mk(bog(2026, 6, 15, 9, 0), 'client', { reactions: [{ name: 'eyes', count: 1 }] }),
  ], config);
  assert.equal(t[0].status, 'unanswered'); // reaction present, but no text reply
});
