import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../../db.js';
import { isTest } from '../../config.js';
import { toCompanyDto, toUserDto } from '../../lib/dto.js';
import { unauthorized } from '../../lib/errors.js';
import { parse } from '../../lib/validation.js';
import { authenticate, getAuth, signToken } from '../../middleware/auth.js';

export const authRouter = Router();

const LoginBody = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email('Enter a valid email')),
  password: z.string().min(1, 'Password is required').max(200),
});

// Brute-force protection on the only unauthenticated write endpoint.
const loginLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  skip: () => isTest,
  handler: (_req, res) => {
    res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many login attempts. Try again in a minute.', details: {} } });
  },
});

// Compare unknown emails against a real hash so they cost the same time as wrong passwords.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', 10);

authRouter.post('/login', loginLimiter, async (req, res) => {
  const { email, password } = parse(LoginBody, req.body);
  const user = await prisma.user.findUnique({ where: { email }, include: { company: true } });
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) throw unauthorized('Invalid email or password');

  const token = signToken({ userId: user.id, companyId: user.companyId, role: user.role, employeeId: user.employeeId });
  res.json({ token, user: toUserDto(user), company: toCompanyDto(user.company) });
});

authRouter.get('/me', authenticate, async (req, res) => {
  const auth = getAuth(req);
  const user = await prisma.user.findFirst({ where: { id: auth.userId, companyId: auth.companyId }, include: { company: true } });
  if (!user) throw unauthorized('Account no longer exists');
  res.json({ user: toUserDto(user), company: toCompanyDto(user.company) });
});
