import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { io as connect, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../src/app.js';
import { closeRealtime, emitDocumentStatus, initRealtime } from '../../src/realtime/socket.js';
import type { DocDto } from '../../src/lib/dto.js';
import { ACME_ADMIN, GLOBEX_ADMIN, login, type Session } from '../helpers/http.js';

describe('Socket.IO document:status', () => {
  let server: Server;
  let url: string;
  let acme: Session;
  let globex: Session;
  const sockets: Socket[] = [];

  beforeAll(async () => {
    server = createServer(createApp());
    initRealtime(server);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    url = `http://localhost:${(server.address() as AddressInfo).port}`;
    [acme, globex] = await Promise.all([login(ACME_ADMIN), login(GLOBEX_ADMIN)]);
  });

  afterAll(async () => {
    for (const s of sockets) s.close();
    await closeRealtime();
    await new Promise((resolve) => server.close(resolve));
  });

  const open = (token: string) =>
    new Promise<Socket>((resolve, reject) => {
      const s = connect(url, { auth: { token }, transports: ['websocket'], reconnection: false });
      sockets.push(s);
      s.on('connect', () => resolve(s));
      s.on('connect_error', reject);
    });

  it('rejects connections without a valid token', async () => {
    await expect(open('not-a-jwt')).rejects.toThrow('UNAUTHORIZED');
  });

  it("delivers a document's status only to its own company's room", async () => {
    const [acmeSocket, globexSocket] = await Promise.all([open(acme.token), open(globex.token)]);
    const got: { acme: DocDto[]; globex: DocDto[] } = { acme: [], globex: [] };
    acmeSocket.on('document:status', (d: DocDto) => got.acme.push(d));
    globexSocket.on('document:status', (d: DocDto) => got.globex.push(d));
    await new Promise((r) => setTimeout(r, 200)); // let room joins settle

    const doc: DocDto = { id: 'd1', title: 'Policy', filename: 'p.md', mimeType: 'text/markdown', status: 'PROCESSING', progress: 40, pages: null, chunks: null, error: null, createdAt: new Date().toISOString() };
    emitDocumentStatus(acme.user.companyId, doc);
    await new Promise((r) => setTimeout(r, 300));
    expect(got.acme).toEqual([doc]);
    expect(got.globex).toEqual([]);
  });
});
