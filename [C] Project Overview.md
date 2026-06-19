---
author: claude
type: problems
project: Client Response Time Tracker
status: active
updated: 2026-06-18
---

# Client Response Time Tracker — Project Overview

## Goal
Produce one weekly **Client Response Time** number for the director's scorecard, plus a per-team / per-writer / per-channel breakdown, automatically, across all 100+ client Slack channels.

## Why
Clients drop requests in their channel ("take this down", "why hasn't this posted", "swap these two"). How fast we respond is a real client-experience signal that is currently invisible and unmeasured. It's a placeholder KPI on Gaby's scorecard. Manual tracking across 100+ channels is impossible, so it has to be automated.

## Tangible outcomes
- A weekly figure: **% of client messages first answered within 60 business minutes** (the headline), with median + p90 as supporting numbers.
- A breakdown by team, by writer (who actually responded), and by channel (worst first).
- The number lands in a Google Sheet tab that feeds the existing scorecard — same service-account pattern as the Performance Dashboard.

## Approach (decided)
Custom build, v1 = **scheduled history-pull script** (no event server). It pulls the last 7 days of history from every channel the bot is in, detects client vs. team automatically, computes business-hours response time, and writes the weekly metric + breakdown to Sheets. Backfills history immediately, so trend exists from day one. v2 (later) = realtime Socket Mode app reusing the same engine, for live end-of-day alerts.

## The key insight
Clients are invited by email to a single channel → Slack provisions them as **guests** (`is_restricted` / `is_ultra_restricted`) or, if their email belongs to another Slack org, as **Slack Connect** users (different `team_id`). Both are flagged in the Slack API, so "client vs. team" is **mostly automatic** — no hand-maintained client list per channel. A tiny override list handles edge cases.

## Status
Code complete and unit-tested (9/9 passing) against synthetic data. **Not yet run live** — needs the Slack app created, the bot invited to channels, and `credentials.json` in place. Next action: create the Slack app and run `node pilot.js` on ~10 channels to validate client detection before scaling to 100.

## Open problems / decisions to confirm
1. **Business hours** — defaulted to America/Bogota, Mon–Fri, 09:00–18:00. Confirm or adjust in `config.js`.
2. **SLA threshold** — defaulted to 60 business minutes. Confirm the bar.
3. **Bot into private channels** — the one real chore: the bot must be invited to each private client channel (public it can self-join). Need a rollout pass.
4. **"No reply needed" messages** — v1 measures answered messages + counts unanswered as breaches, with a `:no_action:` emoji escape hatch and an optional short-FYI ignore. Validate against real data in the pilot, then tune.
5. **Assigned-team map** — optional `channelTeamMap` for the "who SHOULD have answered" cut. Empty for v1; "who DID respond" works without it.

## Files
See `[C] Design Spec.md` (metric definition, data model, report format) and `[C] Setup Guide.md` (Slack app, scopes, install, pilot, scheduling). `README.md` is the short version.
