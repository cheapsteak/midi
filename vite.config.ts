import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Relative base so the same build works from GitHub Pages (/midi/) and inside the Capacitor app.
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
    // OSMD is one ~1.5 MB UMD bundle, loaded lazily in its own chunk.
    chunkSizeWarningLimit: 2000,
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
