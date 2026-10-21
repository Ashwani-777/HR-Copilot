import request from 'supertest';
import { createApp } from '../../src/app.js';

export const app = createApp();

export const ACME_ADMIN = { email: 'admin@acme.test', password: 'Admin@123' };
export const RIYA = { email: 'riya@acme.test', password: 'Employee@123' };
export const GLOBEX_ADMIN = { email: 'admin@globex.test', password: 'Admin@123' };

export interface Session {
  token: string;
  user: { id: string; companyId: string; employeeId: string | null; role: 'ADMIN' | 'EMPLOYEE'; name: string };
  company: { id: string; timezone: string; officeLat: number; officeLng: number; geofenceRadiusM: number; shiftStart: string };
}

export async function login(creds: { email: string; password: string }): Promise<Session> {
  const res = await request(app).post('/api/auth/login').send(creds);
  if (res.status !== 200) throw new Error(`login failed for ${creds.email}: ${res.status} ${JSON.stringify(res.body)}`);
  return res.body as Session;
}

export const bearer = (s: Session) => ({ Authorization: `Bearer ${s.token}` });

export interface SseEvent {
  event: string;
  data: any;
}

export function parseSse(body: string): SseEvent[] {
  return body
    .split('\n\n')
    .filter((block) => block.includes('event: '))
    .map((block) => {
      const event = /^event: (.*)$/m.exec(block)![1]!;
      const data = JSON.parse(/^data: (.*)$/m.exec(block)![1]!);
      return { event, data };
    });
}

export function answerText(events: SseEvent[]): string {
  return events.filter((e) => e.event === 'token').map((e) => e.data.text).join('');
}
