import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { addDays, startOfWeek, todayIn } from '../../src/lib/time.js';
import { ACME_ADMIN, app, bearer, GLOBEX_ADMIN, login, RIYA, type Session } from '../helpers/http.js';

// A Monday ~10 weeks out keeps clear of the seeded leaves.
const monday = addDays(startOfWeek(todayIn('Asia/Kolkata')), 70);

describe('leaves', () => {
  let admin: Session;
  let riya: Session;
  let globex: Session;
  let leaveId: string;
  beforeAll(async () => {
    [admin, riya, globex] = await Promise.all([login(ACME_ADMIN), login(RIYA), login(GLOBEX_ADMIN)]);
  });

  it('returns balances with allowances CASUAL 12, SICK 8, EARNED 15', async () => {
    const res = await request(app).get('/api/leaves/balance').set(bearer(riya));
    expect(res.status).toBe(200);
    expect(res.body.balances.map((b: { type: string; allowed: number }) => [b.type, b.allowed])).toEqual([
      ['CASUAL', 12],
      ['SICK', 8],
      ['EARNED', 15],
    ]);
    for (const b of res.body.balances) expect(b.remaining).toBe(b.allowed - b.used);
  });

  it('creates a request counting working days only (Fri–Mon = 2 days)', async () => {
    const res = await request(app)
      .post('/api/leaves')
      .set(bearer(riya))
      .send({ type: 'CASUAL', from: addDays(monday, 4), to: addDays(monday, 7), reason: 'Long weekend trip' });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ employeeName: 'Riya Sharma', type: 'CASUAL', days: 2, status: 'PENDING', decidedAt: null });
    leaveId = res.body.id;
  });

  it('rejects weekend-only ranges, overlaps, inverted ranges and over-balance requests', async () => {
    const post = (body: object) => request(app).post('/api/leaves').set(bearer(riya)).send({ reason: 'Testing', ...body });
    expect((await post({ type: 'CASUAL', from: addDays(monday, 5), to: addDays(monday, 6) })).body.error.code).toBe('VALIDATION_ERROR');
    expect((await post({ type: 'SICK', from: addDays(monday, 7), to: addDays(monday, 7) })).status).toBe(400); // overlaps
    expect((await post({ type: 'SICK', from: addDays(monday, 2), to: addDays(monday, 1) })).status).toBe(400);
    const tooMuch = await post({ type: 'SICK', from: addDays(monday, 14), to: addDays(monday, 25) }); // 10 working days > 8
    expect(tooMuch.status).toBe(400);
    expect(tooMuch.body.error.message).toMatch(/Not enough sick leave/);
  });

  it('EMPLOYEE sees only own leaves; ADMIN sees the company and can filter by status', async () => {
    const own = await request(app).get('/api/leaves').set(bearer(riya));
    for (const l of own.body.leaves) expect(l.employeeId).toBe(riya.user.employeeId);
    const pending = await request(app).get('/api/leaves?status=PENDING').set(bearer(admin));
    expect(pending.body.leaves.length).toBeGreaterThanOrEqual(4);
    for (const l of pending.body.leaves) expect(l.status).toBe('PENDING');
    expect((await request(app).get('/api/leaves?status=MAYBE').set(bearer(admin))).status).toBe(400);
  });

  it('only an ADMIN of the same company can decide', async () => {
    expect((await request(app).patch(`/api/leaves/${leaveId}`).set(bearer(riya)).send({ status: 'APPROVED' })).status).toBe(403);
    expect((await request(app).patch(`/api/leaves/${leaveId}`).set(bearer(globex)).send({ status: 'APPROVED' })).status).toBe(404);

    const ok = await request(app).patch(`/api/leaves/${leaveId}`).set(bearer(admin)).send({ status: 'APPROVED' });
    expect(ok.status).toBe(200);
    expect(ok.body.status).toBe('APPROVED');
    expect(ok.body.decidedAt).toEqual(expect.any(String));

    const again = await request(app).patch(`/api/leaves/${leaveId}`).set(bearer(admin)).send({ status: 'REJECTED' });
    expect(again.status).toBe(400);
  });
});
