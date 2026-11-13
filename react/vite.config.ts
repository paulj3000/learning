/// <reference types="vitest/config" />
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { djangoDevProxy, djangoDevTarget } from './src/api/devProxy.ts';
import { resolveBackend } from './src/api/backend.ts';
import {
  cognitoEnvFallback,
  diagnosticsLines,
  probeDjango,
  type CognitoSource,
  type DiagnosticsEnv,
} from './src/api/devDiagnostics.ts';

/**
 * Prints the active backend, the /api proxy target (and whether Django answers there) and
 * whether Cognito is configured, once the dev server is listening. `vite dev` only.
 */
function laiDevDiagnostics(env: DiagnosticsEnv, cognitoSource: CognitoSource): Plugin {
  return {
    name: 'lai-dev-diagnostics',
    apply: 'serve',
    configureServer(server) {
      server.httpServer?.once('listening', () => {
        const backend = resolveBackend(env);
        const health =
          backend === 'django' && server.config.mode === 'development'
            ? probeDjango(djangoDevTarget(env))
            : Promise.resolve(null);
        void health.then((result) => {
          for (const line of diagnosticsLines({ env, cognitoSource, health: result })) {
            server.config.logger.info(line);
          }
        });
      });
    },
  };
}

export default defineConfig(({ mode, command }) => {
  // react/.env*, then the shell. Server-side only: the client still sees only VITE_* values.
  const reactEnv = loadEnv(mode, process.cwd(), '');
  // The repository-root .env (`cp .env.sample .env`) that `make runserver` reads, so the Django
  // port and the Cognito pool are written once for both servers. react/ and the shell win.
  const rootEnv = loadEnv(mode, '..', ['DJANGO_DEV_PORT', 'COGNITO_']);
  const env: DiagnosticsEnv = {
    ...reactEnv,
    MODE: mode,
    DJANGO_DEV_PORT: reactEnv.DJANGO_DEV_PORT || rootEnv.DJANGO_DEV_PORT,
  };

  let cognitoSource: CognitoSource = null;
  if (command === 'serve' && mode === 'development') {
    // `vite dev` only: a build (site-release), a unit test or the e2e harness names
    // VITE_COGNITO_* explicitly and never falls back.
    const cognito = cognitoEnvFallback(reactEnv, rootEnv);
    cognitoSource = cognito.source;
    for (const key of ['VITE_COGNITO_USER_POOL_ID', 'VITE_COGNITO_CLIENT_ID'] as const) {
      const value = cognito.env[key];
      if (value && !process.env[key]) process.env[key] = value;
      env[key] = value;
    }
  }

  return {
    // Tailwind only compiles CSS that imports it: src/features/admin/admin.css (ADR-023)
    // and src/features/portal/portal.css (ADR-052).
    plugins: [react(), tailwindcss(), laiDevDiagnostics(env, cognitoSource)],
    // `vite dev` only: forwards /api to a local Django when the backend is Django, which is the
    // default for `vite dev` (TR-D14, P0). Port 5183 by default (owner, 2026-11-05; 5173 is
    // used by other checkouts); VITE_DEV_PORT overrides. Django's port: DJANGO_DEV_PORT.
    server: {
      port: Number(reactEnv.VITE_DEV_PORT) || 5183,
      strictPort: true,
      proxy: djangoDevProxy(env),
    },
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
  };
});
