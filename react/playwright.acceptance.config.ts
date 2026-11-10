import { defineConfig, devices } from '@playwright/test';

/**
 * Pre-merge browser acceptance (docs/TESTING_STRATEGY.md, "Browser acceptance suites"):
 * a disposable local Django (tests/e2e/django_server.py) and `vite --mode e2e` proxying /api
 * to it. One worker: the suites share one seeded database and build on each other's state
 * only where a spec says so. Nothing here reaches AWS.
 */
const djangoPort = process.env.LAI_E2E_DJANGO_PORT ?? '8765';
const vitePort = process.env.LAI_E2E_VITE_PORT ?? '5175';
const python = process.env.LAI_E2E_PYTHON ?? '../.venv/bin/python';

const webgl = {
  launchOptions: { args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] },
};

export default defineConfig({
  testDir: './e2e/acceptance',
  outputDir: './test-results/acceptance',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['json', { outputFile: './test-results/acceptance/results.json' }]],
  use: {
    baseURL: `http://127.0.0.1:${vitePort}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      command: `${python} ../tests/e2e/django_server.py`,
      url: `http://127.0.0.1:${djangoPort}/api/v1/health/`,
      timeout: 240_000,
      reuseExistingServer: false,
      stdout: 'pipe',
      env: { LAI_E2E_DJANGO_PORT: djangoPort },
    },
    {
      command: 'node e2e/acceptance/support/start-vite.mjs',
      url: `http://127.0.0.1:${vitePort}/`,
      timeout: 120_000,
      reuseExistingServer: false,
      env: { LAI_E2E_VITE_PORT: vitePort, LAI_E2E_DJANGO_PORT: djangoPort },
    },
  ],
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'], ...webgl } },
    {
      name: 'tablet',
      // iPad-sized touch viewport on Chromium (the only engine the suite installs).
      use: {
        ...devices['iPad (gen 7) landscape'],
        browserName: 'chromium',
        ...webgl,
      },
      grep: /@tablet/,
    },
  ],
});
