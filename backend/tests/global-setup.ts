import { execSync } from 'node:child_process';
import { testEnv } from './test-env.js';

/** Migrate + seed the test database once per run (the seed refuses to touch non-hr_copilot* databases). */
export default function setup(): void {
  const env = { ...process.env, ...testEnv };
  execSync('npx prisma migrate deploy', { env, stdio: 'pipe' });
  execSync('npx tsx seed/seed.ts', { env, stdio: 'pipe' });
}
