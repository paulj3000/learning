import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import runnerStyles from '../features/adventures/AdventureRunner.module.css';
import { IslandLayout } from '../features/island/IslandLayout';
import { StoryChapterRunner } from '../features/story/StoryChapterRunner';
import { useStoryProgress } from '../features/story/useStoryProgress';
import { getStoryDefinition } from '../features/story/content';
import { buildStoryRecap } from '../features/story/recap';
import { getChildProfile } from '../features/child-profile/api';
import type { ChildProfile } from '../features/child-profile/api';

type LoadState = 'loading' | 'ready' | 'error';

export function StoryPage() {
  const { childId, storySlug } = useParams<{ childId: string; storySlug: string }>();
  const story = storySlug ? getStoryDefinition(storySlug) : undefined;
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [childProfile, setChildProfile] = useState<ChildProfile | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (!childId) return;
      try {
        const child = await getChildProfile(childId);
        if (cancelled) return;
        setChildProfile(child);
        setLoadState(child ? 'ready' : 'error');
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

  if (!childId) {
    return null;
  }

  const backToMapHref = `/island/${childId}`;

  if (!story) {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">We could not find that story.</p>
        <Link to={backToMapHref}>Back to the map</Link>
      </IslandLayout>
    );
  }

  if (loadState === 'loading') {
    return (
      <IslandLayout childId={childId}>
        <p>Loading your story...</p>
      </IslandLayout>
    );
  }

  if (loadState === 'error' || !childProfile) {
    return (
      <IslandLayout childId={childId}>
        <p role="alert">Something went wrong loading this story.</p>
        <Link to={backToMapHref}>Back to the map</Link>
      </IslandLayout>
    );
  }

  if (!story.supportedAgeBands.includes(childProfile.ageBand)) {
    return (
      <IslandLayout childId={childId}>
        <h1>{story.title}</h1>
        <p>This story is not available for your age yet.</p>
        <Link to={backToMapHref}>Back to the map</Link>
      </IslandLayout>
    );
  }

  return (
    <IslandLayout childId={childId}>
      <StoryPageContent
        childId={childId}
        childProfileId={childId}
        ageBand={childProfile.ageBand}
        aiEnabled={childProfile.aiEnabled ?? true}
        story={story}
        backToMapHref={backToMapHref}
      />
    </IslandLayout>
  );
}

interface StoryPageContentProps {
  childId: string;
  childProfileId: string;
  ageBand: ChildProfile['ageBand'];
  aiEnabled: boolean;
  story: NonNullable<ReturnType<typeof getStoryDefinition>>;
  backToMapHref: string;
}

function StoryPageContent({
  childId,
  childProfileId,
  ageBand,
  aiEnabled,
  story,
  backToMapHref,
}: StoryPageContentProps) {
  const { loadState, progress, chapter, flags, setFlag, completeChapter } = useStoryProgress(
    childProfileId,
    story,
  );

  if (loadState === 'loading') {
    return <p>Loading your story...</p>;
  }
  if (loadState === 'error' || !progress) {
    return <p role="alert">Something went wrong loading this story.</p>;
  }

  const recap = buildStoryRecap(story, progress);

  if (progress.completedAt) {
    return (
      <div className={runnerStyles.completeCard}>
        <h1 className={runnerStyles.completeHeading}>Story complete!</h1>
        {recap.map((line) => (
          <p key={line} className={runnerStyles.completeText}>
            {line}
          </p>
        ))}
        <Link to={backToMapHref}>Back to the map</Link>
      </div>
    );
  }

  if (!chapter) {
    return <p>Saving your progress in the story...</p>;
  }

  return (
    <div className={runnerStyles.page}>
      <h1>{story.title}</h1>
      <div className={runnerStyles.storyRecap}>
        {recap.map((line) => (
          <p key={line} className={runnerStyles.storyRecapText}>
            {line}
          </p>
        ))}
      </div>
      <StoryChapterRunner
        childProfileId={childProfileId}
        ageBand={ageBand}
        aiEnabled={aiEnabled}
        storyProgressId={progress.id}
        chapter={chapter}
        flags={flags}
        backToStoryHref={`/island/${childId}/stories/${story.slug}`}
        onFlag={setFlag}
        onChapterComplete={completeChapter}
      />
    </div>
  );
}
