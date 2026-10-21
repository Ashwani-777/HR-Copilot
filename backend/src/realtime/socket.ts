import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { Redis } from 'ioredis';
import { config } from '../config.js';
import { verifyToken } from '../middleware/auth.js';
import type { DocDto } from '../lib/dto.js';
import { logger } from '../logger.js';

let io: Server | null = null;
let pubClient: Redis | null = null;
let subClient: Redis | null = null;

export const companyRoom = (companyId: string) => `company:${companyId}`;

/** Socket.IO on /socket.io. Clients connect with `io({ auth: { token } })` and join their company room. */
export function initRealtime(httpServer: HttpServer): Server {
  io = new Server(httpServer, {
    path: '/socket.io',
    cors: { origin: config.CORS_ORIGIN.split(',').map((s) => s.trim()), credentials: true },
  });

  // Redis adapter: an emit from any API instance (e.g. whichever one's BullMQ worker ran the job) reaches
  // sockets connected to every instance. Pub/sub channels ignore the DB index, hence the app-specific key.
  pubClient = new Redis(config.REDIS_URL);
  subClient = pubClient.duplicate();
  for (const c of [pubClient, subClient]) c.on('error', (err) => logger.warn({ err: err.message }, 'socket.io redis adapter error'));
  io.adapter(createAdapter(pubClient, subClient, { key: `${config.BULLMQ_PREFIX}:socket.io` }));

  io.use((socket, next) => {
    const token = (socket.handshake.auth as { token?: unknown } | undefined)?.token;
    const auth = typeof token === 'string' ? verifyToken(token) : null;
    if (!auth) return next(new Error('UNAUTHORIZED'));
    socket.data.auth = auth;
    next();
  });

  io.on('connection', (socket) => {
    const { companyId, userId } = socket.data.auth as { companyId: string; userId: string };
    void socket.join(companyRoom(companyId));
    logger.debug({ userId, companyId }, 'socket connected');
  });

  return io;
}

/** Broadcast a document's latest state to everyone in its company (never across tenants). */
export function emitDocumentStatus(companyId: string, doc: DocDto): void {
  io?.to(companyRoom(companyId)).emit('document:status', doc);
}

export async function closeRealtime(): Promise<void> {
  if (io) {
    await io.close();
    io = null;
  }
  pubClient?.disconnect();
  subClient?.disconnect();
  pubClient = subClient = null;
}
