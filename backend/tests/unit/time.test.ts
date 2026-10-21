import { describe, expect, it } from 'vitest';
import { isLate, startOfWeek, todayIn, workingDaysBetween, zonedToUtc } from '../../src/lib/time.js';

const TZ = 'Asia/Kolkata';

describe('late calculation (company timezone)', () => {
  const at = (hhmmss: string) => zonedToUtc('2026-10-21', hhmmss, TZ);

  it('converts IST wall-clock time to UTC (+05:30)', () => {
    expect(at('09:30').toISOString()).toBe('2026-10-21T04:00:00.000Z');
  });

  it('is on time at or before the shift start', () => {
    expect(isLate(at('08:55:00'), '09:30', TZ)).toBe(false);
    expect(isLate(at('09:29:59'), '09:30', TZ)).toBe(false);
    expect(isLate(at('09:30:00'), '09:30', TZ)).toBe(false);
  });

  it('is late after the shift start', () => {
    expect(isLate(at('09:30:01'), '09:30', TZ)).toBe(true);
    expect(isLate(at('10:15:00'), '09:30', TZ)).toBe(true);
  });

  it('judges lateness in the company timezone, not UTC or server time', () => {
    // 04:15 UTC = 09:45 IST → late in Kolkata, though "04:15" looks early.
    expect(isLate(new Date('2026-10-21T04:15:00Z'), '09:30', TZ)).toBe(true);
    // Same instant is 00:15 in New York → on time for a 09:30 New York shift.
    expect(isLate(new Date('2026-10-21T04:15:00Z'), '09:30', 'America/New_York')).toBe(false);
  });

  it('handles DST zones', () => {
    expect(zonedToUtc('2026-03-06', '09:00', 'America/New_York').toISOString()).toBe('2026-03-06T14:00:00.000Z'); // EST
    expect(zonedToUtc('2026-03-09', '09:00', 'America/New_York').toISOString()).toBe('2026-03-09T13:00:00.000Z'); // EDT
  });
});

describe('calendar helpers', () => {
  it("uses the company's local date for 'today'", () => {
    expect(todayIn(TZ, new Date('2026-10-21T19:00:00Z'))).toBe('2026-10-22'); // 00:30 IST next day
    expect(todayIn(TZ, new Date('2026-10-21T18:00:00Z'))).toBe('2026-10-21'); // 23:30 IST
  });

  it('counts working days (Mon–Fri) and finds the Monday of the week', () => {
    expect(workingDaysBetween('2026-10-19', '2026-10-25')).toBe(5);
    expect(workingDaysBetween('2026-10-24', '2026-10-25')).toBe(0);
    expect(startOfWeek('2026-10-21')).toBe('2026-10-19');
    expect(startOfWeek('2026-10-25')).toBe('2026-10-19'); // Sunday belongs to the week starting Monday 19th
  });
});
