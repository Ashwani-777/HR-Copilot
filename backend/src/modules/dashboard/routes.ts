import { Router } from 'express';
import { prisma } from '../../db.js';
import { authenticate, getAuth } from '../../middleware/auth.js';
import { notFound } from '../../lib/errors.js';
import { toAttendanceDto } from '../../lib/dto.js';
import { dateToDb, todayIn } from '../../lib/time.js';
import { balancesForCurrentYear } from '../leaves/service.js';

export const dashboardRouter = Router();
dashboardRouter.use(authenticate);

dashboardRouter.get('/', async (req, res) => {
  const auth = getAuth(req);
  const company = await prisma.company.findUnique({ where: { id: auth.companyId } });
  if (!company) throw notFound('Company not found');
  const today = todayIn(company.timezone);
  const todayDb = dateToDb(today);

  const record = auth.employeeId
    ? await prisma.attendance.findFirst({
        where: { companyId: auth.companyId, employeeId: auth.employeeId, date: todayDb },
        include: { employee: { select: { name: true } } },
      })
    : null;

  const leaveBalances = auth.employeeId ? await balancesForCurrentYear(auth.companyId, auth.employeeId) : [];

  let stats = null;
  if (auth.role === 'ADMIN') {
    const [totalEmployees, presentToday, lateToday, onLeaveToday, pendingLeaves] = await Promise.all([
      prisma.employee.count({ where: { companyId: auth.companyId } }),
      prisma.attendance.count({ where: { companyId: auth.companyId, date: todayDb } }),
      prisma.attendance.count({ where: { companyId: auth.companyId, date: todayDb, status: 'LATE' } }),
      prisma.leaveRequest.count({
        where: { companyId: auth.companyId, status: 'APPROVED', fromDate: { lte: todayDb }, toDate: { gte: todayDb } },
      }),
      prisma.leaveRequest.count({ where: { companyId: auth.companyId, status: 'PENDING' } }),
    ]);
    stats = { totalEmployees, presentToday, lateToday, onLeaveToday, pendingLeaves };
  }

  res.json({ today: { date: today, record: record ? toAttendanceDto(record) : null }, leaveBalances, stats });
});
