import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styles from './IslandLocationPage.module.css';
import { IslandLayout } from '../features/island/IslandLayout';
import { getIslandLocation, isLocationUnlocked } from '../features/island/locations';
import { getHomeWorld } from '../features/worlds/worlds';
import {
  getAdventureTemplatesForLocation,
  resolveAdventureForAgeBand,
} from '../features/adventures/content';
import { listAllWorldChanges } from '../features/adventures/api';
import { isIslandAvailable } from '../features/catalog/availability';
import { loadCatalogSnapshot } from '../features/catalog/availabilityApi';
import { getChildProfile } from '../features/child-profile/api';
import type { WorldChange } from '../features/adventures/api';
import type { ChildProfile } from '../features/child-profile/api';
import { locationWorldPath } from '../features/island-map/three/runtime/locationWorldPath';
import { WRITING_ROOM_WRITE_PATH } from '../features/island-map/worldObjects';
import { WRITING_ROOM_LOCATION_SLUG } from '../features/adventures/content/writingRoomStories';
import { usePlaceArea } from '../features/region-play/usePlaceArea';
import {
  CASTLE_WRITING_ROOM_REGION_ID,
  DRAGONS_SANCTUARY_REGION_ID,
  FOSSIL_RIDGE_CAMP_REGION_ID,
  PIRATE_BUILDER_BAY_REGION_ID,
  STORYKEEPER_CASTLE_REGION_ID,
  WONDERWILD_FOREST_REGION_ID,
} from '../features/discovery/checkpoints';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

export function IslandLocationPage() {
  const { childId, locationSlug } = useParams<{ childId: string; locationSlug: string }>();
  const location = locationSlug ? getIslandLocation(locationSlug) : undefined;
  /** This Place's published 3D Area from Django, if any (ADR-041); exploring comes first. */
  const area = usePlaceArea(childId, locationSlug);
  /**
   * Phase 29: "back to the map" has to mean the map this place is actually
   * on. Sending a child standing at the cove back to the home harbor would
   * quietly teleport them across the sea.
   */
  const backTo =
    !location || location.worldSlug === getHomeWorld().slug
      ? `/island/${childId ?? ''}`
      : `/island/${childId ?? ''}/worlds/${location.worldSlug}`;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);
  const [allWorldChanges, setAllWorldChanges] = useState<WorldChange[]>([]);
  const [isAvailable, setIsAvailable] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId || !location) {
        setLoadState('not-found');
        return;
      }
      try {
        const [child, changes, catalog] = await Promise.all([
          getChildProfile(childId),
          listAllWorldChanges(childId),
          loadCatalogSnapshot(childId),
        ]);
        if (cancelled) return;
        if (!child) {
          setLoadState('not-found');
          return;
        }
        setChildProfile(child);
        setAllWorldChanges(changes);
        setIsAvailable(isIslandAvailable(catalog, location.slug));
        setLoadState('ready');
      } catch {
        if (cancelled) return;
        setLoadState('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
    // location is derived from locationSlug and is stable for a given slug
  }, [childId, location, locationSlug]);

  if (!childId) {
    return null;
  }

  if (!location) {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">We could not find that part of the island.</p>
        <Link className={styles.backLink} to={backTo}>
          Back to the map
        </Link>
      </IslandLayout>
    );
  }

  if (loadState === 'loading') {
    return (
      <IslandLayout childId={childId}>
        <p>Loading this place...</p>
      </IslandLayout>
    );
  }
  if (loadState === 'not-found' || loadState === 'error' || !childProfile) {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong loading this part of the island.</p>
        <Link className={styles.backLink} to={backTo}>
          Back to the map
        </Link>
      </IslandLayout>
    );
  }

  const worldChangeKeys = allWorldChanges.map((change) => change.changeKey);
  if (!isAvailable) {
    // Deactivated by an admin (ADR-031): a bookmarked URL still lands somewhere calm.
    return (
      <IslandLayout childId={childId}>
        <div className={styles.content}>
          <p className={styles.decoration}>
            This part of the island is resting right now. Let us explore somewhere else.
          </p>
          <Link className={styles.backLink} to={backTo}>
            Back to the map
          </Link>
        </div>
      </IslandLayout>
    );
  }

  if (!isLocationUnlocked(location, worldChangeKeys)) {
    return (
      <IslandLayout childId={childId}>
        <div className={styles.content}>
          <p className={styles.decoration}>
            This part of the island has not been discovered yet. Maybe a new story will lead you
            here.
          </p>
          <Link className={styles.backLink} to={backTo}>
            Back to the map
          </Link>
        </div>
      </IslandLayout>
    );
  }

  const worldChanges = allWorldChanges.filter((change) => change.locationSlug === location.slug);
  /*
    #99: the adventure this child's band is offered here. A Place can hold one template per band
    (the castle: Quill's Picture Story for Sprouts, the Storykeeper's Tale for Pathfinders; the
    Writing Room: one story per band). Taking the first template told every other band "not
    available for your age yet" even though their own adventure was right there. The first one
    is still used when no template fits, so that message stays honest.
  */
  const firstTemplate = getAdventureTemplatesForLocation(location.slug)[0];
  const template = firstTemplate
    ? (resolveAdventureForAgeBand(location.slug, firstTemplate.slug, childProfile.ageBand) ??
      firstTemplate)
    : undefined;
  const isAgeSupported = template ? template.ageBands.includes(childProfile.ageBand) : false;
  const worldChangeStep = template?.steps.find((step) => step.type === 'WORLD_CHANGE');
  const worldChangePresentation =
    worldChangeStep?.presentation.kind === 'world-change'
      ? worldChangeStep.presentation
      : undefined;
  const isWorldChanged = worldChangePresentation
    ? worldChanges.some((change) => change.changeKey === worldChangePresentation.payload.changeKey)
    : false;

  return (
    <IslandLayout childId={childId}>
      <div className={styles.content}>
        <h1 className={styles.heading}>{location.title}</h1>
        <p className={styles.tagline}>{location.tagline}</p>
        <p className={styles.description}>{location.description}</p>
        <ul className={styles.skills}>
          {location.skills.map((skill) => (
            <li className={styles.skill} key={skill}>
              {skill}
            </li>
          ))}
        </ul>
        <p className={styles.decoration}>
          {isWorldChanged && worldChangePresentation
            ? worldChangePresentation.text
            : location.decoration}
        </p>
        {area?.available ? (
          <Link className={styles.startLink} to={locationWorldPath(childId, area.regionId)}>
            Explore {area.title}
          </Link>
        ) : null}
        {/*
          #99: the 3D castle is the castle's front door, as the forest's is (WF-2). Storykeeper
          Castle has no Django 3D Area (its layout is a bundled manifest, ADR-033), so the
          `area` link above never appears for it, and until now the only way in was a link
          labelled as a preview. Sprouts keep the card route first (contract C-10, ADR-008)
          until SC-R11's playtest; they still have the 3D castle as a plainly worded option.
        */}
        {location.slug === 'storykeeper-castle' && childProfile.ageBand !== 'SPROUT' ? (
          <Link
            className={styles.startLink}
            to={locationWorldPath(childId, STORYKEEPER_CASTLE_REGION_ID)}
          >
            Enter the castle
          </Link>
        ) : null}
        {template && isAgeSupported ? (
          <Link
            className={styles.startLink}
            to={
              location.slug === WRITING_ROOM_LOCATION_SLUG
                ? // SC-final-B: the Writing Room's stories have their own tap and typing page.
                  `/island/${childId}/${WRITING_ROOM_WRITE_PATH}`
                : `/island/${childId}/locations/${location.slug}/adventures/${template.slug}`
            }
          >
            {location.slug === WRITING_ROOM_LOCATION_SLUG
              ? 'Write a story'
              : isWorldChanged
                ? `Play "${template.title}" again`
                : `Start: ${template.title}`}
          </Link>
        ) : null}
        {template && !isAgeSupported && location.slug === 'storykeeper-castle' ? (
          // #99: an Explorer's castle adventure (the Secret Door) starts inside, in the Great
          // Library, so "not available" would wrongly say there is nothing here for them.
          <p className={styles.decoration}>
            Your castle adventure is inside. Look for the secret door in the Great Library.
          </p>
        ) : null}
        {template && !isAgeSupported && location.slug !== 'storykeeper-castle' ? (
          <p className={styles.decoration}>This adventure is not available for your age yet.</p>
        ) : null}
        {location.slug === 'pirate-builder-bay' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/pirate-builder-bay`}>
            Try walking around the bay (new!)
          </Link>
        ) : null}
        {location.slug === 'pirate-builder-bay' ? (
          <Link
            className={styles.walkLink}
            to={locationWorldPath(childId, PIRATE_BUILDER_BAY_REGION_ID)}
          >
            Peek at an early 3D preview (new!)
          </Link>
        ) : null}
        {/*
          Wonderwild Forest is the first region whose 3D route is the **front
          door** rather than a preview (`docs/WONDERWILD_FOREST_3D_ROADMAP.md`
          WF-2). Pathfinders and Explorers get it first and unlabelled; the
          card-based route stays available underneath, for them and as the
          default for Sprouts.

          Sprouts are the exception ADR-008 requires: first-person navigation
          is not their primary route until the accessibility playtest owed
          from Phase 32 has run, and the shrink into the beehive makes that
          gate matter more here than it did in the castle. Nothing is retired
          for any band before WF-10 - this changes which route is offered
          first, not which routes exist.
        */}
        {location.slug === 'wonderwild-forest' && childProfile.ageBand !== 'SPROUT' ? (
          <Link
            className={styles.startLink}
            to={locationWorldPath(childId, WONDERWILD_FOREST_REGION_ID)}
          >
            Walk into the forest
          </Link>
        ) : null}
        {location.slug === 'wonderwild-forest' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/wonderwild-forest`}>
            {childProfile.ageBand === 'SPROUT'
              ? 'Try exploring the forest (new!)'
              : 'Explore the forest from above instead'}
          </Link>
        ) : null}
        {location.slug === 'storykeeper-castle' && childProfile.ageBand === 'SPROUT' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/storykeeper-castle`}>
            Try exploring the castle (new!)
          </Link>
        ) : null}
        {location.slug === 'storykeeper-castle' && childProfile.ageBand === 'SPROUT' ? (
          <Link
            className={styles.walkLink}
            to={locationWorldPath(childId, STORYKEEPER_CASTLE_REGION_ID)}
          >
            Walk inside the castle
          </Link>
        ) : null}
        {location.slug === 'storykeeper-castle' && childProfile.ageBand !== 'SPROUT' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/storykeeper-castle`}>
            Explore the castle from above instead
          </Link>
        ) : null}
        {location.slug === 'dragons-sanctuary' ? (
          <Link
            className={styles.walkLink}
            to={locationWorldPath(childId, DRAGONS_SANCTUARY_REGION_ID)}
          >
            Try exploring the sanctuary (new!)
          </Link>
        ) : null}
        {location.slug === 'fossil-ridge-camp' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/fossil-ridge-camp`}>
            Try exploring the camp (new!)
          </Link>
        ) : null}
        {/*
          LAI-2206: the 3D camp, as a preview beside the Phaser camp. Sprouts are not offered
          it until the guided tap-to-walk profile (LAI-2104S) lands; the 3D view itself
          applies the same unlock guard as this page.
        */}
        {location.slug === 'fossil-ridge-camp' && childProfile.ageBand !== 'SPROUT' ? (
          <Link
            className={styles.walkLink}
            to={locationWorldPath(childId, FOSSIL_RIDGE_CAMP_REGION_ID)}
          >
            Peek at the 3D camp (preview)
          </Link>
        ) : null}
        {location.slug === 'castle-writing-room' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/castle-writing-room`}>
            Try exploring the room (new!)
          </Link>
        ) : null}
        {location.slug === 'castle-writing-room' ? (
          <Link
            className={styles.walkLink}
            to={locationWorldPath(childId, CASTLE_WRITING_ROOM_REGION_ID)}
          >
            Try the 3D room (preview)
          </Link>
        ) : null}
        {location.slug === 'bolts-workshop' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/bolts-workshop`}>
            Try exploring the workshop (new!)
          </Link>
        ) : null}
        <Link className={styles.backLink} to={backTo}>
          Back to the map
        </Link>
      </div>
    </IslandLayout>
  );
}
