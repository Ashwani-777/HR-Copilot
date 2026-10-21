import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { authenticate, getAuth, requireRole } from '../../middleware/auth.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { toEmployeeDto } from '../../lib/dto.js';
import { parse } from '../../lib/validation.js';
import { dateToDb, todayIn } from '../../lib/time.js';

export const employeesRouter = Router();
employeesRouter.use(authenticate, requireRole('ADMIN'));

const CreateBody = z.object({
  name: z.string().trim().min(2).max(100),
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')),
  department: z.string().trim().min(1).max(60),
  designation: z.string().trim().min(1).max(80),
  password: z.string().min(8, 'Password must be at least 8 characters').max(200),
});

employeesRouter.get('/', async (req, res) => {
  const auth = getAuth(req);
  const employees = await prisma.employee.findMany({ where: { companyId: auth.companyId }, orderBy: { name: 'asc' } });
  res.json({ employees: employees.map(toEmployeeDto) });
});

/** Creates the Employee record and a linked EMPLOYEE login in one transaction. */
employeesRouter.post('/', async (req, res) => {
  const auth = getAuth(req);
  const body = parse(CreateBody, req.body);

  const existing = await prisma.user.findUnique({ where: { email: body.email }, select: { id: true } });
  if (existing) throw badRequest('Email already in use', { fieldErrors: { email: ['Email already in use'] } });

  const company = await prisma.company.findUnique({ where: { id: auth.companyId } });
  if (!company) throw notFound('Company not found');
  const passwordHash = await bcrypt.hash(body.password, 10);

  const employee = await prisma.$transaction(async (tx) => {
    const emp = await tx.employee.create({
      data: {
        companyId: auth.companyId,
        name: body.name,
        email: body.email,
        department: body.department,
        designation: body.designation,
        joinedAt: dateToDb(todayIn(company.timezone)),
      },
    });
    await tx.user.create({
      data: { companyId: auth.companyId, email: body.email, name: body.name, role: 'EMPLOYEE', passwordHash, employeeId: emp.id },
    });
    return emp;
  });
  res.status(201).json(toEmployeeDto(employee));
});
