import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import styles from './IslandLocationPage.module.css';
import { IslandLayout } from '../features/island/IslandLayout';
import { getIslandLocation, isLocationUnlocked } from '../features/island/locations';
import { getHomeWorld } from '../features/worlds/worlds';
import { getAdventureTemplatesForLocation } from '../features/adventures/content';
import { listAllWorldChanges } from '../features/adventures/api';
import { getChildProfile } from '../features/child-profile/api';
import type { WorldChange } from '../features/adventures/api';
import type { ChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

export function IslandLocationPage() {
  const { childId, locationSlug } = useParams<{ childId: string; locationSlug: string }>();
  const location = locationSlug ? getIslandLocation(locationSlug) : undefined;
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

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId || !location) {
        setLoadState('not-found');
        return;
      }
      try {
        const [child, changes] = await Promise.all([
          getChildProfile(childId),
          listAllWorldChanges(childId),
        ]);
        if (cancelled) return;
        if (!child) {
          setLoadState('not-found');
          return;
        }
        setChildProfile(child);
        setAllWorldChanges(changes);
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
        <p>Loading the location...</p>
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
  const template = getAdventureTemplatesForLocation(location.slug)[0];
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
        {template && isAgeSupported ? (
          <Link
            className={styles.startLink}
            to={`/island/${childId}/locations/${location.slug}/adventures/${template.slug}`}
          >
            {isWorldChanged ? `Play "${template.title}" again` : `Start: ${template.title}`}
          </Link>
        ) : null}
        {template && !isAgeSupported ? (
          <p className={styles.decoration}>This adventure is not available for your age yet.</p>
        ) : null}
        {location.slug === 'pirate-builder-bay' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/pirate-builder-bay`}>
            Try walking around the bay (new!)
          </Link>
        ) : null}
        {location.slug === 'pirate-builder-bay' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/pirate-builder-bay-3d`}>
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
          <Link className={styles.startLink} to={`/island/${childId}/world/wonderwild-forest-3d`}>
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
        {location.slug === 'storykeeper-castle' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/storykeeper-castle`}>
            Try exploring the castle (new!)
          </Link>
        ) : null}
        {location.slug === 'storykeeper-castle' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/storykeeper-castle-3d`}>
            Peek at an early 3D preview (new!)
          </Link>
        ) : null}
        {location.slug === 'dragons-sanctuary' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/dragons-sanctuary`}>
            Try exploring the sanctuary (new!)
          </Link>
        ) : null}
        {location.slug === 'fossil-ridge-camp' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/fossil-ridge-camp`}>
            Try exploring the camp (new!)
          </Link>
        ) : null}
        {location.slug === 'castle-writing-room' ? (
          <Link className={styles.walkLink} to={`/island/${childId}/world/castle-writing-room`}>
            Try exploring the room (new!)
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
