import { describe, expect, it } from 'vitest';
import { parseRange, planToolCalls } from '../../src/ai/mock-chat.js';

const TODAY = '2026-10-21'; // Wednesday

describe('mock model routing (keyword → tool)', () => {
  it.each([
    ['How many casual leaves do I get?', 'searchPolicy'],
    ["What's the work-from-home policy?", 'searchPolicy'],
    ['What happens if I am late three times?', 'searchPolicy'],
    ['Who was late this week?', 'getLateArrivals'],
    ['Who is on leave today?', 'getWhoIsOnLeave'],
    ['How many casual leaves do I have left?', 'getLeaveBalance'],
    ['Show attendance for the engineering team this month', 'getAttendanceSummary'],
  ])('%s → %s', (question, tool) => {
    expect(planToolCalls(question, TODAY)[0]!.name).toBe(tool);
  });

  it('resolves relative ranges from the system-prompt date', () => {
    expect(parseRange('who was late this week', TODAY)).toEqual({ from: '2026-10-19', to: TODAY });
    expect(parseRange('late last week', TODAY)).toEqual({ from: '2026-10-12', to: '2026-10-16' });
    expect(parseRange('attendance this month', TODAY)).toEqual({ from: '2026-10-01', to: TODAY });
    expect(parseRange('attendance last month', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('passes names and repeat-offender thresholds as tool arguments', () => {
    expect(planToolCalls("What is Rahul Verma's leave balance?", TODAY)[0]).toEqual({ name: 'getLeaveBalance', args: { employeeName: 'Rahul Verma' } });
    expect(planToolCalls('Who was late more than 3 times this month?', TODAY)[0]!.args).toMatchObject({ minCount: 4 });
  });
});
