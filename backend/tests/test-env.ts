import 'dotenv/config';

/** Environment for the test run: separate database, mock AI, instant streaming, isolated upload dir. */
function testDatabaseUrl(): string {
  if (process.env.TEST_DATABASE_URL) return process.env.TEST_DATABASE_URL;
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error('Set DATABASE_URL or TEST_DATABASE_URL in .env');
  const url = new URL(base);
  url.pathname = '/hr_copilot_test';
  return url.toString();
}

export const testEnv: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: testDatabaseUrl(),
  LLM_PROVIDER: 'mock',
  EMBEDDING_PROVIDER: 'mock',
  MOCK_STREAM_DELAY_MS: '0',
  UPLOAD_DIR: 'uploads/_test',
  JWT_SECRET: process.env.JWT_SECRET ?? 'test-secret-test-secret-test-secret',
};
