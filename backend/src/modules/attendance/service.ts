import { Prisma } from '@prisma/client';
import { prisma } from '../../db.js';
import type { AuthContext } from '../../middleware/auth.js';
import { AppError, badRequest, notFound } from '../../lib/errors.js';
import { checkGeofence } from '../../lib/geo.js';
import { addDays, dateToDb, dbToDate, isLate, localTimeHHMM, todayIn } from '../../lib/time.js';
import { toAttendanceDto, type AttendanceDto } from '../../lib/dto.js';

async function getCompany(companyId: string) {
  const company = await prisma.company.findUnique({ where: { id: companyId } });
  if (!company) throw notFound('Company not found');
  return company;
}

export async function checkIn(
  auth: AuthContext & { employeeId: string },
  point: { lat: number; lng: number },
  now: Date = new Date(),
): Promise<AttendanceDto> {
  const company = await getCompany(auth.companyId);
  const fence = checkGeofence(point, { lat: company.officeLat, lng: company.officeLng }, company.geofenceRadiusM);
  if (!fence.inside) {
    throw new AppError(422, 'OUTSIDE_GEOFENCE', `You are ${formatDistance(fence.distanceM)} from the office (limit ${company.geofenceRadiusM} m)`, {
      distanceM: fence.distanceM,
      radiusM: company.geofenceRadiusM,
    });
  }

  const date = todayIn(company.timezone, now);
  try {
    const record = await prisma.attendance.create({
      data: {
        companyId: auth.companyId,
        employeeId: auth.employeeId,
        date: dateToDb(date),
        checkInAt: now,
        checkInLat: point.lat,
        checkInLng: point.lng,
        distanceM: fence.distanceM,
        status: isLate(now, company.shiftStart, company.timezone) ? 'LATE' : 'ON_TIME',
      },
      include: { employee: { select: { name: true } } },
    });
    return toAttendanceDto(record);
  } catch (err) {
    // The (employeeId, date) unique index makes double check-in race-safe.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
      throw new AppError(409, 'ALREADY_CHECKED_IN', 'You have already checked in today');
    }
    throw err;
  }
}

/** Check-out sets (or updates) today's checkOutAt — the last check-out of the day wins. */
export async function checkOut(auth: AuthContext & { employeeId: string }, now: Date = new Date()): Promise<AttendanceDto> {
  const company = await getCompany(auth.companyId);
  const date = todayIn(company.timezone, now);
  const existing = await prisma.attendance.findFirst({
    where: { companyId: auth.companyId, employeeId: auth.employeeId, date: dateToDb(date) },
  });
  if (!existing) throw new AppError(409, 'NOT_CHECKED_IN', 'You have not checked in today');
  const record = await prisma.attendance.update({
    where: { id: existing.id },
    data: { checkOutAt: now },
    include: { employee: { select: { name: true } } },
  });
  return toAttendanceDto(record);
}

export interface RangeQuery {
  from?: string;
  to?: string;
  employeeId?: string;
}

const MAX_RANGE_DAYS = 366;

export async function resolveRange(companyId: string, q: { from?: string; to?: string }) {
  const company = await getCompany(companyId);
  const today = todayIn(company.timezone);
  const to = q.to ?? today;
  const from = q.from ?? addDays(to, -29);
  if (from > to) throw badRequest('`from` must be on or before `to`', { from, to });
  if (dateToDb(to).getTime() - dateToDb(from).getTime() > MAX_RANGE_DAYS * 86_400_000) {
    throw badRequest(`Date range can be at most ${MAX_RANGE_DAYS} days`, { from, to });
  }
  return { company, from, to };
}

/** EMPLOYEE callers only ever see their own rows, whatever `employeeId` they pass. */
function scopedWhere(auth: AuthContext, from: string, to: string, employeeId?: string): Prisma.AttendanceWhereInput {
  const where: Prisma.AttendanceWhereInput = {
    companyId: auth.companyId,
    date: { gte: dateToDb(from), lte: dateToDb(to) },
  };
  if (auth.role === 'EMPLOYEE') where.employeeId = auth.employeeId ?? '__none__';
  else if (employeeId) where.employeeId = employeeId;
  return where;
}

export async function listAttendance(auth: AuthContext, q: RangeQuery): Promise<AttendanceDto[]> {
  const { from, to } = await resolveRange(auth.companyId, q);
  const rows = await prisma.attendance.findMany({
    where: scopedWhere(auth, from, to, q.employeeId),
    include: { employee: { select: { name: true } } },
    orderBy: [{ date: 'desc' }, { checkInAt: 'asc' }],
    take: 5000,
  });
  return rows.map(toAttendanceDto);
}

/** Neutralise spreadsheet formula injection and quote per RFC 4180. */
function csvCell(value: string | number | null): string {
  let s = value === null ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function exportAttendanceCsv(auth: AuthContext, q: RangeQuery): Promise<{ filename: string; csv: string }> {
  const { company, from, to } = await resolveRange(auth.companyId, q);
  const rows = await prisma.attendance.findMany({
    where: scopedWhere(auth, from, to),
    include: { employee: { select: { name: true, email: true, department: true } } },
    orderBy: [{ date: 'asc' }, { employee: { name: 'asc' } }],
  });
  const header = ['Date', 'Employee', 'Email', 'Department', 'Check-in', 'Check-out', 'Distance (m)', 'Status'];
  const lines = [header.join(',')];
  for (const r of rows) {
    lines.push(
      [
        dbToDate(r.date),
        r.employee.name,
        r.employee.email,
        r.employee.department,
        localTimeHHMM(r.checkInAt, company.timezone),
        r.checkOutAt ? localTimeHHMM(r.checkOutAt, company.timezone) : '',
        r.distanceM,
        r.status,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  return { filename: `attendance_${from}_to_${to}.csv`, csv: `${lines.join('\r\n')}\r\n` };
}

function formatDistance(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${m} m`;
}
