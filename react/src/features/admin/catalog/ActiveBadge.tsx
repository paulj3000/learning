import { Badge } from '../ui/Badge';

/** "Active" / "Inactive" for an island or adventure catalog record. */
export function ActiveBadge({ active }: { active: boolean }) {
  return <Badge variant={active ? 'secondary' : 'outline'}>{active ? 'Active' : 'Inactive'}</Badge>;
}
