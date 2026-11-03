import { useMatch } from 'react-router-dom';
import { useChildAudioPreferences } from './useChildAudioPreferences';

function Active({ childId }: { childId: string }) {
  useChildAudioPreferences(childId);
  return null;
}

/**
 * Renders nothing. Inside the router, it applies the audio mix of the child whose island is open
 * (`/island/:childId/...`), which covers every adventure and game a child can be in. Outside the
 * island nothing is mounted, so the Sound Manager is not even created on the account pages.
 */
export function ChildAudioPreferencesSync() {
  const match = useMatch('/island/:childId/*');
  const childId = match?.params.childId;
  return childId ? <Active childId={childId} /> : null;
}
