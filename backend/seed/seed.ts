/**
 * `npm run seed` — resets the hr_copilot database to a realistic demo state:
 *  - Acme Staffing Pvt Ltd (12 employees, 30 working days of attendance, leaves, HR policy ingested)
 *  - Globex Retail (second tenant with its own small policy, used to prove isolation)
 * Deterministic: a fixed PRNG + stable IDs, so re-seeding doesn't invalidate existing JWTs.
 */
import { createHash } from 'node:crypto';
import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import bcrypt from 'bcryptjs';
import type { AttendanceStatus, LeaveStatus, LeaveType, Prisma } from '@prisma/client';
import { config } from '../src/config.js';
import { prisma } from '../src/db.js';
import { ingestDocument } from '../src/rag/ingest.js';
import { checkGeofence } from '../src/lib/geo.js';
import { addDays, dateToDb, isLate, isWeekend, todayIn, workingDaysBetween, zonedToUtc } from '../src/lib/time.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const POLICY_DIR = path.join(here, 'policies');

/** UUID-shaped id derived from a key, so the same seed always produces the same ids. */
export function stableId(key: string): string {
  const h = createHash('sha256').update(`hr-copilot:${key}`).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** mulberry32 seeded from a string */
function rng(key: string): () => number {
  let a = createHash('md5').update(key).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface EmployeeSeed {
  name: string;
  email: string;
  department: string;
  designation: string;
  joinedAt: string;
  role: 'ADMIN' | 'EMPLOYEE';
  /** probability of arriving late on a given day */
  lateRate: number;
  /** skip today's attendance so the demo user can check in live */
  skipToday?: boolean;
}

interface LeaveSeed {
  email: string;
  type: LeaveType;
  from: string;
  to: string;
  status: LeaveStatus;
  reason: string;
}

interface CompanySeed {
  key: string;
  name: string;
  officeLat: number;
  officeLng: number;
  geofenceRadiusM: number;
  shiftStart: string;
  timezone: string;
  adminPassword: string;
  employeePassword: string;
  attendanceDays: number;
  /** public holidays from the policy document — no attendance is generated on these */
  holidays: string[];
  employees: EmployeeSeed[];
  leaves: (today: string) => LeaveSeed[];
  policies: { file: string; title: string }[];
}

function prevWorkingDay(d: string): string {
  let x = addDays(d, -1);
  while (isWeekend(x)) x = addDays(x, -1);
  return x;
}
function nextWorkingDay(d: string): string {
  let x = addDays(d, 1);
  while (isWeekend(x)) x = addDays(x, 1);
  return x;
}
/** n working days before d (n=1 → previous working day) */
function workingDaysAgo(d: string, n: number): string {
  let x = d;
  for (let i = 0; i < n; i++) x = prevWorkingDay(x);
  return x;
}
function workingDaysAhead(d: string, n: number): string {
  let x = d;
  for (let i = 0; i < n; i++) x = nextWorkingDay(x);
  return x;
}

const ACME: CompanySeed = {
  key: 'acme',
  name: 'Acme Staffing Pvt Ltd',
  officeLat: 28.627,
  officeLng: 77.3727,
  geofenceRadiusM: 200,
  shiftStart: '09:30',
  timezone: 'Asia/Kolkata',
  adminPassword: 'Admin@123',
  employeePassword: 'Employee@123',
  attendanceDays: 30,
  holidays: ['2026-01-01', '2026-01-26', '2026-03-04', '2026-03-20', '2026-08-15', '2026-08-28', '2026-10-02', '2026-10-20', '2026-11-09', '2026-12-25'],
  employees: [
    { name: 'Priya Mehta', email: 'admin@acme.test', department: 'HR', designation: 'HR Manager', joinedAt: '2021-04-12', role: 'ADMIN', lateRate: 0.03, skipToday: true },
    { name: 'Riya Sharma', email: 'riya@acme.test', department: 'Engineering', designation: 'Software Engineer', joinedAt: '2023-07-03', role: 'EMPLOYEE', lateRate: 0.1, skipToday: true },
    { name: 'Rahul Verma', email: 'rahul@acme.test', department: 'Sales', designation: 'Account Executive', joinedAt: '2022-01-17', role: 'EMPLOYEE', lateRate: 0.45 },
    { name: 'Aman Gupta', email: 'aman@acme.test', department: 'Engineering', designation: 'Senior Software Engineer', joinedAt: '2020-09-01', role: 'EMPLOYEE', lateRate: 0.05 },
    { name: 'Sneha Iyer', email: 'sneha@acme.test', department: 'Recruitment', designation: 'Talent Acquisition Specialist', joinedAt: '2022-11-21', role: 'EMPLOYEE', lateRate: 0.08 },
    { name: 'Karan Malhotra', email: 'karan@acme.test', department: 'Operations', designation: 'Operations Executive', joinedAt: '2023-02-06', role: 'EMPLOYEE', lateRate: 0.4 },
    { name: 'Neha Kapoor', email: 'neha@acme.test', department: 'Finance', designation: 'Accountant', joinedAt: '2021-08-23', role: 'EMPLOYEE', lateRate: 0.06 },
    { name: 'Vikram Singh', email: 'vikram@acme.test', department: 'Sales', designation: 'Sales Manager', joinedAt: '2019-05-13', role: 'EMPLOYEE', lateRate: 0.12 },
    { name: 'Pooja Nair', email: 'pooja@acme.test', department: 'Recruitment', designation: 'Recruiter', joinedAt: '2024-03-04', role: 'EMPLOYEE', lateRate: 0.07 },
    { name: 'Arjun Reddy', email: 'arjun@acme.test', department: 'Engineering', designation: 'QA Engineer', joinedAt: '2022-06-20', role: 'EMPLOYEE', lateRate: 0.22 },
    { name: 'Divya Joshi', email: 'divya@acme.test', department: 'Operations', designation: 'Payroll Executive', joinedAt: '2023-10-09', role: 'EMPLOYEE', lateRate: 0.05 },
    { name: 'Imran Khan', email: 'imran@acme.test', department: 'Finance', designation: 'Finance Manager', joinedAt: '2020-02-10', role: 'EMPLOYEE', lateRate: 0.04 },
  ],
  leaves: (t) => [
    // Neha is on sick leave around today → "Who is on leave today?"
    { email: 'neha@acme.test', type: 'SICK', from: prevWorkingDay(t), to: nextWorkingDay(t), status: 'APPROVED', reason: 'Viral fever, doctor advised rest' },
    { email: 'riya@acme.test', type: 'CASUAL', from: workingDaysAgo(t, 16), to: workingDaysAgo(t, 15), status: 'APPROVED', reason: "Cousin's wedding in Jaipur" },
    { email: 'riya@acme.test', type: 'SICK', from: workingDaysAgo(t, 24), to: workingDaysAgo(t, 24), status: 'APPROVED', reason: 'Migraine' },
    { email: 'riya@acme.test', type: 'EARNED', from: workingDaysAhead(t, 10), to: workingDaysAhead(t, 12), status: 'PENDING', reason: 'Family trip to Kerala' },
    { email: 'aman@acme.test', type: 'EARNED', from: workingDaysAgo(t, 27), to: workingDaysAgo(t, 23), status: 'APPROVED', reason: 'Annual vacation' },
    { email: 'divya@acme.test', type: 'SICK', from: workingDaysAgo(t, 8), to: workingDaysAgo(t, 8), status: 'APPROVED', reason: 'Dental procedure' },
    { email: 'vikram@acme.test', type: 'CASUAL', from: workingDaysAgo(t, 4), to: workingDaysAgo(t, 3), status: 'REJECTED', reason: 'Personal work' },
    { email: 'pooja@acme.test', type: 'CASUAL', from: workingDaysAhead(t, 4), to: workingDaysAhead(t, 4), status: 'PENDING', reason: 'Bank and passport appointment' },
    { email: 'karan@acme.test', type: 'CASUAL', from: workingDaysAhead(t, 1), to: workingDaysAhead(t, 1), status: 'PENDING', reason: 'Moving house' },
    { email: 'imran@acme.test', type: 'EARNED', from: workingDaysAhead(t, 15), to: workingDaysAhead(t, 18), status: 'APPROVED', reason: 'Trip to Ladakh' },
  ],
  policies: [{ file: 'acme-hr-policy.md', title: 'Acme HR Policy' }],
};

const GLOBEX: CompanySeed = {
  key: 'globex',
  name: 'Globex Retail',
  officeLat: 12.9756,
  officeLng: 77.605,
  geofenceRadiusM: 150,
  shiftStart: '10:00',
  timezone: 'Asia/Kolkata',
  adminPassword: 'Admin@123',
  employeePassword: 'Employee@123',
  attendanceDays: 15,
  holidays: [],
  employees: [
    { name: 'Meera Rao', email: 'admin@globex.test', department: 'HR', designation: 'HR Lead', joinedAt: '2021-01-11', role: 'ADMIN', lateRate: 0.05, skipToday: true },
    { name: 'Sanjay Patel', email: 'sanjay@globex.test', department: 'Store Operations', designation: 'Store Manager', joinedAt: '2020-06-15', role: 'EMPLOYEE', lateRate: 0.05 },
    { name: 'Farah Ali', email: 'farah@globex.test', department: 'Merchandising', designation: 'Visual Merchandiser', joinedAt: '2022-09-05', role: 'EMPLOYEE', lateRate: 0.1 },
    { name: 'Kabir Das', email: 'kabir@globex.test', department: 'Store Operations', designation: 'Cashier', joinedAt: '2024-01-22', role: 'EMPLOYEE', lateRate: 0.35 },
  ],
  leaves: (t) => [
    { email: 'farah@globex.test', type: 'CASUAL', from: t, to: t, status: 'APPROVED', reason: 'Personal errand' },
    { email: 'kabir@globex.test', type: 'SICK', from: workingDaysAgo(t, 5), to: workingDaysAgo(t, 5), status: 'APPROVED', reason: 'Cold and fever' },
    { email: 'sanjay@globex.test', type: 'EARNED', from: workingDaysAhead(t, 6), to: workingDaysAhead(t, 8), status: 'PENDING', reason: 'Visiting family in Ahmedabad' },
  ],
  policies: [{ file: 'globex-hr-policy.md', title: 'Globex Store Handbook' }],
};

function randomPointNear(lat: number, lng: number, maxM: number, rand: () => number) {
  const r = maxM * Math.sqrt(rand());
  const theta = rand() * 2 * Math.PI;
  return {
    lat: lat + (r * Math.cos(theta)) / 111_320,
    lng: lng + (r * Math.sin(theta)) / (111_320 * Math.cos((lat * Math.PI) / 180)),
  };
}

function hhmmss(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':');
}

async function seedCompany(c: CompanySeed, now: Date, hashes: Map<string, string>, log: (m: string) => void) {
  const companyId = stableId(`company:${c.key}`);
  await prisma.company.create({
    data: {
      id: companyId,
      name: c.name,
      officeLat: c.officeLat,
      officeLng: c.officeLng,
      geofenceRadiusM: c.geofenceRadiusM,
      shiftStart: c.shiftStart,
      timezone: c.timezone,
    },
  });

  const idByEmail = new Map<string, string>();
  for (const e of c.employees) {
    const employeeId = stableId(`employee:${e.email}`);
    idByEmail.set(e.email, employeeId);
    await prisma.employee.create({
      data: { id: employeeId, companyId, name: e.name, email: e.email, department: e.department, designation: e.designation, joinedAt: dateToDb(e.joinedAt) },
    });
    const password = e.role === 'ADMIN' ? c.adminPassword : c.employeePassword;
    await prisma.user.create({
      data: { id: stableId(`user:${e.email}`), companyId, email: e.email, name: e.name, role: e.role, employeeId, passwordHash: hashes.get(password)! },
    });
  }

  // Leaves first: approved leave days get no attendance.
  const today = todayIn(c.timezone, now);
  const onLeave = new Set<string>();
  const leaveRows: Prisma.LeaveRequestCreateManyInput[] = [];
  for (const [i, l] of c.leaves(today).entries()) {
    const days = workingDaysBetween(l.from, l.to);
    if (days === 0) continue;
    const employeeId = idByEmail.get(l.email)!;
    const created = dateToDb(addDays(l.from < today ? l.from : today, -3));
    leaveRows.push({
      id: stableId(`leave:${c.key}:${i}`),
      companyId,
      employeeId,
      type: l.type,
      fromDate: dateToDb(l.from),
      toDate: dateToDb(l.to),
      days,
      reason: l.reason,
      status: l.status,
      createdAt: new Date(created.getTime() + 5.5 * 3600_000),
      decidedAt: l.status === 'PENDING' ? null : new Date(created.getTime() + 30 * 3600_000),
      decidedById: l.status === 'PENDING' ? null : stableId(`user:admin@${c.key}.test`),
    });
    if (l.status === 'APPROVED') {
      for (let d = l.from; d <= l.to; d = addDays(d, 1)) onLeave.add(`${employeeId}:${d}`);
    }
  }
  await prisma.leaveRequest.createMany({ data: leaveRows });

  // Attendance for the last N working days (+ today for those whose check-in time has passed).
  const days: string[] = [];
  for (let d = prevWorkingDay(today); days.length < c.attendanceDays; d = prevWorkingDay(d)) days.unshift(d);
  if (!isWeekend(today)) days.push(today);
  const mostRecentPast = [...days].reverse().find((d) => d < today && !c.holidays.includes(d));

  const shiftSeconds = Number(c.shiftStart.slice(0, 2)) * 3600 + Number(c.shiftStart.slice(3, 5)) * 60;
  const rows: Prisma.AttendanceCreateManyInput[] = [];
  for (const e of c.employees) {
    const employeeId = idByEmail.get(e.email)!;
    for (const d of days) {
      if (d < e.joinedAt || c.holidays.includes(d) || onLeave.has(`${employeeId}:${d}`)) continue;
      const rand = rng(`${e.email}:${d}`);
      const isToday = d === today;
      if (isToday && e.skipToday) continue;
      if (!isToday && rand() < 0.03) continue; // the odd unplanned absence
      // Repeat late-comers are always late on the most recent working day, so "this week" has data.
      const late = (e.lateRate >= 0.3 && d === mostRecentPast) || rand() < e.lateRate;
      const offset = late ? 180 + Math.floor(rand() * 55 * 60) : -(60 + Math.floor(rand() * 34 * 60));
      const checkInAt = zonedToUtc(d, hhmmss(shiftSeconds + offset), c.timezone);
      if (isToday && checkInAt > now) continue; // not in yet
      const point = randomPointNear(c.officeLat, c.officeLng, c.geofenceRadiusM * 0.75, rand);
      const checkOutAt = isToday ? null : zonedToUtc(d, hhmmss(shiftSeconds + 8 * 3600 + 15 * 60 + Math.floor(rand() * 105 * 60)), c.timezone);
      const status: AttendanceStatus = isLate(checkInAt, c.shiftStart, c.timezone) ? 'LATE' : 'ON_TIME';
      rows.push({
        id: stableId(`attendance:${e.email}:${d}`),
        companyId,
        employeeId,
        date: dateToDb(d),
        checkInAt,
        checkOutAt,
        checkInLat: point.lat,
        checkInLng: point.lng,
        distanceM: checkGeofence(point, { lat: c.officeLat, lng: c.officeLng }, c.geofenceRadiusM).distanceM,
        status,
      });
    }
  }
  await prisma.attendance.createMany({ data: rows });
  log(`  ${c.name}: ${c.employees.length} employees, ${rows.length} attendance records, ${leaveRows.length} leave requests`);

  // Policies: copy into uploads/ and ingest synchronously (same pipeline the BullMQ worker runs).
  for (const p of c.policies) {
    const id = stableId(`document:${c.key}:${p.file}`);
    const dir = path.resolve(process.cwd(), config.UPLOAD_DIR, companyId);
    await mkdir(dir, { recursive: true });
    const storagePath = path.join(dir, `${id}.md`);
    const source = path.join(POLICY_DIR, p.file);
    await copyFile(source, storagePath);
    const { size } = await import('node:fs/promises').then((fs) => fs.stat(storagePath));
    await prisma.document.create({
      data: { id, companyId, title: p.title, filename: p.file, mimeType: 'text/markdown', storagePath, sizeBytes: size, uploadedById: stableId(`user:admin@${c.key}.test`) },
    });
    await ingestDocument(id);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
    log(`  ${c.name}: ingested "${p.title}" → ${doc.status}, ${doc.pages} pages, ${doc.chunkCount} chunks`);
  }
}

export async function runSeed(log: (m: string) => void = console.log): Promise<void> {
  const dbName = new URL(config.DATABASE_URL).pathname.replace(/^\//, '');
  if (!dbName.startsWith('hr_copilot')) {
    throw new Error(`Refusing to seed database "${dbName}": only databases named hr_copilot* may be reset.`);
  }
  log(`Seeding ${dbName}…`);
  // Only this app's tables, in this app's database.
  await prisma.$executeRawUnsafe('TRUNCATE "Chunk", "Document", "LeaveRequest", "Attendance", "User", "Employee", "Company" CASCADE');
  await rm(path.resolve(process.cwd(), config.UPLOAD_DIR), { recursive: true, force: true });

  const passwords = [...new Set([ACME, GLOBEX].flatMap((c) => [c.adminPassword, c.employeePassword]))];
  const hashes = new Map(await Promise.all(passwords.map(async (p) => [p, await bcrypt.hash(p, 10)] as const)));

  const now = new Date();
  for (const company of [ACME, GLOBEX]) await seedCompany(company, now, hashes, log);

  log('Done. Logins (test values): admin@acme.test / Admin@123 · riya@acme.test / Employee@123 · admin@globex.test / Admin@123');
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;
if (isMain) {
  runSeed()
    .then(() => prisma.$disconnect())
    .catch(async (err) => {
      console.error(err);
      await prisma.$disconnect();
      process.exit(1);
    });
}
