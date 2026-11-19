import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { awardEntry, enabledSummary } from './fixtures';
import { AchievementList } from './AchievementList';
import { AdventureResults } from './AdventureResults';
import { CoinCounter } from './CoinCounter';
import { LearningPointsBadge } from './LearningPointsBadge';
import { PersonalBest } from './PersonalBest';
import { ProgressionSummary } from './ProgressionSummary';
import { ScoreNotification } from './ScoreNotification';
import { StarRating } from './StarRating';
import { TrophyShelf } from './TrophyShelf';
import { XpLevelIndicator } from './XpLevelIndicator';
import { DISABLED_SUMMARY } from './types';
import type { PendingEntry } from './pendingAwards';

const FORBIDDEN = /-\d|leaderboard|rank|vs\.|time left|countdown|seconds|buy|shop|purchase|spend|lost|failed|you have none/i;

function mockMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockReturnValue({ matches: reduce }) as unknown as typeof window.matchMedia;
}
afterEach(() => vi.restoreAllMocks());

describe('scoring components', () => {
  it('render nothing when scoring is disabled', () => {
    const { container } = render(
      <>
        <XpLevelIndicator summary={DISABLED_SUMMARY} />
        <LearningPointsBadge summary={DISABLED_SUMMARY} />
        <CoinCounter summary={DISABLED_SUMMARY} />
        <AchievementList summary={DISABLED_SUMMARY} />
        <TrophyShelf summary={DISABLED_SUMMARY} />
        <ProgressionSummary summary={DISABLED_SUMMARY} />
        <AdventureResults adventure={null} />
        <PersonalBest best={null} />
      </>,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('shows level progress with aria values', () => {
    render(<XpLevelIndicator summary={enabledSummary()} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '300');
    expect(bar).toHaveAttribute('aria-valuemax', '1000');
    expect(screen.getByText('Level 2')).toBeInTheDocument();
  });

  it('shows the top level without a bar', () => {
    render(
      <XpLevelIndicator
        summary={enabledSummary({ level: { level: 10, xp: 9000, levelFloorXp: 9000, nextLevelXp: null } })}
      />,
    );
    expect(screen.getByText('Top level reached')).toBeInTheDocument();
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows learning points and coins as treasure found', () => {
    render(
      <>
        <LearningPointsBadge summary={enabledSummary()} />
        <CoinCounter summary={enabledSummary()} />
      </>,
    );
    expect(screen.getByText(/Learning Points/)).toHaveTextContent('350');
    expect(screen.getByText(/Treasure found/)).toHaveTextContent('20 coins');
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('gives stars a text alternative', () => {
    render(<StarRating stars={2} maxStars={3} />);
    expect(screen.getByRole('img', { name: '2 of 3 stars' })).toBeInTheDocument();
  });

  it('uses encouraging empty states', () => {
    const { container } = render(
      <>
        <AchievementList summary={enabledSummary()} />
        <TrophyShelf summary={enabledSummary()} />
      </>,
    );
    expect(screen.getByText(/waiting on the island/)).toBeInTheDocument();
    expect(screen.getByText(/room on the shelf/)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(FORBIDDEN);
  });

  it('lists achievements and trophies', () => {
    const s = enabledSummary({
      achievements: [{ itemId: 'i', displayName: 'Lava Jumper', description: 'Bold.', acquiredAt: 'x' }],
      trophies: [{ setId: 's', displayName: 'Crystal Collector', itemId: 'i2', acquiredAt: 'x' }],
    });
    render(
      <>
        <AchievementList summary={s} />
        <TrophyShelf summary={s} />
      </>,
    );
    expect(screen.getByText('Lava Jumper')).toBeInTheDocument();
    expect(screen.getByText('Crystal Collector')).toBeInTheDocument();
  });

  it('shows a private personal best and adventure results', () => {
    const s = enabledSummary();
    const { container } = render(<AdventureResults adventure={s.adventures[0]} />);
    expect(screen.getByText('Your best visit: 300 XP')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '2 of 3 stars' })).toBeInTheDocument();
    expect(container.textContent).not.toMatch(FORBIDDEN);
  });

  it('composes the progression summary without forbidden copy', () => {
    const { container } = render(<ProgressionSummary summary={enabledSummary()} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(container.textContent).not.toMatch(FORBIDDEN);
    expect(container.textContent).not.toContain('—');
  });
});

describe('ScoreNotification', () => {
  const pending: PendingEntry = {
    id: 'p1',
    claimType: 'AWARD_CLAIM',
    hint: { sourceKinds: ['LOCATION_FIRST_VISIT'], sourceRef: 'x', sourceRefSuffix: null },
    createdAtMs: 0,
  };

  it('is a polite live region, pending without numbers, confirmed with server amount', () => {
    mockMotion(false);
    const { container } = render(
      <ScoreNotification
        pending={[pending]}
        confirmed={[{ award: awardEntry({ id: 'a9', amount: 50 }), pendingId: null }]}
      />,
    );
    expect(screen.getByRole('status')).toHaveAttribute('aria-live', 'polite');
    expect(screen.getByText('Checking...')).toBeInTheDocument();
    expect(screen.getByText('+50 XP')).toBeInTheDocument();
    expect(screen.getByText('Checking...').textContent).not.toMatch(/\d/);
    expect(container.textContent).not.toMatch(FORBIDDEN);
  });

  it('replaces a settled pending entry and never shows corrections', () => {
    mockMotion(false);
    render(
      <ScoreNotification
        pending={[pending]}
        confirmed={[
          { award: awardEntry({ id: 'a1' }), pendingId: 'p1' },
          { award: awardEntry({ id: 'c1', entryKind: 'CORRECTION', amount: -5 }), pendingId: null },
        ]}
      />,
    );
    expect(screen.queryByText('Checking...')).toBeNull();
    expect(screen.getByText('+50 XP')).toBeInTheDocument();
    expect(screen.queryByText(/-5/)).toBeNull();
  });

  it('uses no animation class when reduced motion is preferred', () => {
    mockMotion(true);
    render(<ScoreNotification pending={[pending]} confirmed={[]} />);
    expect(screen.getByRole('status')).toHaveAttribute('data-motion', 'reduced');
    expect(screen.getByText('Checking...').className).not.toMatch(/Animated/i);
  });

  it('animates otherwise', () => {
    mockMotion(false);
    render(<ScoreNotification pending={[pending]} confirmed={[]} />);
    expect(screen.getByText('Checking...').className).toMatch(/Animated/i);
  });
});
