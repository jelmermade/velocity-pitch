import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/evaluation/**/*.test.ts'],
    testTimeout: 180_000,
  },
});
