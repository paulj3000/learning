/**
 * A small semver range check, written by hand (no new dependency). It supports what an
 * `engineApi` range needs: exact versions, `^`, `~`, `>=`, `>`, `<=`, `<`, `=`, `*`/`x`,
 * space-separated comparators (AND) and `||` alternatives. Pre-release tags are not supported:
 * a version or range containing one is invalid.
 */

export type SemverTuple = readonly [number, number, number];

const VERSION = /^(\d+)\.(\d+)\.(\d+)$/;
const PARTIAL = /^(\d+|[xX*])(?:\.(\d+|[xX*]))?(?:\.(\d+|[xX*]))?$/;

export function parseSemver(version: string): SemverTuple | null {
  const match = VERSION.exec(version.trim());
  return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null;
}

export function compareSemver(a: SemverTuple, b: SemverTuple): number {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) {
      return a[i]! < b[i]! ? -1 : 1;
    }
  }
  return 0;
}

type Comparator = { op: '>=' | '>' | '<=' | '<' | '='; version: SemverTuple };

function isWildcard(part: string | undefined): boolean {
  return part === undefined || part === 'x' || part === 'X' || part === '*';
}

/** Parses one token such as `^0.1.0`, `>=1.2`, `0.x` into comparators, or null when invalid. */
function parseToken(token: string): Comparator[] | null {
  if (token === '*' || token === 'x' || token === 'X') {
    return [];
  }
  const prefixMatch = /^(\^|~|>=|<=|>|<|=)?(.+)$/.exec(token);
  if (!prefixMatch) {
    return null;
  }
  const prefix = prefixMatch[1] ?? '';
  const partial = PARTIAL.exec(prefixMatch[2]!);
  if (!partial) {
    return null;
  }
  const [, majorRaw, minorRaw, patchRaw] = partial;
  if (isWildcard(majorRaw)) {
    return [];
  }
  const major = Number(majorRaw);
  const minorWild = isWildcard(minorRaw);
  const patchWild = isWildcard(patchRaw);
  const minor = minorWild ? 0 : Number(minorRaw);
  const patch = patchWild ? 0 : Number(patchRaw);
  const base: SemverTuple = [major, minor, patch];

  if (prefix === '^') {
    const upper: SemverTuple =
      major > 0 || minorWild ? [major + 1, 0, 0] : minor > 0 || patchWild ? [0, minor + 1, 0] : [0, 0, patch + 1];
    return [
      { op: '>=', version: base },
      { op: '<', version: upper },
    ];
  }
  if (prefix === '~') {
    const upper: SemverTuple = minorWild ? [major + 1, 0, 0] : [major, minor + 1, 0];
    return [
      { op: '>=', version: base },
      { op: '<', version: upper },
    ];
  }
  if (prefix === '' || prefix === '=') {
    if (minorWild) {
      return [
        { op: '>=', version: base },
        { op: '<', version: [major + 1, 0, 0] },
      ];
    }
    if (patchWild) {
      return [
        { op: '>=', version: base },
        { op: '<', version: [major, minor + 1, 0] },
      ];
    }
    return [{ op: '=', version: base }];
  }
  return [{ op: prefix as Comparator['op'], version: base }];
}

function parseRange(range: string): Comparator[][] | null {
  const parsed: Comparator[][] = [];
  for (const alternative of range.split('||').map((part) => part.trim())) {
    if (alternative === '') {
      return null;
    }
    const comparators: Comparator[] = [];
    // Allow ">= 1.0.0" (operator then space) by joining a bare operator to its operand.
    const tokens = alternative.replace(/(\^|~|>=|<=|>|<|=)\s+/g, '$1').split(/\s+/);
    for (const token of tokens) {
      const result = parseToken(token);
      if (!result) {
        return null;
      }
      comparators.push(...result);
    }
    parsed.push(comparators);
  }
  return parsed;
}

export function isValidRange(range: unknown): range is string {
  return typeof range === 'string' && parseRange(range) !== null;
}

/** True when `version` (x.y.z) satisfies `range`. An invalid version or range never satisfies. */
export function satisfiesRange(version: string, range: string): boolean {
  const target = parseSemver(version);
  const alternatives = typeof range === 'string' ? parseRange(range) : null;
  if (!target || !alternatives) {
    return false;
  }
  return alternatives.some((comparators) =>
    comparators.every(({ op, version: bound }) => {
      const cmp = compareSemver(target, bound);
      switch (op) {
        case '>=':
          return cmp >= 0;
        case '>':
          return cmp > 0;
        case '<=':
          return cmp <= 0;
        case '<':
          return cmp < 0;
        default:
          return cmp === 0;
      }
    }),
  );
}
