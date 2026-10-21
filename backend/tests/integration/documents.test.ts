import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { prisma } from '../../src/db.js';
import { ingestDocument } from '../../src/rag/ingest.js';
import { hybridSearch } from '../../src/rag/search.js';
import { ACME_ADMIN, app, bearer, login, RIYA, type Session } from '../helpers/http.js';
import { makePdf } from '../helpers/pdf.js';

// The HTTP layer only enqueues; tests run the same ingestion function the BullMQ worker runs.
const enqueued: string[] = [];
vi.mock('../../src/jobs/queue.js', () => ({
  enqueueIngestion: vi.fn(async (id: string) => {
    enqueued.push(id);
  }),
}));

describe('documents', () => {
  let admin: Session;
  let riya: Session;
  beforeAll(async () => {
    [admin, riya] = await Promise.all([login(ACME_ADMIN), login(RIYA)]);
  });

  it('uploads a .md file → 202 QUEUED, enqueues ingestion, and ingestion reaches READY', async () => {
    const md = '# Parking\n\nVisitor parking is in basement level B2. Employees park on level B1 using their access card.\n';
    const res = await request(app).post('/api/documents').set(bearer(admin)).field('title', 'Parking Rules').attach('file', Buffer.from(md), 'parking.md');
    expect(res.status).toBe(202);
    expect(res.body).toEqual({
      id: expect.any(String),
      title: 'Parking Rules',
      filename: 'parking.md',
      mimeType: 'text/markdown',
      status: 'QUEUED',
      progress: 0,
      pages: null,
      chunks: null,
      error: null,
      createdAt: expect.any(String),
    });
    expect(enqueued).toContain(res.body.id);

    await ingestDocument(res.body.id);
    const list = await request(app).get('/api/documents').set(bearer(riya)); // employees can list
    const doc = list.body.documents.find((d: { id: string }) => d.id === res.body.id);
    expect(doc).toMatchObject({ status: 'READY', progress: 100, pages: 1, chunks: 1, error: null });

    const hits = await hybridSearch(admin.user.companyId, 'where do visitors park');
    expect(hits[0]!.documentId).toBe(res.body.id);
  });

  it('ingests PDFs page by page', async () => {
    const pdf = makePdf([['Laptop policy, page one.', 'Laptops are refreshed every three years.'], ['Page two: report lost laptops to IT within 24 hours.']]);
    const res = await request(app).post('/api/documents').set(bearer(admin)).attach('file', pdf, 'it-assets.pdf');
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ title: 'it-assets', mimeType: 'application/pdf' });
    await ingestDocument(res.body.id);
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(doc).toMatchObject({ status: 'READY', pages: 2 });
    const chunks = await prisma.chunk.findMany({ where: { documentId: doc.id }, orderBy: { chunkIndex: 'asc' } });
    expect(chunks.find((c) => c.content.includes('24 hours'))!.page).toBe(2);
  });

  it('marks unreadable files FAILED with an error message', async () => {
    const res = await request(app).post('/api/documents').set(bearer(admin)).attach('file', Buffer.from('this is not a pdf'), 'broken.pdf');
    expect(res.status).toBe(202);
    await expect(ingestDocument(res.body.id)).rejects.toThrow();
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(doc.status).toBe('FAILED');
    expect(doc.error).toBeTruthy();
  });

  it('validates type, size and presence of the file', async () => {
    const exe = await request(app).post('/api/documents').set(bearer(admin)).attach('file', Buffer.from('MZ'), 'virus.exe');
    expect(exe.status).toBe(400);
    expect(exe.body.error.code).toBe('VALIDATION_ERROR');
    const big = await request(app).post('/api/documents').set(bearer(admin)).attach('file', Buffer.alloc(10 * 1024 * 1024 + 1, 97), 'big.txt');
    expect(big.status).toBe(400);
    expect(big.body.error.message).toMatch(/too large/);
    const none = await request(app).post('/api/documents').set(bearer(admin)).field('title', 'x');
    expect(none.status).toBe(400);
  });

  it('deletes a document and its chunks', async () => {
    const res = await request(app).post('/api/documents').set(bearer(admin)).attach('file', Buffer.from('Temporary note about the canteen menu.'), 'tmp.txt');
    await ingestDocument(res.body.id);
    expect(await prisma.chunk.count({ where: { documentId: res.body.id } })).toBe(1);
    expect((await request(app).delete(`/api/documents/${res.body.id}`).set(bearer(admin))).status).toBe(204);
    expect(await prisma.chunk.count({ where: { documentId: res.body.id } })).toBe(0);
    expect((await request(app).delete(`/api/documents/${res.body.id}`).set(bearer(admin))).status).toBe(404);
  });
});
