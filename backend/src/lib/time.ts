/**
 * Timezone + calendar helpers. Two kinds of values:
 *  - instants (`Date`) — real points in time (check-in timestamps)
 *  - calendar dates (`"YYYY-MM-DD"` strings) — local days in the company timezone
 * Calendar dates are stored in Postgres as DATE and travel through Prisma as UTC-midnight Dates.
 */

export interface ZonedParts {
  date: string; // YYYY-MM-DD (local)
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(timeZone, f);
  }
  return f;
}

export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(instant)) parts[p.type] = p.value;
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  return {
    year,
    month,
    day,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    date: `${parts.year}-${parts.month}-${parts.day}`,
  };
}

/** Today's calendar date in `timeZone`. */
export function todayIn(timeZone: string, now: Date = new Date()): string {
  return zonedParts(now, timeZone).date;
}

/** "HH:MM" local wall-clock time of an instant. */
export function localTimeHHMM(instant: Date, timeZone: string): string {
  const p = zonedParts(instant, timeZone);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

function offsetMs(instant: Date, timeZone: string): number {
  const p = zonedParts(instant, timeZone);
  const wallAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return wallAsUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/** Convert a local wall-clock time in `timeZone` to the UTC instant (DST-safe second pass). */
export function zonedToUtc(date: string, time: string, timeZone: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const [hh, mm, ss = 0] = time.split(':').map(Number) as [number, number, number?];
  const guess = Date.UTC(y, m - 1, d, hh, mm, ss);
  const first = offsetMs(new Date(guess), timeZone);
  let result = guess - first;
  const second = offsetMs(new Date(result), timeZone);
  if (second !== first) result = guess - second;
  return new Date(result);
}

export function parseHHMM(value: string): number {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) throw new Error(`Invalid HH:MM time: ${value}`);
  return Number(match[1]) * 60 + Number(match[2]);
}

/** LATE if the local check-in time is strictly after the shift start (09:30:00 is on time, 09:30:01 is late). */
export function isLate(checkInAt: Date, shiftStart: string, timeZone: string): boolean {
  const p = zonedParts(checkInAt, timeZone);
  const secondsIntoDay = p.hour * 3600 + p.minute * 60 + p.second;
  return secondsIntoDay > parseHHMM(shiftStart) * 60;
}

// ---------------------------------------------------------------------------
// Calendar dates ("YYYY-MM-DD")
// ---------------------------------------------------------------------------

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export function isValidDateStr(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

/** Calendar date → Date for a Postgres DATE column. */
export function dateToDb(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`);
}

/** Postgres DATE (UTC midnight) → calendar date string. */
export function dbToDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

export function addDays(value: string, days: number): string {
  const d = dateToDb(value);
  d.setUTCDate(d.getUTCDate() + days);
  return dbToDate(d);
}

/** 0 = Sunday … 6 = Saturday */
export function weekdayOf(value: string): number {
  return dateToDb(value).getUTCDay();
}

export function isWeekend(value: string): boolean {
  const wd = weekdayOf(value);
  return wd === 0 || wd === 6;
}

export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function workingDaysBetween(from: string, to: string): number {
  return eachDate(from, to).filter((d) => !isWeekend(d)).length;
}

/** Monday of the ISO week containing `value`. */
export function startOfWeek(value: string): string {
  const wd = weekdayOf(value);
  return addDays(value, wd === 0 ? -6 : 1 - wd);
}

export function startOfMonth(value: string): string {
  return `${value.slice(0, 7)}-01`;
}

export function endOfMonth(value: string): string {
  const [y, m] = value.split('-').map(Number) as [number, number];
  return dbToDate(new Date(Date.UTC(y, m, 0)));
}

const HUMAN = new Intl.DateTimeFormat('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
/** "Wed, 21 Oct 2026" */
export function formatHuman(value: string): string {
  return HUMAN.format(dateToDb(value)).replace(/^(\w+) /, '$1, ');
}
