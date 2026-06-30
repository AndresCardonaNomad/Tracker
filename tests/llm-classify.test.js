// Unit tests for the LLM accuracy gate — pure helpers + status-flip logic.
// A fake classifier is injected so these tests never touch the network/SDK.
// Run: npm test   (node --test)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildContext, cacheKey, parseResponse, classifyNeedsResponse,
} from '../lib/llm-classify.js';

const cfg = { useLlmClassifier: true, llmModel: 'x', llmBatchSize: 20 };

test('buildContext joins client burst and labels prior message', () => {
  const c = buildContext({
    text: 'take this down',
    burstText: ['take this down', 'asap'],
    prevText: 'Here is the edit',
    prevRole: 'team',
  });
  assert.equal(c.client, 'take this down / asap');
  assert.equal(c.prevLabel, 'TEAM');
  assert.equal(c.prev, 'Here is the edit');
});

test('cacheKey is stable for same content and differs across content', () => {
  const a = { text: 'hi', burstText: ['hi'], prevText: '', prevRole: null };
  const b = { text: 'hi', burstText: ['hi'], prevText: '', prevRole: null };
  const c = { text: 'bye', burstText: ['bye'], prevText: '', prevRole: null };
  assert.equal(cacheKey(a), cacheKey(b));
  assert.notEqual(cacheKey(a), cacheKey(c));
});

test('parseResponse extracts valid items and ignores junk/out-of-range', () => {
  const raw = 'sure:\n[{"i":1,"needs":true,"reason":"request"},{"i":2,"needs":false,"reason":"thanks"},{"i":9,"needs":true},{"i":3,"needs":"x"}]';
  const out = parseResponse(raw, 2);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((x) => [x.i, x.needs]), [[1, true], [2, false]]);
});

test('parseResponse returns [] on non-JSON', () => {
  assert.deepEqual(parseResponse('no json here', 5), []);
  assert.deepEqual(parseResponse('', 5), []);
});

test('gate flips fyi_ignored -> unanswered when LLM says a reply is needed', async () => {
  const tickets = [
    { status: 'fyi_ignored', text: 'ok take it down', burstText: ['ok take it down'], channelName: 'a' },
    { status: 'unanswered', text: 'looks great, will review next week', burstText: ['looks great, will review next week'], channelName: 'a' },
    { status: 'answered', text: 'why no post', burstText: ['why no post'], channelName: 'a', businessMinutes: 5, withinSla: true },
    { status: 'no_action', text: 'thx', burstText: ['thx'], channelName: 'a' },
  ];
  // Fake classifier: #1 (a real request mislabelled ack) needs reply; #2 (FYI) does not.
  const classify = (batch) => batch.map((t, idx) => ({
    i: idx + 1,
    needs: /take it down/.test(t.text),
    reason: 'test',
  }));

  await classifyNeedsResponse(tickets, cfg, { classify });

  assert.equal(tickets[0].status, 'unanswered'); // ack -> real miss
  assert.equal(tickets[1].status, 'fyi_ignored'); // FYI -> excluded
  assert.equal(tickets[2].status, 'answered');    // untouched
  assert.equal(tickets[3].status, 'no_action');   // untouched
  assert.ok(tickets[0].llmJudged && tickets[1].llmJudged);
});

test('gate is a no-op when disabled', async () => {
  const tickets = [{ status: 'unanswered', text: 'x', burstText: ['x'], channelName: 'a' }];
  await classifyNeedsResponse(tickets, { ...cfg, useLlmClassifier: false }, { classify: () => [{ i: 1, needs: false }] });
  assert.equal(tickets[0].status, 'unanswered');
});

test('gate leaves status untouched when the classifier omits a ticket (API hiccup)', async () => {
  const tickets = [{ status: 'unanswered', text: 'x', burstText: ['x'], channelName: 'a' }];
  await classifyNeedsResponse(tickets, cfg, { classify: () => [] }); // no verdict returned
  assert.equal(tickets[0].status, 'unanswered'); // fallback: keep heuristic
});
