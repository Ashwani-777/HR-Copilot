import type { LeaveType } from '../types';

export const DEFAULT_TZ = 'Asia/Kolkata';

/** `YYYY-MM-DD` for "now" in the company's timezone. */
export function todayInTz(timeZone = DEFAULT_TZ, now = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

/** Add days to a `YYYY-MM-DD` string (calendar arithmetic in UTC, no TZ drift). */
export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
}

/** "Wed, 21 Oct" */
export function formatDate(date: string, opts: { year?: boolean; weekday?: boolean } = {}): string {
  const { year = false, weekday = true } = opts;
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: weekday ? 'short' : undefined,
    day: 'numeric',
    month: 'short',
    year: year ? 'numeric' : undefined,
  }).format(parseDate(date));
}

/** "21–23 Oct", "30 Oct – 2 Nov", "21 Oct" */
export function formatDateRange(from: string, to: string): string {
  if (from === to) return formatDate(from, { weekday: false });
  const a = parseDate(from);
  const b = parseDate(to);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  if (sameMonth) {
    const month = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', month: 'short' }).format(b);
    return `${a.getUTCDate()}–${b.getUTCDate()} ${month}`;
  }
  return `${formatDate(from, { weekday: false })} – ${formatDate(to, { weekday: false })}`;
}

/** "Wednesday, 21 October" for the hero subtitle. */
export function formatLongToday(timeZone = DEFAULT_TZ, now = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone, weekday: 'long', day: 'numeric', month: 'long' }).format(now);
}

/** "09:12" in the company timezone. */
export function formatTime(iso: string | null | undefined, timeZone = DEFAULT_TZ): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
}

/** "21 Oct, 14:05" */
export function formatDateTime(iso: string, timeZone = DEFAULT_TZ): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(d);
}

export function greeting(timeZone = DEFAULT_TZ, now = new Date()): string {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now),
  );
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

export const firstName = (name: string) => name.trim().split(/\s+/)[0] ?? name;

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
}

/** 1234 → "1.2 km", 350 → "350 m" */
export function formatDistance(meters: number): string {
  if (meters >= 1000) return `${(meters / 1000).toFixed(meters >= 10_000 ? 0 : 1)} km`;
  return `${Math.round(meters)} m`;
}

/** Duration between two ISO timestamps, "8h 12m". */
export function formatDuration(fromIso: string, toIso: string): string {
  const mins = Math.max(0, Math.round((new Date(toIso).getTime() - new Date(fromIso).getTime()) / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const LEAVE_LABEL: Record<LeaveType, string> = {
  CASUAL: 'Casual',
  SICK: 'Sick',
  EARNED: 'Earned',
};

export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
