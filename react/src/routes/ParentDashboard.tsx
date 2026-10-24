import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styles from './ParentDashboard.module.css';
import { UserMenu } from '../components/UserMenu';
import { ChildSwitcher } from '../features/child-profile/ChildSwitcher';
import { ChildProfileSummary } from '../features/child-profile/ChildProfileSummary';
import {
  getOrCreateParentProfile,
  listChildProfiles,
  setChildProfileActive,
} from '../features/child-profile/api';
import type { ChildProfile, ParentProfile } from '../features/child-profile/api';
import { listAllWorldChanges } from '../features/adventures/api';
import { listAllRegions } from '../features/island/regionOverview';
import { listDashboardSections } from '../features/parent-dashboard/dashboardSections';

type LoadState = 'loading' | 'ready' | 'error';

/**
 * The parent's home screen: pick a child in the header, then see the island
 * laid out as two lists, the places on it and the sections of this dashboard.
 *
 * Both lists are deliberately flat and complete for now. Child sign-in is
 * coming, and the dashboard's own sections are meant to become pages of their
 * own; until then a single visible list is easier to reason about than a
 * nested navigation that would have to be rebuilt anyway.
 */
export function ParentDashboard() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [parentProfile, setParentProfile] = useState<ParentProfile | null>(null);
  const [childProfiles, setChildProfiles] = useState<ChildProfile[]>([]);
  const [selectedChildId, setSelectedChildId] = useState<string | null>(null);
  /**
   * Kept with the child it was fetched for, so switching children cannot
   * briefly draw one child's unlocked places under another child's name.
   */
  const [worldChanges, setWorldChanges] = useState<{ childId: string; keys: string[] } | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const parent = await getOrCreateParentProfile();
        const children = await listChildProfiles();
        if (cancelled) return;
        setParentProfile(parent);
        setChildProfiles(children);
        setSelectedChildId(children[0]?.id ?? null);
        setLoadState('ready');
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Something went wrong.');
        setLoadState('error');
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * Which regions this child has opened. A failure here is not worth failing
   * the page over: the region list still renders, with nothing marked as
   * discovered, which is also what a brand new child profile looks like.
   */
  useEffect(() => {
    let cancelled = false;
    const childId = selectedChildId;
    if (!childId) return;

    void listAllWorldChanges(childId)
      .then((changes) => {
        if (!cancelled) setWorldChanges({ childId, keys: changes.map((c) => c.changeKey) });
      })
      .catch(() => {
        if (!cancelled) setWorldChanges({ childId, keys: [] });
      });

    return () => {
      cancelled = true;
    };
  }, [selectedChildId]);

  async function handleToggleActive(child: ChildProfile) {
    const updated = await setChildProfileActive(child.id, !child.active);
    setChildProfiles((current) => current.map((item) => (item.id === updated.id ? updated : item)));
  }

  const selectedChild = childProfiles.find((child) => child.id === selectedChildId) ?? null;
  const regions = listAllRegions(
    worldChanges && worldChanges.childId === selectedChildId ? worldChanges.keys : [],
  );
  const sections = selectedChild ? listDashboardSections(selectedChild.id) : [];

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div className={styles.headerLeft}>
          <p className={styles.brand}>Learning Adventure Island</p>
          {loadState === 'ready' ? (
            <ChildSwitcher
              childProfiles={childProfiles}
              selectedChildId={selectedChildId}
              onSelect={setSelectedChildId}
            />
          ) : null}
        </div>
        <UserMenu />
      </header>
      <main className={styles.main} id="main-content">
        {loadState === 'loading' ? <p>Loading your family&apos;s island...</p> : null}
        {loadState === 'error' ? (
          <p className={styles.error} role="alert">
            {error}
          </p>
        ) : null}
        {loadState === 'ready' ? (
          <div className={styles.dashboardContent}>
            <h1 className={styles.pageTitle}>
              {selectedChild
                ? `${selectedChild.nickname}'s dashboard`
                : `Welcome, ${parentProfile?.displayName ?? 'parent'}`}
            </h1>

            {selectedChild ? (
              <ChildProfileSummary
                childProfile={selectedChild}
                onToggleActive={handleToggleActive}
              />
            ) : (
              <p className={styles.hint}>
                Add a child profile to start exploring the island together.
              </p>
            )}

            <section className={styles.section} aria-labelledby="regions-heading">
              <h2 className={styles.heading} id="regions-heading">
                Island places
              </h2>
              <p className={styles.hint}>
                Everywhere on the island, including the places that are still secret.
              </p>
              <ul className={styles.list}>
                {regions.map((region) => (
                  <li className={styles.row} key={`${region.worldSlug}/${region.slug}`}>
                    <div className={styles.rowText}>
                      {selectedChild && region.unlocked ? (
                        <Link
                          className={styles.rowTitleLink}
                          to={`/island/${selectedChild.id}/locations/${region.slug}`}
                        >
                          {region.title}
                        </Link>
                      ) : (
                        <p className={styles.rowTitle}>{region.title}</p>
                      )}
                      <p className={styles.rowMeta}>{region.tagline}</p>
                    </div>
                    <p className={styles.rowStatus}>
                      {region.unlocked ? region.worldTitle : 'Not discovered yet'}
                    </p>
                  </li>
                ))}
              </ul>
            </section>

            {selectedChild ? (
              <section className={styles.section} aria-labelledby="sections-heading">
                <h2 className={styles.heading} id="sections-heading">
                  Dashboard sections
                </h2>
                <p className={styles.hint}>
                  Everything we can show you about {selectedChild.nickname}. These will become pages
                  of their own.
                </p>
                <ul className={styles.list}>
                  {sections.map((section) => (
                    <li className={styles.row} key={section.id}>
                      <div className={styles.rowText}>
                        <Link className={styles.rowTitleLink} to={section.to}>
                          {section.title}
                        </Link>
                        <p className={styles.rowMeta}>{section.description}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
        ) : null}
      </main>
    </div>
  );
}
