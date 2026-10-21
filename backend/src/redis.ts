import { Redis } from 'ioredis';
import { config } from './config.js';

/**
 * Connection for BullMQ (queue + worker). BullMQ requires `maxRetriesPerRequest: null`
 * so blocking commands survive reconnects. The URL selects DB index 5 (see .env.example).
 */
export function createBullConnection(): Redis {
  return new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
}

let healthClient: Redis | null = null;

/** Lightweight ping for /api/health. Never hangs: offline queue disabled + 1s timeout. */
export async function checkRedis(): Promise<boolean> {
  if (!healthClient) {
    healthClient = new Redis(config.REDIS_URL, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      retryStrategy: (times) => Math.min(times * 500, 5000),
    });
    healthClient.on('error', () => {
      /* surfaced via health=false; avoid unhandled error events */
    });
  }
  const client = healthClient;
  try {
    const pong = await Promise.race([
      (async () => {
        // First call: the client is still connecting and the offline queue is off, so wait for 'ready'.
        if (client.status !== 'ready') await new Promise((resolve) => client.once('ready', resolve));
        return client.ping();
      })(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 1000)),
    ]);
    return pong === 'PONG';
  } catch {
    return false;
  }
}

export async function closeHealthRedis(): Promise<void> {
  if (healthClient) {
    healthClient.disconnect();
    healthClient = null;
  }
}
