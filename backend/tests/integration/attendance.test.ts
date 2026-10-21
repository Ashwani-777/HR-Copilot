import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db.js';
import { checkIn } from '../../src/modules/attendance/service.js';
import { isLate, todayIn, zonedToUtc } from '../../src/lib/time.js';
import { ACME_ADMIN, app, bearer, login, RIYA, type Session } from '../helpers/http.js';

const OFFICE = { lat: 28.627, lng: 77.3727 };
const CONNAUGHT_PLACE = { lat: 28.6315, lng: 77.2167 };

describe('attendance', () => {
  let admin: Session;
  let riya: Session;
  beforeAll(async () => {
    [admin, riya] = await Promise.all([login(ACME_ADMIN), login(RIYA)]);
  });

  it('check-out before check-in → 409 NOT_CHECKED_IN', async () => {
    const res = await request(app).post('/api/attendance/check-out').set(bearer(riya));
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('NOT_CHECKED_IN');
  });

  it('rejects a check-in outside the geofence with 422 and the distance', async () => {
    const res = await request(app).post('/api/attendance/check-in').set(bearer(riya)).send(CONNAUGHT_PLACE);
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('OUTSIDE_GEOFENCE');
    expect(res.body.error.details.radiusM).toBe(200);
    expect(res.body.error.details.distanceM).toBeGreaterThan(15_000);
  });

  it('accepts a check-in inside the geofence, once per day', async () => {
    const before = new Date();
    const res = await request(app).post('/api/attendance/check-in').set(bearer(riya)).send({ lat: 28.6274, lng: 77.3731 });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ employeeId: riya.user.employeeId, employeeName: 'Riya Sharma', date: todayIn('Asia/Kolkata'), checkOutAt: null });
    expect(res.body.distanceM).toBeLessThan(200);
    expect(res.body.status).toBe(isLate(before, '09:30', 'Asia/Kolkata') ? 'LATE' : 'ON_TIME');

    const again = await request(app).post('/api/attendance/check-in').set(bearer(riya)).send(OFFICE);
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('ALREADY_CHECKED_IN');
  });

  it('checks out', async () => {
    const res = await request(app).post('/api/attendance/check-out').set(bearer(riya));
    expect(res.status).toBe(200);
    expect(res.body.checkOutAt).toEqual(expect.any(String));
  });

  it('marks LATE using the company shift start and timezone', async () => {
    const created = await request(app)
      .post('/api/employees')
      .set(bearer(admin))
      .send({ name: 'Test Punctuality', email: 'punctual@acme.test', department: 'QA', designation: 'Tester', password: 'Secret@123' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({ id: expect.any(String), name: 'Test Punctuality', email: 'punctual@acme.test', department: 'QA', designation: 'Tester', joinedAt: expect.any(String) });

    const auth = { userId: 'test', companyId: admin.user.companyId, role: 'EMPLOYEE' as const, employeeId: created.body.id as string };
    const onTime = await checkIn(auth, OFFICE, zonedToUtc('2030-01-07', '09:29:30', 'Asia/Kolkata'));
    const late = await checkIn(auth, OFFICE, zonedToUtc('2030-01-08', '09:41:00', 'Asia/Kolkata'));
    expect(onTime).toMatchObject({ date: '2030-01-07', status: 'ON_TIME' });
    expect(late).toMatchObject({ date: '2030-01-08', status: 'LATE' });
    // The day boundary is the company's: 23:59 IST on the 9th is still the 9th, 00:01 IST is the 10th.
    const lateNight = await checkIn(auth, OFFICE, zonedToUtc('2030-01-09', '23:59', 'Asia/Kolkata'));
    expect(lateNight.date).toBe('2030-01-09');
  });

  it('EMPLOYEE only ever sees own records, even when asking for someone else', async () => {
    const rahul = await prisma.employee.findFirstOrThrow({ where: { email: 'rahul@acme.test' } });
    const res = await request(app).get(`/api/attendance?employeeId=${rahul.id}`).set(bearer(riya));
    expect(res.status).toBe(200);
    expect(res.body.records.length).toBeGreaterThan(0);
    for (const r of res.body.records) expect(r.employeeId).toBe(riya.user.employeeId);
  });

  it('ADMIN can list everyone and filter by employee', async () => {
    const all = await request(app).get('/api/attendance').set(bearer(admin));
    expect(new Set(all.body.records.map((r: { employeeId: string }) => r.employeeId)).size).toBeGreaterThan(5);
    const rahul = await prisma.employee.findFirstOrThrow({ where: { email: 'rahul@acme.test' } });
    const one = await request(app).get(`/api/attendance?employeeId=${rahul.id}`).set(bearer(admin));
    expect(one.body.records.length).toBeGreaterThan(10);
    for (const r of one.body.records) expect(r.employeeName).toBe('Rahul Verma');
  });

  it('validates query and body', async () => {
    expect((await request(app).get('/api/attendance?from=2026-13-01').set(bearer(admin))).status).toBe(400);
    expect((await request(app).get('/api/attendance?from=2026-10-10&to=2026-10-01').set(bearer(admin))).status).toBe(400);
    expect((await request(app).post('/api/attendance/check-in').set(bearer(riya)).send({ lat: 200, lng: 0 })).status).toBe(400);
  });

  it('exports CSV for ADMIN', async () => {
    const res = await request(app).get('/api/attendance/export.csv').set(bearer(admin));
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toMatch(/^attachment; filename="attendance_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.csv"$/);
    const lines = res.text.trim().split('\r\n');
    expect(lines[0]).toBe('Date,Employee,Email,Department,Check-in,Check-out,Distance (m),Status');
    expect(lines.length).toBeGreaterThan(100);
  });
});
