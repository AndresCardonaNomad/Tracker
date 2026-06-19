# Client Response Time Tracker

Measures how fast Nomad responds to clients across all 100+ client Slack channels, and writes a weekly metric + breakdown to Google Sheets for the director's scorecard.

**Headline metric:** % of client messages first answered within 60 business minutes (configurable). Plus median + p90, broken down by team, writer, and channel.

## How it works
1. Pulls the last 7 days of history from every channel the bot is in (`lib/slack.js`).
2. Auto-detects client vs. team from Slack guest flags / Slack Connect / overrides (`lib/classify.js`).
3. Counts response time in business hours only (`lib/business-hours.js`).
4. Pairs each client message with the first team reply → tickets → stats (`lib/metrics.js`).
5. Writes the weekly row + detail tables to Sheets (`lib/sheets.js`).

## Commands
```
npm install
npm test                 # unit tests (logic only, no Slack needed)
node pilot.js            # validate on ~10 channels, prints audit, no write
node run.js --dry        # full compute, print only
node run.js              # full compute + write to Sheets
```

## Setup
See **[C] Setup Guide.md** (Slack app, scopes, install, pilot, scheduling).
Metric definition + data model: **[C] Design Spec.md**. Project context: **[C] Project Overview.md**.

All tunables (hours, timezone, SLA, scoping, overrides) live in `config.js`.

## Status
Code complete, 9/9 unit tests passing. Not yet run live — needs the Slack app + `credentials.json`. Start with the pilot.
