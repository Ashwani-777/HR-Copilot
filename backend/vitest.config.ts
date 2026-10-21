import { defineConfig } from 'vitest/config';
import { testEnv } from './tests/test-env.js';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globalSetup: ['tests/global-setup.ts'],
    env: testEnv,
    // Integration tests share one seeded database, so run files one at a time.
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 60_000,
  },
});
