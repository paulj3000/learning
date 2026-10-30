/// <reference types="vitest/config" />
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { djangoDevProxy } from './src/api/devProxy.ts';

export default defineConfig(({ mode }) => ({
  // Tailwind only compiles CSS that imports it: src/features/admin/admin.css (ADR-023).
  plugins: [react(), tailwindcss()],
  // `vite dev` only: forwards /api to a local Django when VITE_BACKEND=django (TR-D14).
  server: { proxy: djangoDevProxy(loadEnv(mode, process.cwd(), '')) },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
    // amplify/ stays at the repository root, so its Lambda tests are collected from here.
    include: [
      'src/**/*.{test,spec}.{ts,tsx}',
      '../amplify/**/*.test.ts',
      '../server/**/*.test.ts',
      '../infra/**/*.test.ts',
    ],
    exclude: ['node_modules', 'dist', 'e2e'],
  },
}));
