import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { config } from '../config.js';
import { forbidden, unauthorized } from '../lib/errors.js';

export type Role = 'ADMIN' | 'EMPLOYEE';

/** Identity carried in the JWT. `companyId` scopes every query the request makes. */
export interface AuthContext {
  userId: string;
  companyId: string;
  role: Role;
  employeeId: string | null;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

const ClaimsSchema = z.object({
  sub: z.string(),
  companyId: z.string(),
  role: z.enum(['ADMIN', 'EMPLOYEE']),
  employeeId: z.string().nullable(),
});

export function signToken(auth: AuthContext): string {
  return jwt.sign({ companyId: auth.companyId, role: auth.role, employeeId: auth.employeeId }, config.JWT_SECRET, {
    subject: auth.userId,
    expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

/** Verify a JWT and return its claims, or null if invalid/expired. Shared by HTTP and Socket.IO. */
export function verifyToken(token: string): AuthContext | null {
  try {
    const decoded = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
    const claims = ClaimsSchema.safeParse(decoded);
    if (!claims.success) return null;
    const { sub, companyId, role, employeeId } = claims.data;
    return { userId: sub, companyId, role, employeeId };
  } catch {
    return null;
  }
}

export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : null;
  if (!token) return next(unauthorized());
  const auth = verifyToken(token);
  if (!auth) return next(unauthorized('Invalid or expired token'));
  req.auth = auth;
  next();
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.auth) return next(unauthorized());
    if (!roles.includes(req.auth.role)) return next(forbidden('This action requires an admin account'));
    next();
  };
}

/** For endpoints marked "any w/ employeeId" in the contract. */
export function requireEmployee(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) return next(unauthorized());
  if (!req.auth.employeeId) return next(forbidden('Your account is not linked to an employee record'));
  next();
}

/** Typed accessor for handlers that sit behind `authenticate`. */
export function getAuth(req: Request): AuthContext {
  if (!req.auth) throw unauthorized();
  return req.auth;
}

/** Typed accessor for handlers that sit behind `requireEmployee`. */
export function getEmployeeAuth(req: Request): AuthContext & { employeeId: string } {
  const auth = getAuth(req);
  if (!auth.employeeId) throw forbidden('Your account is not linked to an employee record');
  return auth as AuthContext & { employeeId: string };
}
