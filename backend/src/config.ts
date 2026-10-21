import 'dotenv/config';
import { z } from 'zod';

/** Treat empty strings in .env (e.g. `OPENAI_API_KEY=`) as "not set". */
const optionalString = z.preprocess((v) => (typeof v === 'string' && v.trim() === '' ? undefined : v), z.string().optional());

const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(4100),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  UPLOAD_DIR: z.string().default('uploads'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  REDIS_URL: z.string().default('redis://localhost:6379/5'),
  BULLMQ_PREFIX: z.string().default('hrc'),

  JWT_SECRET: z.string().min(16, 'JWT_SECRET must be at least 16 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),

  LLM_PROVIDER: z.enum(['mock', 'openai', 'anthropic']).default('mock'),
  EMBEDDING_PROVIDER: z.enum(['mock', 'openai']).default('mock'),

  OPENAI_API_KEY: optionalString,
  OPENAI_BASE_URL: optionalString,
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  OPENAI_EMBEDDING_MODEL: z.string().default('text-embedding-3-small'),

  ANTHROPIC_API_KEY: optionalString,
  ANTHROPIC_MODEL: z.string().default('claude-haiku-5-5'),

  MOCK_STREAM_DELAY_MS: z.coerce.number().int().min(0).default(15),
});

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  // Fail fast with a readable message instead of a stack trace deep inside a module.
  const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
  console.error(`Invalid environment configuration:\n${issues}\nSee .env.example.`);
  process.exit(1);
}

export const config = parsed.data;
export type Config = typeof config;
export const isTest = config.NODE_ENV === 'test';
