// Starts `vite --mode e2e` for the acceptance suites with a synthetic amplify_outputs.json.
//
// The app reads Cognito settings from the gitignored repository-root amplify_outputs.json. A
// synthetic one (marked `_laiE2E`) points Amplify at the local e2e pool that
// tests/e2e/django_server.py trusts; tokens are minted by the tests, so Amplify never calls AWS.
// A real file is never overwritten: the run stops instead. The synthetic file is removed on exit.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const reactDir = resolve(here, '../../..');
const outputsPath = resolve(reactDir, '../amplify_outputs.json');
const port = process.env.LAI_E2E_VITE_PORT ?? '5175';

if (existsSync(outputsPath) && !JSON.parse(readFileSync(outputsPath, 'utf8'))._laiE2E) {
  console.error('A real amplify_outputs.json exists; refusing to replace it for the e2e run.');
  process.exit(1);
}
writeFileSync(
  outputsPath,
  JSON.stringify({
    _laiE2E: true,
    version: '1.3',
    auth: {
      aws_region: 'us-east-1',
      user_pool_id: 'us-east-1_E2Elocal',
      user_pool_client_id: 'e2elocalclient',
      username_attributes: ['email'],
      standard_required_attributes: ['email'],
      user_verification_types: ['email'],
      unauthenticated_identities_enabled: false,
      mfa_configuration: 'NONE',
      password_policy: { min_length: 8 },
    },
  }),
);

const cleanup = () => {
  if (existsSync(outputsPath) && JSON.parse(readFileSync(outputsPath, 'utf8'))._laiE2E) {
    rmSync(outputsPath);
  }
};
const vite = spawn(
  'npx',
  ['vite', '--mode', 'e2e', '--port', port, '--strictPort', '--host', '127.0.0.1'],
  {
    cwd: reactDir,
    stdio: 'inherit',
    env: {
      ...process.env,
      VITE_BACKEND: 'django',
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
  cleanup();
  process.exit(code ?? 0);
});
