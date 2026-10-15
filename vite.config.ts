import { defineConfig } from 'vitest/config';

export default defineConfig({
  // The engine chunk (the video library) is about 600 KB but loads lazily, after the page is up.
  build: { target: 'es2022', chunkSizeWarningLimit: 700 },
  test: { include: ['tests/**/*.test.ts'] },
});
