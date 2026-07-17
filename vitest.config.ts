import { defineConfig } from 'vitest/config';

/**
 * Vitest configuration.
 *
 * The build-time `vite.config.ts` sets `root: 'examples'` for the dev server,
 * which would make vitest look for tests under `examples/`. This standalone
 * vitest config points the test runner at the project root so the `src/**`
 * test files are discovered.
 */
export default defineConfig({
  root: '.',
  test: {
    include: ['src/**/*.{test,spec}.ts'],
    exclude: ['node_modules/**', 'dist/**'],
  },
});
