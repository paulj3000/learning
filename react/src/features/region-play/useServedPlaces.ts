import { useEffect, useState } from 'react';
import { getIslandsFor, type IslandsView } from '../../api/play/islandsApi';
import { ISLAND_LOCATIONS } from '../island/locations';

/**
 * Places that exist only in Django (ADR-047: Django is authoritative for published content), with
 * a published 3D Area for this child, on the home Island. Firepeak Volcano is the first. The
 * source-controlled Places keep their own cards and pages; these get a card that goes straight
 * to their 3D Area, since they have no source Place page.
 *
 * Empty while loading, in a build without the Django API, and on any error: the harbor map works
 * exactly as before without them. Age bands are the server's: a 3D Area not for this child's band
 * is not listed by the islands API at all.
 */
export interface ServedPlace {
  placeId: string;
  title: string;
  tagline: string;
  regionId: string;
}

export function servedPlaces(view: IslandsView): ServedPlace[] {
  const known = new Set(ISLAND_LOCATIONS.map((location) => location.slug));
  return view.islands
    .filter((island) => island.isHome)
    .flatMap((island) => island.places)
    .filter((place) => !known.has(place.placeId) && place.area?.available)
    .map((place) => ({
      placeId: place.placeId,
      title: place.title,
      tagline: place.tagline,
      regionId: place.area!.regionId,
    }));
}

export function useServedPlaces(
  childId: string | undefined,
  load: typeof getIslandsFor = getIslandsFor,
): ServedPlace[] {
  const [places, setPlaces] = useState<ServedPlace[]>([]);
  useEffect(() => {
    let cancelled = false;
    setPlaces([]);
    if (!childId) return undefined;
    load(childId)
      .then((view) => {
        if (!cancelled) setPlaces(servedPlaces(view));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [childId, load]);
  return places;
}
