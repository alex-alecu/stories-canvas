import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['server/index.ts'],
  outDir: 'dist-server',
  format: 'esm',
  target: 'node22',
  clean: true,
  noExternal: [/^\./, /shared/],
});
