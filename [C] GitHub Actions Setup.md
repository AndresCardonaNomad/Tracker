---
author: claude
type: solution
project: Client Response Time Tracker
updated: 2026-06-18
---

# Run on Autopilot with GitHub Actions (no PC needed)

This runs `node run.js` every night in GitHub's cloud, so your computer can be off. Your secrets are stored encrypted in GitHub and injected at runtime — they are never committed (`.gitignore` already blocks `.env` and `credentials.json`).

One-time setup, ~15 minutes. After this it's fully hands-off.

---

## Why a separate repo
Your `second-brain` vault is already a git repo, and putting another repo inside it would break your vault sync. So this app gets its own small repo. The cleanest move is to copy the project out to a standalone folder and push *that*.

## Step 1 — Copy the project to a standalone folder
In **PowerShell** (this skips `node_modules`; GitHub rebuilds it):
```powershell
robocopy "C:\Users\andre\OneDrive\Escritorio\second-brain\02 Projects\Client Response Time Tracker" "C:\Users\andre\Desktop\client-response-time-tracker" /E /XD node_modules
```
From now on, **the Desktop folder is the home of the automated app.** (The vault copy can stay as a reference.)

## Step 2 — Create a private GitHub repo
Easiest path is **GitHub Desktop** (https://desktop.github.com):
1. File → Add Local Repository → choose `C:\Users\andre\Desktop\client-response-time-tracker`.
2. It'll offer to create a repository here — click **Create a repository**.
3. Click **Publish repository**, keep **"Keep this code private" ticked**, Publish.

Prefer the command line? In that folder:
```powershell
cd "C:\Users\andre\Desktop\client-response-time-tracker"
git init
git add .
git commit -m "Client Response Time Tracker"
gh repo create client-response-time-tracker --private --source=. --push
```
(The `gh` line needs the GitHub CLI; otherwise create the empty private repo on github.com and follow its "push an existing repository" snippet.)

> Double-check before pushing: `git status` should NOT list `.env` or `credentials.json`. If it does, stop — the `.gitignore` isn't being applied.

## Step 3 — Add your three secrets
On github.com → your repo → **Settings → Secrets and variables → Actions → New repository secret**. Add these three:

| Secret name | Value |
|---|---|
| `SLACK_BOT_TOKEN` | The `xoxb-…` value from your `.env` |
| `RESULTS_SPREADSHEET_ID` | The spreadsheet URL/ID from your `.env` (the code accepts either) |
| `GOOGLE_CREDENTIALS_JSON` | The **entire contents** of `credentials.json` — open it, select all, paste |

## Step 4 — Test it now (don't wait for midnight)
Repo → **Actions** tab → **"Client Response Time Tracker (daily)"** → **Run workflow**. It runs in ~1 minute; open the run to see the log, then check your **"Writer Director Scorecard"** sheet for the new row. Green check = you're live.

## Step 5 — Nothing else to do
It now runs automatically every night. The schedule is in `.github/workflows/daily.yml`:
```
cron: '0 5 * * *'   # 05:00 UTC = 00:00 America/Bogota
```

### Good to know
- **Timezone:** GitHub cron is UTC. `0 5 * * *` = midnight Bogota. Change the hour if your timezone changes.
- **Timing:** free GitHub runners can start a scheduled job a few minutes late under load — fine for a nightly KPI.
- **Inactivity:** GitHub pauses scheduled workflows after 60 days with **no commits**. Any push (or a manual "Run workflow") resets the clock. If you go quiet for two months, just hit Run workflow once.
- **Updating the code later:** edit in the Desktop repo folder and `git push` (or use GitHub Desktop). The next run uses the new code automatically.
- **Cost:** $0 on private repos within the free Actions minutes; a ~1-minute nightly job is negligible.
