/**
 * Copilot tools: typed functions over Prisma. The model chooses a tool and fills its arguments; it
 * never writes SQL. Every query is scoped by ctx.companyId, and EMPLOYEE callers only ever get their
 * own rows — enforced here, not in the prompt, so a jailbroken model still can't read other data.
 */
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import type { Role } from '../../middleware/auth.js';
import type { ToolDefinition } from '../../ai/types.js';
import { hybridSearch } from '../../rag/search.js';
import { computeBalances } from '../leaves/service.js';
import {
  DATE_RE,
  dateToDb,
  dbToDate,
  eachDate,
  isValidDateStr,
  isWeekend,
  localTimeHHMM,
  parseHHMM,
  zonedParts,
} from '../../lib/time.js';
import type { CitationRegistry } from './citations.js';

export interface ToolContext {
  companyId: string;
  userId: string;
  role: Role;
  employeeId: string | null;
  timezone: string;
  shiftStart: string;
  today: string;
  citations: CitationRegistry;
}

/** A failure the model should see and explain (bad range, unknown employee, not allowed…). */
export class ToolError extends Error {}

export interface ToolOutput {
  ok: boolean;
  data: unknown;
}

export interface RegisteredTool extends ToolDefinition {
  label: string;
  execute(ctx: ToolContext, rawArgs: unknown): Promise<ToolOutput>;
}

function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  const json = z.toJSONSchema(schema) as Record<string, unknown>;
  delete json.$schema;
  return json;
}

function defineTool<S extends z.ZodType>(spec: {
  name: string;
  label: string;
  description: string;
  schema: S;
  run: (ctx: ToolContext, args: z.infer<S>) => Promise<unknown>;
}): RegisteredTool {
  return {
    name: spec.name,
    label: spec.label,
    description: spec.description,
    inputSchema: jsonSchemaFor(spec.schema),
    async execute(ctx, rawArgs) {
      // Model output is untrusted: validate before touching the database.
      const parsed = spec.schema.safeParse(rawArgs ?? {});
      if (!parsed.success) {
        return { ok: false, data: { error: 'Invalid arguments', issues: parsed.error.issues.map((i) => `${i.path.join('.') || 'args'}: ${i.message}`) } };
      }
      try {
        return { ok: true, data: await spec.run(ctx, parsed.data) };
      } catch (err) {
        if (err instanceof ToolError) return { ok: false, data: { error: err.message } };
        throw err;
      }
    },
  };
}

const date = z
  .string()
  .regex(DATE_RE, 'Use YYYY-MM-DD')
  .refine(isValidDateStr, 'Invalid calendar date')
  .describe('Calendar date, YYYY-MM-DD');

const MAX_RANGE_DAYS = 366;

/** Validate a range and clamp `to` to today (there is no attendance in the future). */
function clampRange(ctx: ToolContext, from: string, to: string) {
  if (from > to) throw new ToolError(`'from' (${from}) is after 'to' (${to}).`);
  const clampedTo = to > ctx.today ? ctx.today : to;
  if (from > clampedTo) throw new ToolError(`The range ${from}..${to} is entirely in the future; today is ${ctx.today}.`);
  if (eachDate(from, clampedTo).length > MAX_RANGE_DAYS) throw new ToolError(`Ranges are limited to ${MAX_RANGE_DAYS} days.`);
  return { from, to: clampedTo };
}

function ownEmployeeId(ctx: ToolContext): string {
  if (!ctx.employeeId) throw new ToolError("This account isn't linked to an employee record, so there is no personal HR data for it.");
  return ctx.employeeId;
}

const SELF_ONLY_NOTE = 'Employees can only see their own HR data; results are limited to the current user.';

async function matchEmployees(ctx: ToolContext, name: string) {
  const q = name.trim();
  const matches = await prisma.employee.findMany({
    where: { companyId: ctx.companyId, name: { contains: q, mode: 'insensitive' } },
    orderBy: { name: 'asc' },
    take: 10,
  });
  if (matches.length <= 1) return matches;
  const lower = q.toLowerCase();
  const exact = matches.filter((m) => m.name.toLowerCase() === lower || m.name.toLowerCase().split(/\s+/).includes(lower));
  return exact.length === 1 ? exact : matches;
}

function minutesAfterShift(ctx: ToolContext, checkInAt: Date): number {
  const p = zonedParts(checkInAt, ctx.timezone);
  return Math.max(0, p.hour * 60 + p.minute - parseHHMM(ctx.shiftStart));
}

// ---------------------------------------------------------------------------

export const searchPolicy = defineTool({
  name: 'searchPolicy',
  label: 'Searching HR policies…',
  description:
    "Search the company's HR documents (leave rules and entitlements, attendance and late-arrival policy, work from home, " +
    'reimbursement, holidays, code of conduct). Returns numbered passages; cite them in the answer as [n]. ' +
    'Use for any question about rules, entitlements or procedures.',
  schema: z.object({ query: z.string().trim().min(2).max(300).describe('What to look for, in natural language') }),
  async run(ctx, { query }) {
    const results = await hybridSearch(ctx.companyId, query, 5);
    if (results.length === 0) return { results: [], note: 'No relevant passages found in the company documents.' };
    return {
      results: results.map((r) => ({
        citation: ctx.citations.register(r),
        documentTitle: r.documentTitle,
        page: r.page,
        text: r.content,
      })),
    };
  },
});

export const getAttendanceSummary = defineTool({
  name: 'getAttendanceSummary',
  label: 'Summarising attendance…',
  description:
    'Attendance statistics for a date range: per employee, days present, on time, late, on approved leave and absent ' +
    '(working days Mon–Fri). Optional filters: department, employeeName (partial match). Employees only get their own data.',
  schema: z.object({
    from: date,
    to: date,
    department: z.string().trim().min(1).max(60).optional().describe('Department name, e.g. "Engineering"'),
    employeeName: z.string().trim().min(1).max(100).optional().describe('Full or partial employee name'),
  }),
  async run(ctx, args) {
    const { from, to } = clampRange(ctx, args.from, args.to);
    const notes: string[] = [];
    const where: Prisma.EmployeeWhereInput = { companyId: ctx.companyId };
    if (ctx.role === 'EMPLOYEE') {
      where.id = ownEmployeeId(ctx);
      if (args.department || args.employeeName) notes.push(SELF_ONLY_NOTE);
    } else {
      if (args.department) where.department = { equals: args.department, mode: 'insensitive' };
      if (args.employeeName) where.name = { contains: args.employeeName, mode: 'insensitive' };
    }
    const employees = await prisma.employee.findMany({ where, orderBy: { name: 'asc' }, take: 200 });
    if (employees.length === 0) return { from, to, employees: [], note: 'No employees matched those filters.' };

    const ids = employees.map((e) => e.id);
    const [records, leaves] = await Promise.all([
      prisma.attendance.findMany({
        where: { companyId: ctx.companyId, employeeId: { in: ids }, date: { gte: dateToDb(from), lte: dateToDb(to) } },
        select: { employeeId: true, date: true, status: true, checkInAt: true },
      }),
      prisma.leaveRequest.findMany({
        where: { companyId: ctx.companyId, employeeId: { in: ids }, status: 'APPROVED', fromDate: { lte: dateToDb(to) }, toDate: { gte: dateToDb(from) } },
        select: { employeeId: true, fromDate: true, toDate: true },
      }),
    ]);

    const workingDays = eachDate(from, to).filter((d) => !isWeekend(d));
    const rows = employees.map((e) => {
      const mine = records.filter((r) => r.employeeId === e.id);
      const present = new Set(mine.map((r) => dbToDate(r.date)));
      const leaveDays = new Set<string>();
      for (const l of leaves.filter((x) => x.employeeId === e.id)) {
        for (const d of eachDate(dbToDate(l.fromDate), dbToDate(l.toDate))) if (workingDays.includes(d)) leaveDays.add(d);
      }
      const joined = dbToDate(e.joinedAt);
      // Today isn't "absent" yet — they may still check in.
      const absent = workingDays.filter((d) => d >= joined && d < ctx.today && !present.has(d) && !leaveDays.has(d)).length;
      const late = mine.filter((r) => r.status === 'LATE').length;
      const avgMinutes = mine.length
        ? Math.round(mine.reduce((s, r) => s + zonedParts(r.checkInAt, ctx.timezone).hour * 60 + zonedParts(r.checkInAt, ctx.timezone).minute, 0) / mine.length)
        : null;
      return {
        name: e.name,
        department: e.department,
        present: present.size,
        onTime: mine.length - late,
        late,
        onLeave: leaveDays.size,
        absent,
        averageCheckIn: avgMinutes === null ? null : `${String(Math.floor(avgMinutes / 60)).padStart(2, '0')}:${String(avgMinutes % 60).padStart(2, '0')}`,
      };
    });

    const totals = rows.reduce(
      (t, r) => ({ present: t.present + r.present, onTime: t.onTime + r.onTime, late: t.late + r.late, onLeave: t.onLeave + r.onLeave, absent: t.absent + r.absent }),
      { present: 0, onTime: 0, late: 0, onLeave: 0, absent: 0 },
    );
    rows.sort((a, b) => b.late - a.late || a.name.localeCompare(b.name));
    return {
      from,
      to,
      workingDays: workingDays.length,
      shiftStart: ctx.shiftStart,
      totals: { ...totals, onTimeRatePct: totals.present ? Math.round((100 * totals.onTime) / totals.present) : null },
      employees: rows.slice(0, 50),
      ...(rows.length > 50 ? { truncated: `Showing 50 of ${rows.length} employees` } : {}),
      ...(notes.length ? { note: notes.join(' ') } : {}),
    };
  },
});

export const getLateArrivals = defineTool({
  name: 'getLateArrivals',
  label: 'Checking late arrivals…',
  description:
    'Employees who checked in after the shift start during a date range, with how many times and when. ' +
    'Use minCount to find repeat late-comers. Employees only get their own late arrivals.',
  schema: z.object({
    from: date,
    to: date,
    minCount: z.number().int().min(1).max(100).optional().describe('Only include people late at least this many times'),
  }),
  async run(ctx, args) {
    const { from, to } = clampRange(ctx, args.from, args.to);
    const minCount = args.minCount ?? 1;
    const where: Prisma.AttendanceWhereInput = {
      companyId: ctx.companyId,
      status: 'LATE',
      date: { gte: dateToDb(from), lte: dateToDb(to) },
    };
    if (ctx.role === 'EMPLOYEE') where.employeeId = ownEmployeeId(ctx);
    const records = await prisma.attendance.findMany({
      where,
      include: { employee: { select: { name: true, department: true } } },
      orderBy: [{ date: 'asc' }, { checkInAt: 'asc' }],
      take: 5000,
    });

    const byEmployee = new Map<string, { name: string; department: string; arrivals: { date: string; checkIn: string; minutesLate: number }[] }>();
    for (const r of records) {
      const entry = byEmployee.get(r.employeeId) ?? { name: r.employee.name, department: r.employee.department, arrivals: [] };
      entry.arrivals.push({ date: dbToDate(r.date), checkIn: localTimeHHMM(r.checkInAt, ctx.timezone), minutesLate: minutesAfterShift(ctx, r.checkInAt) });
      byEmployee.set(r.employeeId, entry);
    }
    const employees = [...byEmployee.values()]
      .map((e) => ({ name: e.name, department: e.department, lateCount: e.arrivals.length, arrivals: e.arrivals.slice(-10) }))
      .filter((e) => e.lateCount >= minCount)
      .sort((a, b) => b.lateCount - a.lateCount || a.name.localeCompare(b.name));
    return {
      from,
      to,
      shiftStart: ctx.shiftStart,
      minCount,
      totalLateArrivals: employees.reduce((s, e) => s + e.lateCount, 0),
      employees,
      ...(ctx.role === 'EMPLOYEE' ? { scope: 'self' } : {}),
    };
  },
});

export const getLeaveBalance = defineTool({
  name: 'getLeaveBalance',
  label: 'Checking leave balances…',
  description:
    "Leave balance for the current year (allowed / used / remaining for CASUAL, SICK and EARNED leave). Omit employeeName for the current user's own balance. " +
    "Admins may pass an employee's name; employees can only see their own.",
  schema: z.object({ employeeName: z.string().trim().min(1).max(100).optional().describe('Full or partial employee name (admins only)') }),
  async run(ctx, { employeeName }) {
    const year = Number(ctx.today.slice(0, 4));
    let employee: { id: string; name: string } | null = null;
    let note: string | undefined;

    if (ctx.role === 'EMPLOYEE' || !employeeName) {
      const id = ownEmployeeId(ctx);
      employee = await prisma.employee.findFirst({ where: { id, companyId: ctx.companyId }, select: { id: true, name: true } });
      if (ctx.role === 'EMPLOYEE' && employeeName && employee && !employee.name.toLowerCase().includes(employeeName.toLowerCase())) note = SELF_ONLY_NOTE;
    } else {
      const matches = await matchEmployees(ctx, employeeName);
      if (matches.length === 0) throw new ToolError(`No employee named "${employeeName}" in this company.`);
      if (matches.length > 1) return { ambiguous: true, matches: matches.map((m) => m.name), note: 'Several employees match; ask which one.' };
      employee = { id: matches[0]!.id, name: matches[0]!.name };
    }
    if (!employee) throw new ToolError('Employee record not found.');
    const balances = await computeBalances(ctx.companyId, employee.id, year);
    const pending = await prisma.leaveRequest.findMany({
      where: { companyId: ctx.companyId, employeeId: employee.id, status: 'PENDING' },
      select: { type: true, fromDate: true, toDate: true, days: true },
    });
    return {
      employee: employee.name,
      year,
      balances,
      pendingRequests: pending.map((p) => ({ type: p.type, from: dbToDate(p.fromDate), to: dbToDate(p.toDate), days: p.days })),
      ...(note ? { note } : {}),
    };
  },
});

export const getWhoIsOnLeave = defineTool({
  name: 'getWhoIsOnLeave',
  label: 'Checking who is on leave…',
  description: 'Who is on approved leave on a given date. Employees only see whether they themselves are on leave.',
  schema: z.object({ date }),
  async run(ctx, args) {
    const day = dateToDb(args.date);
    const where: Prisma.LeaveRequestWhereInput = { companyId: ctx.companyId, status: 'APPROVED', fromDate: { lte: day }, toDate: { gte: day } };
    if (ctx.role === 'EMPLOYEE') where.employeeId = ownEmployeeId(ctx);
    const leaves = await prisma.leaveRequest.findMany({
      where,
      include: { employee: { select: { name: true, department: true } } },
      orderBy: { employee: { name: 'asc' } },
    });
    return {
      date: args.date,
      isWeekend: isWeekend(args.date),
      onLeave: leaves.map((l) => ({ name: l.employee.name, department: l.employee.department, type: l.type, from: dbToDate(l.fromDate), to: dbToDate(l.toDate) })),
      ...(ctx.role === 'EMPLOYEE' ? { scope: 'self', note: SELF_ONLY_NOTE } : {}),
    };
  },
});

export const TOOLS: RegisteredTool[] = [searchPolicy, getAttendanceSummary, getLateArrivals, getLeaveBalance, getWhoIsOnLeave];

export function toolDefinitions(): ToolDefinition[] {
  return TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

export function findTool(name: string): RegisteredTool | undefined {
  return TOOLS.find((t) => t.name === name);
}
