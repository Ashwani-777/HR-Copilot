/**
 * Tenant isolation: a Globex admin must never see or touch Acme data — through the REST API,
 * through retrieval, or through the copilot's tools. Plus EMPLOYEE self-scoping inside tools.
 */
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '../../src/db.js';
import { todayIn, addDays } from '../../src/lib/time.js';
import { hybridSearch } from '../../src/rag/search.js';
import { CitationRegistry } from '../../src/modules/chat/citations.js';
import { getAttendanceSummary, getLateArrivals, getLeaveBalance, getWhoIsOnLeave, searchPolicy, type ToolContext } from '../../src/modules/chat/tools.js';
import { ACME_ADMIN, answerText, app, bearer, GLOBEX_ADMIN, login, parseSse, RIYA, type Session } from '../helpers/http.js';

const today = todayIn('Asia/Kolkata');

describe('tenant isolation (Globex admin vs Acme data)', () => {
  let globex: Session;
  let acme: Session;
  let acmeEmployeeIds: Set<string>;
  let acmeNames: Set<string>;
  beforeAll(async () => {
    [globex, acme] = await Promise.all([login(GLOBEX_ADMIN), login(ACME_ADMIN)]);
    const acmeEmployees = await prisma.employee.findMany({ where: { companyId: acme.user.companyId } });
    acmeEmployeeIds = new Set(acmeEmployees.map((e) => e.id));
    acmeNames = new Set(acmeEmployees.map((e) => e.name));
  });

  it('documents: lists only its own, cannot delete Acme documents', async () => {
    const acmeDoc = await prisma.document.findFirstOrThrow({ where: { companyId: acme.user.companyId } });
    const list = await request(app).get('/api/documents').set(bearer(globex));
    expect(list.body.documents.map((d: { title: string }) => d.title)).toEqual(['Globex Store Handbook']);
    const del = await request(app).delete(`/api/documents/${acmeDoc.id}`).set(bearer(globex));
    expect(del.status).toBe(404);
    expect(await prisma.document.findUnique({ where: { id: acmeDoc.id } })).not.toBeNull();
  });

  it('attendance: never returns Acme rows, even when filtering by an Acme employeeId', async () => {
    const all = await request(app).get('/api/attendance').set(bearer(globex));
    expect(all.body.records.length).toBeGreaterThan(0);
    for (const r of all.body.records) expect(acmeEmployeeIds.has(r.employeeId)).toBe(false);
    const [someAcmeId] = acmeEmployeeIds;
    const targeted = await request(app).get(`/api/attendance?employeeId=${someAcmeId}`).set(bearer(globex));
    expect(targeted.body.records).toEqual([]);
    const csv = await request(app).get('/api/attendance/export.csv').set(bearer(globex));
    for (const name of acmeNames) expect(csv.text).not.toContain(name);
  });

  it('leaves and employees: only Globex rows; Acme leave ids are 404', async () => {
    const leaves = await request(app).get('/api/leaves').set(bearer(globex));
    for (const l of leaves.body.leaves) expect(acmeEmployeeIds.has(l.employeeId)).toBe(false);
    const acmePending = await prisma.leaveRequest.findFirstOrThrow({ where: { companyId: acme.user.companyId, status: 'PENDING' } });
    const patch = await request(app).patch(`/api/leaves/${acmePending.id}`).set(bearer(globex)).send({ status: 'REJECTED' });
    expect(patch.status).toBe(404);
    expect((await prisma.leaveRequest.findUniqueOrThrow({ where: { id: acmePending.id } })).status).toBe('PENDING');
    const employees = await request(app).get('/api/employees').set(bearer(globex));
    expect(employees.body.employees).toHaveLength(4);
    expect(employees.body.employees.every((e: { email: string }) => e.email.endsWith('@globex.test'))).toBe(true);
  });

  it('retrieval: hybrid search never returns another tenant’s chunks', async () => {
    const acmeOnlyQuery = 'Acme Wellness Allowance gym yoga counselling';
    const fromAcme = await hybridSearch(acme.user.companyId, acmeOnlyQuery);
    expect(fromAcme[0]!.documentTitle).toBe('Acme HR Policy');
    const fromGlobex = await hybridSearch(globex.user.companyId, acmeOnlyQuery);
    expect(fromGlobex.every((r) => r.documentTitle === 'Globex Store Handbook')).toBe(true);
  });

  describe('chat tools run with the Globex context', () => {
    const ctx = (): ToolContext => ({
      companyId: globex.user.companyId,
      userId: globex.user.id,
      role: 'ADMIN',
      employeeId: globex.user.employeeId,
      timezone: 'Asia/Kolkata',
      shiftStart: '10:00',
      today,
      citations: new CitationRegistry(),
    });

    it('searchPolicy only cites Globex documents', async () => {
      const out = await searchPolicy.execute(ctx(), { query: 'How many days can I work from home? Wellness allowance?' });
      const results = (out.data as { results: { documentTitle: string }[] }).results;
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) expect(r.documentTitle).toBe('Globex Store Handbook');
    });

    it('attendance / late / leave tools only see Globex employees', async () => {
      const range = { from: addDays(today, -30), to: today };
      const late = (await getLateArrivals.execute(ctx(), range)).data as { employees: { name: string }[] };
      const summary = (await getAttendanceSummary.execute(ctx(), range)).data as { employees: { name: string }[] };
      const onLeave = (await getWhoIsOnLeave.execute(ctx(), { date: today })).data as { onLeave: { name: string }[] };
      for (const e of [...late.employees, ...summary.employees, ...onLeave.onLeave]) expect(acmeNames.has(e.name)).toBe(false);
      expect(summary.employees).toHaveLength(4);
      expect(onLeave.onLeave.map((l) => l.name)).not.toContain('Neha Kapoor');
    });

    it('getLeaveBalance cannot look up an Acme employee by name', async () => {
      const out = await getLeaveBalance.execute(ctx(), { employeeName: 'Riya Sharma' });
      expect(out.ok).toBe(false);
      expect((out.data as { error: string }).error).toMatch(/No employee named/);
    });
  });

  it('chat endpoint: a Globex admin asking about Acme policy gets no Acme citations', async () => {
    const res = await request(app).post('/api/chat').set(bearer(globex)).send({ message: 'What is the Acme Wellness Allowance?' });
    const events = parseSse(res.text);
    const citations = events.find((e) => e.event === 'citations')!.data.citations as { documentTitle: string }[];
    for (const c of citations) expect(c.documentTitle).not.toBe('Acme HR Policy');
    expect(answerText(events)).not.toMatch(/6,000/);
  });
});

describe('EMPLOYEE self-scoping inside tools', () => {
  let riya: Session;
  beforeAll(async () => {
    riya = await login(RIYA);
  });
  const ctx = (): ToolContext => ({
    companyId: riya.user.companyId,
    userId: riya.user.id,
    role: 'EMPLOYEE',
    employeeId: riya.user.employeeId,
    timezone: 'Asia/Kolkata',
    shiftStart: '09:30',
    today,
    citations: new CitationRegistry(),
  });

  it('late arrivals and attendance summaries only include the caller', async () => {
    const range = { from: addDays(today, -40), to: today };
    const late = (await getLateArrivals.execute(ctx(), range)).data as { employees: { name: string }[] };
    for (const e of late.employees) expect(e.name).toBe('Riya Sharma');
    const summary = (await getAttendanceSummary.execute(ctx(), { ...range, department: 'Sales' })).data as { employees: { name: string }[]; note?: string };
    expect(summary.employees.map((e) => e.name)).toEqual(['Riya Sharma']);
    expect(summary.note).toMatch(/only see their own/);
  });

  it("asking for a colleague's balance returns the caller's own", async () => {
    const out = (await getLeaveBalance.execute(ctx(), { employeeName: 'Rahul Verma' })).data as { employee: string; note?: string };
    expect(out.employee).toBe('Riya Sharma');
    expect(out.note).toMatch(/only see their own/);
  });

  it("who-is-on-leave hides colleagues' leave", async () => {
    const out = (await getWhoIsOnLeave.execute(ctx(), { date: today })).data as { onLeave: unknown[]; scope: string };
    expect(out.scope).toBe('self');
    expect(out.onLeave).toEqual([]); // Neha is on leave today, but Riya can't see that
  });
});
