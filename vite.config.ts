import { defineConfig } from 'vite';

export default defineConfig({
  root: 'examples',
  server: { port: 5173, open: true },
  build: {
    lib: {
      entry: '../src/index.ts',
      name: 'TDJS',
      formats: ['es', 'cjs'],
      fileName: (format) => `tdjs.${format === 'es' ? 'mjs' : 'js'}`,
    },
    outDir: '../dist',
    emptyOutDir: true,
    target: 'esnext',
  },
  worker: { format: 'es' },
});
