// lib/business-hours.js — elapsed BUSINESS minutes between two unix timestamps.
// Clock ticks only on working days, within working hours, excluding holidays.
// Timezone-aware via Intl (no external deps). Assumes the configured tz has a
// stable UTC offset across a working day (true for America/Bogota — no DST).

// Local wall-clock parts for an instant (ms) in a tz, plus that instant's
// "as-if-UTC" value used to derive the offset.
function parts(ms, tz) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = dtf.formatToParts(new Date(ms)).reduce((a, x) => { a[x.type] = x.value; return a; }, {});
  let hour = parseInt(p.hour, 10); if (hour === 24) hour = 0;
  const asUTC = Date.UTC(+p.year, +p.month - 1, +p.day, hour, +p.minute, +p.second);
  return { y: +p.year, mo: +p.month, d: +p.day, asUTC };
}

function offsetAt(ms, tz) {
  return parts(ms, tz).asUTC - ms; // local = utc + offset
}

// Convert a wall-clock time (in tz) to a UTC instant in ms.
function wallToMs(y, mo, d, h, mi, tz) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  return guess - offsetAt(guess, tz);
}

export function businessMinutesBetween(startSec, endSec, config) {
  const tz = config.timezone;
  const startMs = startSec * 1000;
  const endMs = endSec * 1000;
  if (endMs <= startMs) return 0;

  const holidays = new Set(config.holidays || []);
  const startParts = parts(startMs, tz);
  let { y, mo, d } = startParts;
  let total = 0;

  for (let i = 0; i < 400; i++) {            // safety cap (~13 months)
    const dayStartMs = wallToMs(y, mo, d, 0, 0, tz);
    if (dayStartMs > endMs) break;

    const wd = new Date(Date.UTC(y, mo - 1, d)).getUTCDay();
    const iso = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

    if (config.workingDays.includes(wd) && !holidays.has(iso)) {
      const winStart = wallToMs(y, mo, d, config.workStartHour, 0, tz);
      const winEnd = wallToMs(y, mo, d, config.workEndHour, 0, tz);
      const lo = Math.max(startMs, winStart);
      const hi = Math.min(endMs, winEnd);
      if (hi > lo) total += hi - lo;
    }

    const next = new Date(Date.UTC(y, mo - 1, d + 1));
    y = next.getUTCFullYear(); mo = next.getUTCMonth() + 1; d = next.getUTCDate();
  }

  return Math.round(total / 60000);
}

// Unix seconds for Monday 00:00 (local tz) of the ISO week containing nowSec.
export function startOfISOWeekSec(nowSec, config) {
  const tz = config.timezone;
  const p = parts(nowSec * 1000, tz);
  const wd = new Date(Date.UTC(p.y, p.mo - 1, p.d)).getUTCDay(); // 0=Sun..6=Sat
  const iso = wd === 0 ? 7 : wd;                                  // 1=Mon..7=Sun
  const monday = new Date(Date.UTC(p.y, p.mo - 1, p.d - (iso - 1)));
  return Math.floor(
    wallToMs(monday.getUTCFullYear(), monday.getUTCMonth() + 1, monday.getUTCDate(), 0, 0, tz) / 1000
  );
}

// Pretty string for reports: 73 -> "1h 13m", 9 -> "9m".
export function formatMinutes(min) {
  if (min == null) return '—';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default { businessMinutesBetween, formatMinutes };
