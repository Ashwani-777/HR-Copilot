import { Router } from 'express';
import { z } from 'zod';
import { authenticate, getAuth, getEmployeeAuth, requireEmployee, requireRole } from '../../middleware/auth.js';
import { dateStr, parse } from '../../lib/validation.js';
import { balancesForCurrentYear, decideLeave, listLeaves, requestLeave } from './service.js';

export const leavesRouter = Router();
leavesRouter.use(authenticate);

const StatusEnum = z.enum(['PENDING', 'APPROVED', 'REJECTED']);

const CreateBody = z.object({
  type: z.enum(['CASUAL', 'SICK', 'EARNED']),
  from: dateStr,
  to: dateStr,
  reason: z.string().trim().min(3, 'Please give a short reason').max(500),
});

const DecideBody = z.object({ status: z.enum(['APPROVED', 'REJECTED']) });

leavesRouter.get('/balance', requireEmployee, async (req, res) => {
  const auth = getEmployeeAuth(req);
  res.json({ balances: await balancesForCurrentYear(auth.companyId, auth.employeeId) });
});

leavesRouter.get('/', async (req, res) => {
  const { status } = parse(z.object({ status: StatusEnum.optional() }), req.query);
  res.json({ leaves: await listLeaves(getAuth(req), status) });
});

leavesRouter.post('/', requireEmployee, async (req, res) => {
  const body = parse(CreateBody, req.body);
  res.status(201).json(await requestLeave(getEmployeeAuth(req), body));
});

leavesRouter.patch('/:id', requireRole('ADMIN'), async (req, res) => {
  const { status } = parse(DecideBody, req.body);
  res.json(await decideLeave(getAuth(req), String(req.params.id), status));
});
