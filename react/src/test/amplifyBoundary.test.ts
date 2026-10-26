import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * LAI-0501B: React reaches Amplify only through `react/src/api/`, plus a
 * short, named list of intentional exceptions. A new direct import anywhere
 * else fails here, so feature code cannot quietly bypass the backend
 * selection (and, on a Django build, quietly use Amplify).
 */

const SRC = resolve(__dirname, '..');

/** Files outside `api/` that may import Amplify, and why. */
const INTENTIONAL_EXCEPTIONS: Record<string, string> = {
  'lib/amplify-config.ts': 'Configures Amplify itself (Cognito is the identity provider on both backends)',
  'lib/data-client.ts': 'Creates the Amplify Data client the adapters use',
  'features/admin/api.ts': 'Admin section stays on Amplify until LAI-0802 (Django Admin replaces it, ADR-034)',
  'features/admin/catalogApi.ts': 'Admin catalog (ADR-031), staff only, Amplify until LAI-0802',
  'features/assets/assetService.ts': 'Admin model assets (ADR-030); gameplay reads use the Django resolver',
  'features/assets/modelUpload.ts': 'Admin model uploads; Django uploads go through Django Admin (ADR-035)',
};

const AMPLIFY_IMPORT = /from\s+['"](aws-amplify(?:\/[^'"]*)?|(?:\.\.?\/)+(?:lib\/)?data-client)['"]/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name) ? [path] : [];
  });
}

function directAmplifyImporters(): string[] {
  return sourceFiles(SRC)
    .map((path) => relative(SRC, path).split('\\').join('/'))
    .filter((path) => AMPLIFY_IMPORT.test(readFileSync(join(SRC, path), 'utf8')));
}

describe('Amplify access boundary (LAI-0501B)', () => {
  it('only react/src/api/ and the named exceptions import Amplify', () => {
    const outside = directAmplifyImporters().filter(
      (path) => !path.startsWith('api/') && !(path in INTENTIONAL_EXCEPTIONS),
    );
    expect(outside).toEqual([]);
  });

  it('keeps Amplify Data and Storage inside the Amplify adapters', () => {
    const inApi = directAmplifyImporters().filter((path) => path.startsWith('api/'));
    const unexpected = inApi.filter((path) => {
      if (path.startsWith('api/amplify/')) return false;
      const source = readFileSync(join(SRC, path), 'utf8');
      // `auth.ts` owns Amplify Auth; the two LAI-0501A profile modules keep
      // their Amplify implementation beside the Django one.
      if (path === 'api/auth.ts') return /aws-amplify\/(data|storage)/.test(source);
      return !['api/children.ts', 'api/parents.ts'].includes(path);
    });
    expect(unexpected).toEqual([]);
  });

  it('lists only exceptions that still exist and still import Amplify', () => {
    const importers = new Set(directAmplifyImporters());
    expect(Object.keys(INTENTIONAL_EXCEPTIONS).filter((path) => !importers.has(path))).toEqual([]);
  });
});
