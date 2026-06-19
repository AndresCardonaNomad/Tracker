---
author: claude
type: solution
project: Client Response Time Tracker
updated: 2026-06-18
---

# Design Spec — Client Response Time Tracker

This is the exact metric definition, data model, and report format. Logic lives in `lib/`; all tunables live in `config.js`.

## 1. The metric

**Headline KPI (the scorecard number):**
> **SLA hit rate** = % of client messages whose first team response came within **N business minutes** (default N = 60).

Bounded 0–100%, intuitive, and resistant to a few slow outliers. This single number goes on Gaby's scorecard.

**Supporting numbers (drill-down):**
- **Median** first-response time (business minutes) — robust to outliers, harder to game than the mean.
- **p90** first-response time — exposes the slow tail.

Why not the mean: one ignored message destroys it and it's trivially gamed. The SLA-hit + median + p90 trio is fair and hard to game.

**Anti-gaming rules:**
- A response is the **first text message from a non-client, non-bot human**. Emoji reactions never count as a response (config `countEmojiAsResponse: false`), so nobody wins by slapping 👀 on everything.
- Consecutive client messages with no reply between them **collapse into one ticket**, timed from the **earliest** message — you can't reset the clock by making the client repeat themselves.

## 2. Core definitions

**Ticket** — a client message that needs a response. Opened by the first unanswered client message in a conversation; closed by the first qualifying team reply.

**Conversation** — a thread is one conversation; all non-threaded main-channel messages share the `main` conversation. This stops a reply in one thread from being matched to an unrelated main-channel message.

**Business minutes** — elapsed time counted only on working days, within working hours, excluding holidays (`config.timezone`, `workingDays`, `workStartHour`, `workEndHour`, `holidays`). A Friday-17:00 message answered Monday-09:10 ≈ 10 business minutes, not a weekend.

**Ticket statuses:**
| Status | Meaning | In SLA denominator? |
|---|---|---|
| `answered` | got a team text reply | yes |
| `unanswered` | no reply by window close | yes (counts against you) |
| `no_action` | teammate added the `:no_action:` emoji | no (excluded) |
| `fyi_ignored` | unanswered + shorter than `ignoreUnansweredShorterThan` chars | no (excluded) |
| `ack_only` | only emoji ack, and `countEmojiAsResponse: true` | no (excluded) |

## 3. Client-vs-team detection

A user is a **client (external)** if any are true: Slack guest (`is_restricted` or `is_ultra_restricted`), foreign `team_id` (Slack Connect), or listed in `clientOverrides`. A user is **team** if a full member of the workspace, or listed in `teamOverrides` (which wins over the guest flag). Bots/apps are excluded from both sides.

**Channel scoping** (`channelScope`): `auto` (default) treats a channel as a client channel if ≥1 external user has posted; `prefix` uses a name prefix; `allowlist` uses an explicit list. `channelDenylist` always excludes.

## 4. Data model

Pipeline: `slack.js` (raw pull) → `collect.js` (normalize + role-tag + scope) → `metrics.js` (tickets + aggregate) → `sheets.js` (output).

Normalized message:
```
{ ts:Number(seconds), user:String|null, text:String,
  thread_ts:String|undefined, role:'client'|'team'|'bot'|'unknown',
  reactions:[{name,count}] }
```
Ticket:
```
{ channelId, channelName, openedTs, clientUser, text, reactions,
  followUps, status, responseTs?, responder?, businessMinutes?, withinSla? }
```
Aggregate output: `{ overall, byResponder[], byChannel[], byTeam[] }` where `overall` carries `slaHitRate, medianMinutes, p90Minutes, clientMessages, answered, unanswered, excluded`.

No message text is persisted to Sheets — only metadata (timestamps, ids, counts, a short snippet only in the local pilot console). Privacy by default.

## 5. Report format (Google Sheets)

**`<RESULTS_TAB>` (default "Response Time")** — one upserted row per week, the scorecard feed:

`Week | SLA Hit % | Median | p90 | Client Msgs | Answered | Unanswered | Channels | Updated`

Re-running the same week overwrites that row (idempotent).

**`<RESULTS_TAB> Detail`** — overwritten each run, three stacked tables:
- **By team** (assigned channels) — SLA %, median, p90, counts.
- **By writer** (who responded) — responses, SLA %, median, within-SLA count.
- **By channel** (worst first) — SLA %, median, p90, counts.

## 6. Known limitations (v1)
- Only captures channels the bot is a member of.
- A thread whose parent predates the lookback window may be missed (rare; v2 realtime removes this).
- `unknown` authors (users who left the workspace) are ignored.
- Reaction timestamps aren't exposed by Slack, so emoji acks are presence-only, never timed (by design they don't count as responses).
