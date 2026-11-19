import { defineConfig } from 'vitest/config';

// The engine's own test run (LAI-2101). Pure modules run in Node; a test that needs a DOM
// opts in with a `// @vitest-environment jsdom` docblock.
export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts'],
  },
});
