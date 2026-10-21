import { createServer } from 'node:http';
import { config } from './config.js';
import { logger } from './logger.js';
import { prisma } from './db.js';
import { closeHealthRedis } from './redis.js';
import { createApp } from './app.js';
import { closeRealtime, initRealtime } from './realtime/socket.js';
import { closeJobs, startIngestionWorker } from './jobs/queue.js';

const app = createApp();
const server = createServer(app);
initRealtime(server);
startIngestionWorker();

server.listen(config.PORT, () => {
  logger.info(
    { port: config.PORT, llm: config.LLM_PROVIDER, embeddings: config.EMBEDDING_PROVIDER },
    `HR Copilot API listening on http://localhost:${config.PORT}`,
  );
});

server.on('error', (err: NodeJS.ErrnoException) => {
  logger.fatal({ err }, err.code === 'EADDRINUSE' ? `Port ${config.PORT} is already in use` : 'server error');
  process.exit(1);
});

let shuttingDown = false;
async function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  const force = setTimeout(() => process.exit(1), 10_000).unref();
  server.close();
  await Promise.allSettled([closeRealtime(), closeJobs(), closeHealthRedis()]);
  await prisma.$disconnect();
  clearTimeout(force);
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
