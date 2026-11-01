import type { ValidationFinding } from '../../../api/assets/djangoAssetAdmin';

/** Django's validation findings for a refused or stored model, errors first. */
export function FindingsList({ findings }: { findings: readonly ValidationFinding[] }) {
  if (findings.length === 0) return null;
  const ordered = [...findings].sort(
    (a, b) => Number(b.severity === 'error') - Number(a.severity === 'error'),
  );
  return (
    <ul className="grid gap-1 text-sm" aria-label="Validation findings">
      {ordered.map((finding, index) => (
        <li key={`${finding.code}-${index}`}>
          <span className="font-medium">{finding.severity === 'error' ? 'Error' : 'Warning'}:</span>{' '}
          {finding.message}
        </li>
      ))}
    </ul>
  );
}
