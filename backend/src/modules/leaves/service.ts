import type { LeaveType, Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import type { AuthContext } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { dateToDb, todayIn, workingDaysBetween } from '../../lib/time.js';
import { toLeaveDto, type LeaveRequestDto } from '../../lib/dto.js';

/** Annual allowances (days per calendar year), per the brief. */
export const LEAVE_ALLOWANCES: Record<LeaveType, number> = { CASUAL: 12, SICK: 8, EARNED: 15 };
export const LEAVE_TYPES: LeaveType[] = ['CASUAL', 'SICK', 'EARNED'];

export interface LeaveBalanceDto {
  type: LeaveType;
  allowed: number;
  used: number;
  remaining: number;
}

function yearBounds(year: number) {
  return { gte: dateToDb(`${year}-01-01`), lte: dateToDb(`${year}-12-31`) };
}

/** `used` = APPROVED working days whose leave starts in `year`; remaining = allowed − used. */
export async function computeBalances(companyId: string, employeeId: string, year: number): Promise<LeaveBalanceDto[]> {
  const grouped = await prisma.leaveRequest.groupBy({
    by: ['type'],
    where: { companyId, employeeId, status: 'APPROVED', fromDate: yearBounds(year) },
    _sum: { days: true },
  });
  return LEAVE_TYPES.map((type) => {
    const used = grouped.find((g) => g.type === type)?._sum.days ?? 0;
    const allowed = LEAVE_ALLOWANCES[type];
    return { type, allowed, used, remaining: Math.max(0, allowed - used) };
  });
}

async function pendingDays(companyId: string, employeeId: string, type: LeaveType, year: number, excludeId?: string) {
  const agg = await prisma.leaveRequest.aggregate({
    where: { companyId, employeeId, type, status: 'PENDING', fromDate: yearBounds(year), ...(excludeId ? { id: { not: excludeId } } : {}) },
    _sum: { days: true },
  });
  return agg._sum.days ?? 0;
}

async function companyToday(companyId: string): Promise<string> {
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { timezone: true } });
  if (!company) throw notFound('Company not found');
  return todayIn(company.timezone);
}

export async function balancesForCurrentYear(companyId: string, employeeId: string): Promise<LeaveBalanceDto[]> {
  const today = await companyToday(companyId);
  return computeBalances(companyId, employeeId, Number(today.slice(0, 4)));
}

export async function listLeaves(auth: AuthContext, status?: 'PENDING' | 'APPROVED' | 'REJECTED'): Promise<LeaveRequestDto[]> {
  const where: Prisma.LeaveRequestWhereInput = { companyId: auth.companyId, ...(status ? { status } : {}) };
  if (auth.role === 'EMPLOYEE') where.employeeId = auth.employeeId ?? '__none__';
  const rows = await prisma.leaveRequest.findMany({
    where,
    include: { employee: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 1000,
  });
  return rows.map(toLeaveDto);
}

export interface LeaveInput {
  type: LeaveType;
  from: string;
  to: string;
  reason: string;
}

export async function requestLeave(auth: AuthContext & { employeeId: string }, input: LeaveInput): Promise<LeaveRequestDto> {
  if (input.from > input.to) throw badRequest('`from` must be on or before `to`', { from: input.from, to: input.to });
  if (input.from.slice(0, 4) !== input.to.slice(0, 4)) {
    throw badRequest('A leave request must fall within one calendar year — split it into two requests');
  }
  const days = workingDaysBetween(input.from, input.to);
  if (days === 0) throw badRequest('The selected dates are all weekends — no working days to take off');
  if (days > 30) throw badRequest('A single request can cover at most 30 working days');

  const overlapping = await prisma.leaveRequest.findFirst({
    where: {
      companyId: auth.companyId,
      employeeId: auth.employeeId,
      status: { in: ['PENDING', 'APPROVED'] },
      fromDate: { lte: dateToDb(input.to) },
      toDate: { gte: dateToDb(input.from) },
    },
  });
  if (overlapping) throw badRequest('These dates overlap an existing pending or approved leave request', { leaveId: overlapping.id });

  const year = Number(input.from.slice(0, 4));
  const balance = (await computeBalances(auth.companyId, auth.employeeId, year)).find((b) => b.type === input.type)!;
  const pending = await pendingDays(auth.companyId, auth.employeeId, input.type, year);
  const available = balance.remaining - pending;
  if (days > available) {
    throw badRequest(`Not enough ${input.type.toLowerCase()} leave: ${days} day(s) requested, ${available} available`, {
      type: input.type,
      requested: days,
      remaining: balance.remaining,
      pending,
      available,
    });
  }

  const row = await prisma.leaveRequest.create({
    data: {
      companyId: auth.companyId,
      employeeId: auth.employeeId,
      type: input.type,
      fromDate: dateToDb(input.from),
      toDate: dateToDb(input.to),
      days,
      reason: input.reason,
    },
    include: { employee: { select: { name: true } } },
  });
  return toLeaveDto(row);
}

export async function decideLeave(auth: AuthContext, id: string, status: 'APPROVED' | 'REJECTED'): Promise<LeaveRequestDto> {
  // Scoped lookup: another company's leave id is simply "not found".
  const leave = await prisma.leaveRequest.findFirst({ where: { id, companyId: auth.companyId } });
  if (!leave) throw notFound('Leave request not found');
  if (leave.status !== 'PENDING') throw badRequest(`This request was already ${leave.status.toLowerCase()}`, { status: leave.status });

  if (status === 'APPROVED') {
    const year = leave.fromDate.getUTCFullYear();
    const balance = (await computeBalances(auth.companyId, leave.employeeId, year)).find((b) => b.type === leave.type)!;
    if (leave.days > balance.remaining) {
      throw badRequest(`Cannot approve: only ${balance.remaining} ${leave.type.toLowerCase()} day(s) remaining`, {
        requested: leave.days,
        remaining: balance.remaining,
      });
    }
  }

  const updated = await prisma.leaveRequest.update({
    where: { id: leave.id },
    data: { status, decidedAt: new Date(), decidedById: auth.userId },
    include: { employee: { select: { name: true } } },
  });
  return toLeaveDto(updated);
}
