import request from 'supertest';
import jwt from 'jsonwebtoken';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db.js';
import { signToken } from '../../src/middleware/auth.js';
import { closeHealthRedis } from '../../src/redis.js';
import { ACME_ADMIN, app, bearer, login, RIYA, type Session } from '../helpers/http.js';

afterAll(closeHealthRedis);

describe('auth', () => {
  it('logs in with seed credentials and returns token, user and company in the contract shape', async () => {
    const res = await request(app).post('/api/auth/login').send(ACME_ADMIN);
    expect(res.status).toBe(200);
    expect(typeof res.body.token).toBe('string');
    expect(res.body.user).toEqual({
      id: expect.any(String),
      name: 'Priya Mehta',
      email: 'admin@acme.test',
      role: 'ADMIN',
      companyId: expect.any(String),
      employeeId: expect.any(String),
    });
    expect(res.body.company).toEqual({
      id: res.body.user.companyId,
      name: 'Acme Staffing Pvt Ltd',
      officeLat: 28.627,
      officeLng: 77.3727,
      geofenceRadiusM: 200,
      shiftStart: '09:30',
      timezone: 'Asia/Kolkata',
    });
  });

  it('accepts emails case-insensitively', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'RIYA@Acme.test', password: RIYA.password });
    expect(res.status).toBe(200);
    expect(res.body.user.role).toBe('EMPLOYEE');
  });

  it.each([
    [{ email: 'admin@acme.test', password: 'wrong' }],
    [{ email: 'nobody@acme.test', password: 'Admin@123' }],
  ])('rejects bad credentials with 401 UNAUTHORIZED (%o)', async (creds) => {
    const res = await request(app).post('/api/auth/login').send(creds);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: { code: 'UNAUTHORIZED', message: 'Invalid email or password', details: {} } });
  });

  it('validates the body', async () => {
    const res = await request(app).post('/api/auth/login').send({ email: 'not-an-email' });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.fieldErrors).toHaveProperty('email');
  });

  it('rejects malformed JSON with VALIDATION_ERROR', async () => {
    const res = await request(app).post('/api/auth/login').set('Content-Type', 'application/json').send('{"email":');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('/me returns the current user and company', async () => {
    const s = await login(RIYA);
    const res = await request(app).get('/api/auth/me').set(bearer(s));
    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('riya@acme.test');
    expect(res.body.company.name).toBe('Acme Staffing Pvt Ltd');
  });

  it('/me requires a valid token', async () => {
    expect((await request(app).get('/api/auth/me')).status).toBe(401);
    expect((await request(app).get('/api/auth/me').set('Authorization', 'Bearer nope')).status).toBe(401);
    const forged = jwt.sign({ companyId: 'x', role: 'ADMIN', employeeId: null }, 'some-other-secret', { subject: 'u' });
    const res = await request(app).get('/api/auth/me').set('Authorization', `Bearer ${forged}`);
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });
});

describe('role guards', () => {
  let admin: Session;
  let riya: Session;
  beforeAll(async () => {
    [admin, riya] = await Promise.all([login(ACME_ADMIN), login(RIYA)]);
  });

  it.each([
    ['get', '/api/employees'],
    ['post', '/api/employees'],
    ['get', '/api/attendance/export.csv'],
    ['patch', '/api/leaves/some-id'],
    ['post', '/api/documents'],
    ['delete', '/api/documents/some-id'],
  ] as const)('EMPLOYEE gets 403 FORBIDDEN on %s %s', async (method, path) => {
    const res = await request(app)[method](path).set(bearer(riya)).send({ status: 'APPROVED' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('ADMIN can reach admin endpoints', async () => {
    expect((await request(app).get('/api/employees').set(bearer(admin))).status).toBe(200);
    expect((await request(app).get('/api/attendance/export.csv').set(bearer(admin))).status).toBe(200);
  });

  it('dashboard: stats only for ADMIN', async () => {
    const a = await request(app).get('/api/dashboard').set(bearer(admin));
    const e = await request(app).get('/api/dashboard').set(bearer(riya));
    expect(a.body.stats).toEqual({
      totalEmployees: 12,
      presentToday: expect.any(Number),
      lateToday: expect.any(Number),
      onLeaveToday: expect.any(Number),
      pendingLeaves: expect.any(Number),
    });
    expect(e.body.stats).toBeNull();
    expect(e.body.leaveBalances.map((b: { type: string }) => b.type)).toEqual(['CASUAL', 'SICK', 'EARNED']);
    expect(e.body.today.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('accounts without an employee record cannot check in or request leave', async () => {
    const company = await prisma.company.findFirstOrThrow({ where: { name: 'Acme Staffing Pvt Ltd' } });
    const user = await prisma.user.upsert({
      where: { email: 'auditor@acme.test' },
      update: {},
      create: { companyId: company.id, email: 'auditor@acme.test', name: 'External Auditor', role: 'ADMIN', passwordHash: 'x' },
    });
    const token = signToken({ userId: user.id, companyId: company.id, role: 'ADMIN', employeeId: null });
    const auth = { Authorization: `Bearer ${token}` };
    const checkIn = await request(app).post('/api/attendance/check-in').set(auth).send({ lat: 28.627, lng: 77.3727 });
    expect(checkIn.status).toBe(403);
    expect((await request(app).get('/api/leaves/balance').set(auth)).status).toBe(403);
    const dash = await request(app).get('/api/dashboard').set(auth);
    expect(dash.body.today.record).toBeNull();
    expect(dash.body.leaveBalances).toEqual([]);
    expect(dash.body.stats).not.toBeNull();
  });
});

describe('health and unknown routes', () => {
  it('reports db and redis status', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: true, redis: true });
  });

  it('returns NOT_FOUND in the contract shape', async () => {
    const res = await request(app).get('/api/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
