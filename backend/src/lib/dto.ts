/**
 * Map DB rows → the exact response shapes in docs/API_CONTRACT.md.
 * Keeping this in one place is what keeps the frontend contract stable.
 */
import type { Attendance, Company, Document, Employee, LeaveRequest, User } from '@prisma/client';
import { dbToDate } from './time.js';

export interface UserDto {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'EMPLOYEE';
  companyId: string;
  employeeId: string | null;
}
export const toUserDto = (u: User): UserDto => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  companyId: u.companyId,
  employeeId: u.employeeId,
});

export interface CompanyDto {
  id: string;
  name: string;
  officeLat: number;
  officeLng: number;
  geofenceRadiusM: number;
  shiftStart: string;
  timezone: string;
}
export const toCompanyDto = (c: Company): CompanyDto => ({
  id: c.id,
  name: c.name,
  officeLat: c.officeLat,
  officeLng: c.officeLng,
  geofenceRadiusM: c.geofenceRadiusM,
  shiftStart: c.shiftStart,
  timezone: c.timezone,
});

export interface EmployeeDto {
  id: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  joinedAt: string;
}
export const toEmployeeDto = (e: Employee): EmployeeDto => ({
  id: e.id,
  name: e.name,
  email: e.email,
  department: e.department,
  designation: e.designation,
  joinedAt: dbToDate(e.joinedAt),
});

export interface AttendanceDto {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  checkInAt: string;
  checkOutAt: string | null;
  distanceM: number;
  status: 'ON_TIME' | 'LATE';
}
export const toAttendanceDto = (a: Attendance & { employee: Pick<Employee, 'name'> }): AttendanceDto => ({
  id: a.id,
  employeeId: a.employeeId,
  employeeName: a.employee.name,
  date: dbToDate(a.date),
  checkInAt: a.checkInAt.toISOString(),
  checkOutAt: a.checkOutAt ? a.checkOutAt.toISOString() : null,
  distanceM: a.distanceM,
  status: a.status,
});

export interface LeaveRequestDto {
  id: string;
  employeeId: string;
  employeeName: string;
  type: 'CASUAL' | 'SICK' | 'EARNED';
  from: string;
  to: string;
  days: number;
  reason: string;
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  createdAt: string;
  decidedAt: string | null;
}
export const toLeaveDto = (l: LeaveRequest & { employee: Pick<Employee, 'name'> }): LeaveRequestDto => ({
  id: l.id,
  employeeId: l.employeeId,
  employeeName: l.employee.name,
  type: l.type,
  from: dbToDate(l.fromDate),
  to: dbToDate(l.toDate),
  days: l.days,
  reason: l.reason,
  status: l.status,
  createdAt: l.createdAt.toISOString(),
  decidedAt: l.decidedAt ? l.decidedAt.toISOString() : null,
});

export interface DocDto {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  status: 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';
  progress: number;
  pages: number | null;
  chunks: number | null;
  error: string | null;
  createdAt: string;
}
export const toDocDto = (d: Document): DocDto => ({
  id: d.id,
  title: d.title,
  filename: d.filename,
  mimeType: d.mimeType,
  status: d.status,
  progress: d.progress,
  pages: d.pages,
  chunks: d.chunkCount,
  error: d.error,
  createdAt: d.createdAt.toISOString(),
});
