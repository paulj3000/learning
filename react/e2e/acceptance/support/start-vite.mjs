// Starts `vite --mode e2e` for the acceptance suites.
//
// The app reads its Cognito pool and client from VITE_COGNITO_* (react/src/lib/cognito, AMP-02).
// They point at the local e2e pool that tests/e2e/django_server.py trusts; tokens are minted by
// the tests and seeded into localStorage, so sign-in never calls AWS.
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const reactDir = resolve(here, '../../..');
const port = process.env.LAI_E2E_VITE_PORT ?? '5175';

const vite = spawn(
  'npx',
  ['vite', '--mode', 'e2e', '--port', port, '--strictPort', '--host', '127.0.0.1'],
  {
    cwd: reactDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_COGNITO_USER_POOL_ID: 'us-east-1_E2Elocal',
      VITE_COGNITO_CLIENT_ID: 'e2elocalclient',
      DJANGO_DEV_PROXY_TARGET: `http://127.0.0.1:${process.env.LAI_E2E_DJANGO_PORT ?? '8765'}`,
    },
  },
);
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    vite.kill(signal);
  });
}
vite.on('exit', (code) => {
  process.exit(code ?? 0);
});
