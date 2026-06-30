# Design Spec — LLM Accuracy Gate for the Client Response Time Tracker

**Date:** 2026-06-30
**Author:** Claude (with Andres)
**Status:** Approved, ready to implement

## Problem

The tracker's headline KPI is the SLA hit rate: `answered_within_SLA / (answered + unanswered)`. The denominator counts every client message tagged `answered` or `unanswered`. The accuracy weak point is **unanswered** messages that get counted as "misses" but never actually needed a team reply (FYIs, "I'll send the assets tomorrow 🙌", status updates). Today the only defense is `isAcknowledgement()` — a hardcoded word-list (`ACK_TOKENS`) that only fires when *every* word is an ack word and the message is ≤6 tokens. It is brittle in both directions:

- **False misses:** a longer no-action message ("looks great, will review next week") is counted as an unanswered miss → deflates the rate unfairly.
- **False exclusions:** a real short request that happens to be all-common-words could be dropped.

Now that the bot is in ~100 client channels (not the original 8-channel pilot), this number is the real agency-wide KPI, so the denominator must be right.

## Approach

Add an **optional LLM gate** that adjudicates every **non-answered, non-`:no_action:`** client ticket with one binary question: *"Does this client message require a team response?"*

- **yes** → status `unanswered` (a real miss, counts against the rate)
- **no** → status `fyi_ignored` (excluded from the denominator)

**Scope (decided):** the LLM judges every ticket whose status is `unanswered` OR `fyi_ignored` (i.e. everything not `answered` and not `no_action`). This replaces the brittle word-list as the *authority* for unanswered inclusion and catches false-exclusions too. `answered` and `no_action` tickets are never sent (already resolved) — keeps cost minimal.

This is the only behavioral change. Business-hours math, ticket pairing, burst-rescue, aggregation, and Sheets output are untouched.

## Components

### New module — `lib/llm-classify.js`
- `classifyNeedsResponse(tickets, config)` → returns the same tickets with adjudicated `status`.
  - Filters to the un-resolved set (`unanswered` | `fyi_ignored`).
  - Batches them (`config.llmBatchSize`, default 20) to **Claude Haiku 4.5** (`claude-haiku-4-5-20251001`) via the official `@anthropic-ai/sdk` (same pattern as the Performance Dashboard's `auto-classify.js`).
  - Prompt includes, per ticket: the client message text (full burst if they double-texted) + the one preceding message in that conversation (role-labelled) as context.
  - Response is a JSON array `[{"i": <1-based>, "needs": <bool>, "reason": "<short>"}]`; parsed with the same regex+`JSON.parse` guard as `auto-classify.js`.
  - **Local cache** at `.cache/llm.json` (gitignored), keyed by a hash of `text + context`, so re-runs and the two weekly windows never re-spend.
  - **Graceful fallback:** if `ANTHROPIC_API_KEY` is missing or any API/parse error occurs, leave each ticket's status as the heuristic already set it (no throw). The nightly cloud run can never break on this.
- Pure helpers (`buildContext`, `cacheKey`, `parseResponse`) exported for unit tests so tests run with **no network**.

### Wiring
- `run.js`, `pilot.js`, `backfill.js`: after `collect()` returns `tickets`, if `config.useLlmClassifier`, call `await classifyNeedsResponse(tickets, config)` before `aggregate()`.
- The reclassification only flips statuses within `{unanswered, fyi_ignored}`; `aggregate()` consumes the result unchanged.

### Config (`config.js`)
```
useLlmClassifier: true,
llmModel: 'claude-haiku-4-5-20251001',
llmBatchSize: 20,
```
Key from env `ANTHROPIC_API_KEY` (added to this project's `.env`, value copied from the dashboard's `ANTRHOPIC_UPLOAD_TRACKER_API`). For the live GitHub Actions run to use it, add `ANTHROPIC_API_KEY` as a repo secret + workflow env; until then the cloud run uses the fallback.

### "Last week + this week"
- Add a `--week-offset N` flag to `run.js`: `0` = current ISO week (`startOfISOWeekSec(now)` → now), `-1` = the prior full ISO week (`[thisMonday - 7d, thisMonday]`).
- Compute both with `--dry` first; print the % per week **and** the list of messages the LLM reclassified (with its one-line reason) for sanity-check, then write to the Writing Scorecard (`WRITING_SCORECARD_ID = 1Fx6aHqE…`) Response Time rows.

## Cost
Only unanswered/fyi tickets, batched ~20/call, Haiku, cached → realistically a few calls/week, well under a cent. The two backfill runs now are a one-time few cents at most.

## Testing
- Unit-test `parseResponse`, `cacheKey`, `buildContext`, and the status-flip logic with a **mocked classifier** (no network). Existing 11 tests stay green.

## Out of scope / caveats
- Channel coverage is a Slack-invite concern, not an API one; the LLM makes the *measured* channels accurate.
- Answered-but-didn't-need-a-reply inflation is left alone (minor effect, more cost) — explicitly not addressed.
