import { StatusDot } from './ui';
import type { AttendanceStatus, LeaveStatus } from '../types';

export function AttendanceStatusDot({ status }: { status: AttendanceStatus }) {
  return status === 'LATE' ? <StatusDot tone="orange">Late</StatusDot> : <StatusDot tone="green">On time</StatusDot>;
}

export function LeaveStatusDot({ status }: { status: LeaveStatus }) {
  if (status === 'APPROVED') return <StatusDot tone="green">Approved</StatusDot>;
  if (status === 'REJECTED') return <StatusDot tone="red">Rejected</StatusDot>;
  return <StatusDot tone="neutral">Pending</StatusDot>;
}
