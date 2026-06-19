// lib/sheets.js — write weekly results to Google Sheets.
// Same service-account pattern as the Performance Dashboard: a credentials.json
// next to the project, shared with the sheet as Editor.
//
// Output:
//   <RESULTS_TAB>            : one upserted summary row per week (the scorecard feed)
//   <RESULTS_TAB> Detail     : overwritten each run — by team, by writer, by channel

import path from 'path';
import { fileURLToPath } from 'url';
import { google } from 'googleapis';
import { formatMinutes } from './business-hours.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CREDENTIALS_PATH = path.join(__dirname, '..', 'credentials.json');

async function getSheets() {
  const auth = new google.auth.GoogleAuth({
    keyFile: CREDENTIALS_PATH,
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });
  return google.sheets({ version: 'v4', auth });
}

export function weekLabel(window, style) {
  const d = new Date(window.latest * 1000);
  if (style === 'date') {
    return `wk ending ${d.toISOString().slice(0, 10)}`;
  }
  // ISO week
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const wk = Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(wk).padStart(2, '0')}`;
}

async function ensureTab(sheets, spreadsheetId, title) {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const exists = meta.data.sheets.some((s) => s.properties.title === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: { requests: [{ addSheet: { properties: { title } } }] },
    });
  }
}

// Accept either a bare spreadsheet ID or a full Google Sheets URL.
function normalizeSpreadsheetId(value) {
  if (!value) return value;
  const m = String(value).match(/\/d\/([a-zA-Z0-9-_]+)/);
  return m ? m[1] : String(value).trim();
}

export async function writeResults(results, config, env, window) {
  const sheets = await getSheets();
  const spreadsheetId = normalizeSpreadsheetId(env.RESULTS_SPREADSHEET_ID);
  const tab = env.RESULTS_TAB || 'Response Time';
  const detailTab = `${tab} Detail`;
  const label = weekLabel(window, config.weekLabelStyle);
  const o = results.overall;

  await ensureTab(sheets, spreadsheetId, tab);
  await ensureTab(sheets, spreadsheetId, detailTab);

  // --- summary upsert ---
  const header = ['Week', 'SLA Hit %', 'Median', 'p90', 'Client Msgs', 'Answered', 'Unanswered', 'Channels', 'Updated'];
  const row = [
    label,
    o.slaHitRate ?? '',
    formatMinutes(o.medianMinutes),
    formatMinutes(o.p90Minutes),
    o.clientMessages,
    o.answered,
    o.unanswered,
    results.byChannel.length,
    new Date().toISOString(),
  ];

  const existing = await sheets.spreadsheets.values.get({
    spreadsheetId, range: `${tab}!A:A`,
  });
  const labels = (existing.data.values || []).map((r) => r[0]);
  if (labels.length === 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId, range: `${tab}!A1`, valueInputOption: 'RAW',
      requestBody: { values: [header, row] },
    });
  } else {
    const idx = labels.indexOf(label); // 0-based incl header
    if (idx > 0) {
      await sheets.spreadsheets.values.update({
        spreadsheetId, range: `${tab}!A${idx + 1}`, valueInputOption: 'RAW',
        requestBody: { values: [row] },
      });
    } else {
      await sheets.spreadsheets.values.append({
        spreadsheetId, range: `${tab}!A:A`, valueInputOption: 'RAW',
        insertDataOption: 'INSERT_ROWS', requestBody: { values: [row] },
      });
    }
  }

  // --- detail overwrite ---
  const block = [];
  block.push([`Client Response Time — detail for ${label}`]);
  block.push([]);
  block.push(['BY TEAM (assigned channels)']);
  block.push(['Team', 'SLA Hit %', 'Median', 'p90', 'Client Msgs', 'Answered', 'Unanswered']);
  for (const t of results.byTeam) {
    block.push([t.team, t.slaHitRate ?? '', formatMinutes(t.medianMinutes), formatMinutes(t.p90Minutes), t.clientMessages, t.answered, t.unanswered]);
  }
  block.push([]);
  block.push(['BY WRITER (who responded)']);
  block.push(['Writer (user id)', 'Responses', 'SLA Hit %', 'Median', 'Within SLA']);
  for (const r of results.byResponder) {
    block.push([r.key, r.responses, r.slaHitRate ?? '', formatMinutes(r.medianMinutes), r.withinSla]);
  }
  block.push([]);
  block.push(['BY CHANNEL (worst first)']);
  block.push(['Channel', 'Team', 'SLA Hit %', 'Median', 'p90', 'Client Msgs', 'Answered', 'Unanswered']);
  for (const c of results.byChannel) {
    block.push([c.channelName, c.team, c.slaHitRate ?? '', formatMinutes(c.medianMinutes), formatMinutes(c.p90Minutes), c.clientMessages, c.answered, c.unanswered]);
  }

  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${detailTab}!A:Z` });
  await sheets.spreadsheets.values.update({
    spreadsheetId, range: `${detailTab}!A1`, valueInputOption: 'RAW',
    requestBody: { values: block },
  });

  return { label, summaryTab: tab, detailTab };
}

export default { writeResults, weekLabel };
