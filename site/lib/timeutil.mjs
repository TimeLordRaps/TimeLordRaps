// Time-zone aware helpers built on Intl only, so they behave the same in Node and browsers.

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const cache = new Map();

function formatter(tz) {
  let f = cache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      hourCycle: 'h23',
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric',
      timeZoneName: 'short',
    });
    cache.set(tz, f);
  }
  return f;
}

export const pad2 = (n) => String(n).padStart(2, '0');
export const monthName = (m) => MONTHS[m - 1];
export const weekdayName = (i) => WEEKDAYS[i].toUpperCase();

export function localZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function zoneParts(date, tz) {
  const o = {};
  for (const p of formatter(tz).formatToParts(date)) o[p.type] = p.value;
  return {
    year: +o.year,
    month: +o.month,
    day: +o.day,
    hour: +o.hour % 24,
    minute: +o.minute,
    second: +o.second,
    weekday: WEEKDAYS.indexOf(o.weekday),
    tzName: o.timeZoneName,
  };
}

export function zoneOffsetMinutes(date, tz) {
  const p = zoneParts(date, tz);
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUTC - Math.floor(date.getTime() / 1000) * 1000) / 60000);
}

export const hhmm = (p) => `${pad2(p.hour)}:${pad2(p.minute)}`;
export const hhmmss = (p) => `${pad2(p.hour)}:${pad2(p.minute)}:${pad2(p.second)}`;

/** "SAT 24 OCT 2026" */
export function dateLabel(p) {
  return `${WEEKDAYS[p.weekday].toUpperCase()} ${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
}

/** Fraction of the local day/week/month/year elapsed, 0..1. */
export function progress(date, tz) {
  const p = zoneParts(date, tz);
  const sec = p.hour * 3600 + p.minute * 60 + p.second + date.getMilliseconds() / 1000;
  const day = sec / 86400;
  const week = (p.weekday + day) / 7;
  const dim = new Date(Date.UTC(p.year, p.month, 0)).getUTCDate();
  const month = (p.day - 1 + day) / dim;
  const yearStart = Date.UTC(p.year, 0, 1);
  const yearLen = (Date.UTC(p.year + 1, 0, 1) - yearStart) / 86400000;
  const doy = (Date.UTC(p.year, p.month - 1, p.day) - yearStart) / 86400000;
  const year = (doy + day) / yearLen;
  return { day, week, month, year, dayOfYear: doy + 1, daysInYear: yearLen };
}
