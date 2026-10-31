import { useEffect, useState } from 'react';
import { areaForPlace, getIslandsFor, type PlaceArea } from '../../api/play/islandsApi';

/**
 * The published 3D Area of a Place for this child, from the Django API (ADR-041), or null while
 * loading, when there is none, in a build without the Django API, or on any error. A null
 * result only means "no Explore link": the Place page and its Adventures work without it.
 */
export function usePlaceArea(
  childId: string | undefined,
  placeSlug: string | undefined,
  load: typeof getIslandsFor = getIslandsFor,
): PlaceArea | null {
  const [area, setArea] = useState<PlaceArea | null>(null);
  useEffect(() => {
    let cancelled = false;
    setArea(null);
    if (!childId || !placeSlug) return undefined;
    load(childId)
      .then((view) => {
        if (!cancelled) setArea(areaForPlace(view, placeSlug));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [childId, placeSlug, load]);
  return area;
}
