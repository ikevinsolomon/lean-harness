import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [{ test: { name: 'packages', include: ['packages/*/test/**/*.test.ts'] } }, 'apps/web'],
  },
});
