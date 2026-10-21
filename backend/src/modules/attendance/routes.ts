import { Router } from 'express';
import { z } from 'zod';
import { authenticate, getAuth, getEmployeeAuth, requireEmployee, requireRole } from '../../middleware/auth.js';
import { dateStr, parse } from '../../lib/validation.js';
import { checkIn, checkOut, exportAttendanceCsv, listAttendance } from './service.js';

export const attendanceRouter = Router();
attendanceRouter.use(authenticate);

const CheckInBody = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
});

const ListQuery = z.object({
  from: dateStr.optional(),
  to: dateStr.optional(),
  employeeId: z.string().min(1).optional(),
});

attendanceRouter.post('/check-in', requireEmployee, async (req, res) => {
  const body = parse(CheckInBody, req.body);
  const record = await checkIn(getEmployeeAuth(req), body);
  res.status(201).json(record);
});

attendanceRouter.post('/check-out', requireEmployee, async (req, res) => {
  const record = await checkOut(getEmployeeAuth(req));
  res.json(record);
});

attendanceRouter.get('/export.csv', requireRole('ADMIN'), async (req, res) => {
  const q = parse(ListQuery.omit({ employeeId: true }), req.query);
  const { filename, csv } = await exportAttendanceCsv(getAuth(req), q);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.send(csv);
});

attendanceRouter.get('/', async (req, res) => {
  const q = parse(ListQuery, req.query);
  const records = await listAttendance(getAuth(req), q);
  res.json({ records });
});
