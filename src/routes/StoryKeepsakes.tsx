import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import parentStyles from './ParentDashboard.module.css';
import styles from './StoryKeepsakes.module.css';
import {
  deleteStoryArtifact,
  listStoryArtifacts,
  parseStoryScenes,
} from '../features/adventures/api';
import { getChildProfile } from '../features/child-profile/api';
import type { StoryArtifact } from '../features/adventures/api';
import type { ChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'not-found' | 'error';

function formatDate(isoDate: string): string {
  return new Date(isoDate).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Parent-facing view of every story a child has created in Storykeeper
 * Castle, with parent-controlled retention (docs/ROADMAP.md Phase 5):
 * a parent may permanently delete a saved story. There is no auto-expiry
 * policy yet, by design (see IMPLEMENTATION_STATUS.md "Decisions pending").
 */
export function StoryKeepsakes() {
  const { childId } = useParams<{ childId: string }>();
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);
  const [stories, setStories] = useState<StoryArtifact[]>([]);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) {
        setLoadState('not-found');
        return;
      }
      try {
        const [profile, artifacts] = await Promise.all([
          getChildProfile(childId),
          listStoryArtifacts(childId),
        ]);
        if (cancelled) return;
        if (!profile) {
          setLoadState('not-found');
          return;
        }
        setChildProfile(profile);
        setStories(artifacts);
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
  }, [childId]);

  async function handleDelete(id: string) {
    await deleteStoryArtifact(id);
    setStories((current) => current.filter((story) => story.id !== id));
    setPendingDeleteId(null);
  }

  return (
    <div className={parentStyles.page}>
      <header className={parentStyles.header}>
        <h1 className={parentStyles.title}>
          {childProfile ? `${childProfile.nickname}'s story keepsakes` : 'Story keepsakes'}
        </h1>
        <Link to="/parent">Back to dashboard</Link>
      </header>
      <main className={parentStyles.main} id="main-content">
        {loadState === 'loading' ? <p>Loading saved stories...</p> : null}
        {loadState === 'not-found' ? (
          <p role="alert">We could not find that child profile.</p>
        ) : null}
        {loadState === 'error' ? (
          <p className={parentStyles.error} role="alert">
            Something went wrong loading saved stories.
          </p>
        ) : null}
        {loadState === 'ready' && stories.length === 0 ? (
          <p className={styles.hint}>No stories saved yet.</p>
        ) : null}
        {loadState === 'ready' && stories.length > 0 ? (
          <ul className={styles.list}>
            {stories.map((story) => {
              const scenes = parseStoryScenes(story.scenes);
              return (
                <li className={styles.card} key={story.id}>
                  <p className={styles.cardTitle}>{story.title}</p>
                  <p className={styles.cardMeta}>
                    {formatDate(story.createdAt)} &middot; {scenes.length}{' '}
                    {scenes.length === 1 ? 'scene' : 'scenes'}
                  </p>
                  {scenes.map((scene) => (
                    <p className={styles.scene} key={scene.stepId}>
                      {scene.text}
                    </p>
                  ))}
                  <div className={styles.actions}>
                    {pendingDeleteId === story.id ? (
                      <div className={styles.confirm} role="alert">
                        <p className={styles.confirmText}>Delete this story for good?</p>
                        <button
                          className={styles.buttonDanger}
                          type="button"
                          onClick={() => void handleDelete(story.id)}
                        >
                          Yes, delete
                        </button>
                        <button
                          className={styles.buttonSecondary}
                          type="button"
                          onClick={() => setPendingDeleteId(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        className={styles.buttonDanger}
                        type="button"
                        onClick={() => setPendingDeleteId(story.id)}
                      >
                        Delete
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </main>
    </div>
  );
}
