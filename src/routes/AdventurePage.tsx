import { Link, useParams } from 'react-router-dom';
import { IslandLayout } from '../features/island/IslandLayout';
import { AdventureRunner } from '../features/adventures/AdventureRunner';
import { getAdventureTemplate } from '../features/adventures/content';

export function AdventurePage() {
  const { childId, locationSlug, templateSlug } = useParams<{
    childId: string;
    locationSlug: string;
    templateSlug: string;
  }>();

  if (!childId || !locationSlug) {
    return null;
  }

  const definition = templateSlug ? getAdventureTemplate(templateSlug) : undefined;

  if (!definition || definition.locationSlug !== locationSlug) {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">We could not find that adventure.</p>
        <Link to={`/island/${childId}/locations/${locationSlug}`}>Back to the location</Link>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <AdventureRunner
        childProfileId={childId}
        definition={definition}
        backToMapHref={`/island/${childId}/locations/${locationSlug}`}
      />
    </IslandLayout>
  );
}
