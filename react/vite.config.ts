/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // amplify/ stays at the repository root, so its Lambda tests are collected from here.
    include: ['src/**/*.{test,spec}.{ts,tsx}', '../amplify/**/*.test.ts'],
    exclude: ['node_modules', 'dist', 'e2e'],
  },
});
