import { Queue, Worker, type Job } from 'bullmq';
import type { Redis } from 'ioredis';
import { config } from '../config.js';
import { createBullConnection } from '../redis.js';
import { logger } from '../logger.js';
import { ingestDocument } from '../rag/ingest.js';

export const INGEST_QUEUE = 'document-ingestion';

interface IngestJob {
  documentId: string;
}

let queue: Queue<IngestJob> | null = null;
let queueConnection: Redis | null = null;
let worker: Worker<IngestJob> | null = null;
let workerConnection: Redis | null = null;

function getQueue(): Queue<IngestJob> {
  if (!queue) {
    queueConnection = createBullConnection();
    queue = new Queue<IngestJob>(INGEST_QUEUE, { connection: queueConnection, prefix: config.BULLMQ_PREFIX });
  }
  return queue;
}

export async function enqueueIngestion(documentId: string): Promise<void> {
  await getQueue().add(
    'ingest',
    { documentId },
    {
      jobId: `ingest-${documentId}`,
      attempts: 1, // failures are surfaced to the user as status FAILED + error; re-upload to retry
      removeOnComplete: { count: 200 },
      removeOnFail: { count: 200 },
    },
  );
}

/** Worker runs in the API process for simplicity (see README → Limitations). */
export function startIngestionWorker(): Worker<IngestJob> {
  workerConnection = createBullConnection();
  worker = new Worker<IngestJob>(
    INGEST_QUEUE,
    async (job: Job<IngestJob>) => {
      await ingestDocument(job.data.documentId);
    },
    { connection: workerConnection, prefix: config.BULLMQ_PREFIX, concurrency: 2 },
  );
  worker.on('failed', (job, err) => logger.warn({ jobId: job?.id, err: err.message }, 'ingestion job failed'));
  worker.on('error', (err) => logger.error({ err }, 'ingestion worker error'));
  return worker;
}

export async function closeJobs(): Promise<void> {
  await worker?.close();
  await queue?.close();
  workerConnection?.disconnect();
  queueConnection?.disconnect();
  worker = null;
  queue = null;
}
