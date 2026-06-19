---
author: claude
type: solution
project: Client Response Time Tracker
updated: 2026-06-18
---

# Setup Guide — Client Response Time Tracker

Goal: go from zero to a weekly Client Response Time number in Sheets. Do the **pilot (Step 5) on ~10 channels first** to validate client detection before the 100-channel rollout.

## Step 1 — Create the Slack app
1. Go to https://api.slack.com/apps → **Create New App** → **From scratch**.
2. Name it "Client Response Time Tracker", pick the Nomad workspace.
3. Left sidebar → **OAuth & Permissions** → **Scopes** → **Bot Token Scopes**, add:
   - `channels:history` — read public channel messages
   - `groups:history` — read private channel messages
   - `channels:read` — list public channels
   - `groups:read` — list private channels
   - `users:read` — roster + guest flags (client detection)
   - `users:read.email` — *(optional)* only if you want to use email-based overrides
   - `reactions:read` — read the `:no_action:` emoji and acks
4. Top of that page → **Install to Workspace** → approve (you said you're an Admin who can install).
5. Copy the **Bot User OAuth Token** (`xoxb-…`).

## Step 2 — Project config
1. In the project folder, copy `.env.example` to `.env` and fill in:
   - `SLACK_BOT_TOKEN=xoxb-…`
   - `RESULTS_SPREADSHEET_ID=` the Sheet ID (from its URL) — can be the scorecard sheet or a dedicated one
   - `RESULTS_TAB=Response Time`
2. Open `config.js` and confirm the defaults:
   - `timezone: 'America/Bogota'`, `workingDays: [1–5]`, `workStartHour: 9`, `workEndHour: 18`
   - `slaBusinessMinutes: 60`
   - `channelScope: 'auto'`
   - Add any `holidays`.

## Step 3 — Google Sheets credentials (same as Performance Dashboard)
1. In Google Cloud Console, use a service account with the Sheets API enabled and download its JSON key.
   (You can reuse the Performance Dashboard's service account — copy its `credentials.json` into this folder.)
2. Place the key as `credentials.json` in the project root.
3. Open the target Google Sheet → **Share** → add the service account's `client_email` as **Editor**.

## Step 4 — Install dependencies
```
cd "02 Projects/Client Response Time Tracker"
npm install
npm test        # optional: confirms the logic (9 tests) passes
```

## Step 5 — PILOT (do this before scaling)
1. Invite the bot to ~10 representative client channels: in each channel type `/invite @Client Response Time Tracker`.
2. Run the pilot (reads only, never writes to Sheets):
   ```
   node pilot.js
   # or target specific channels:
   PILOT_CHANNELS="terry-cullen-chevy,some-other-client" node pilot.js
   ```
3. Read the output:
   - **CLIENT? column** — every real client channel should say `YES`. If a client channel shows `no`, the client isn't being detected as external → add them to `clientOverrides` in `config.js`. If an internal channel shows `YES`, add it to `channelDenylist`.
   - **Sample tickets** — sanity-check that openings, responders, and times look right.
4. Tune `config.js` and re-run until the audit looks correct. **This validates the one assumption everything rests on.**

## Step 6 — Full run
1. Invite the bot to the rest of the client channels.
   - Public channels: the bot can self-join, but inviting is simplest/consistent.
   - Private channels: must be invited manually (`/invite`). This is the main one-time chore — knock out a batch at a time.
2. Dry run first:
   ```
   node run.js --dry      # computes + prints, no Sheets write
   ```
3. Live:
   ```
   node run.js            # writes the weekly row + detail to Sheets
   ```

## Step 7 — Schedule it weekly
Run every Monday morning for the prior week. Examples:
- **cron** (Colombia time): `0 7 * * 1 cd /path/to/project && node run.js >> run.log 2>&1`
- Or ask me to set up a scheduled task that runs `node run.js` weekly.

## Troubleshooting
- `not_in_channel` on a channel → the bot isn't a member; invite it.
- `missing_scope` → add the scope in Step 1 and **reinstall** the app.
- Channel shows `no` in CLIENT? but should be yes → the client posted nothing in the window, or isn't a guest/Connect user → use `clientOverrides` or `channelScope: 'prefix'/'allowlist'`.
- Sheets `PERMISSION_DENIED` → share the sheet with the service account `client_email` as Editor.

## When you're ready for v2 (realtime)
The same `lib/` (classify, business-hours, metrics) powers a Socket Mode app that logs each client message + first reply live and can post an end-of-day/weekly report into Slack. You already ran Socket Mode for the accountability bot, so the infra is familiar. Say the word and I'll build it on top of this.
