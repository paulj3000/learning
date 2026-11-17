import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import {
  storybookProgress,
  visibleEntries,
  type StorybookState,
} from '../../../../great-storybook/pages';
import type { GreatStorybook } from '../../../../great-storybook/useGreatStorybook';
import { StorybookSection } from './StorybookSection';

const book = (
  state: StorybookState,
  band: 'SPROUT' | 'PATHFINDER' | 'EXPLORER' = 'PATHFINDER',
): GreatStorybook => {
  const progress = storybookProgress(state, band);
  return { progress, entries: visibleEntries(progress), status: 'local', retry: vi.fn() };
};

const NOTHING: StorybookState = { worldChangeKeys: [], discoveryIds: [] };
const TOLD: StorybookState = {
  worldChangeKeys: ['FIRST_STORY_TOLD', 'STUDIO_PAGE_MENDED'],
  discoveryIds: [],
};

const setup = (storybook: GreatStorybook, access: 'ok' | 'here' | 'no' = 'ok') => {
  const onGo = vi.fn();
  render(<StorybookSection storybook={storybook} access={() => access} onGo={onGo} />);
  return { onGo };
};

describe('StorybookSection', () => {
  it('says how many missing pages are back, in words and in a progress element', () => {
    setup(book(NOTHING));
    expect(screen.getByText('0 of 2 missing pages are back.')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: /missing pages that are back/i });
    expect(bar).toHaveAttribute('max', '2');
    expect(bar).toHaveAttribute('value', '0');
  });

  it('says the book is whole when every required page is back', () => {
    setup(book(TOLD));
    expect(screen.getByText('The Great Storybook is whole again.')).toBeInTheDocument();
  });

  it('shows a missing page with where to look, and a way to go there', () => {
    const { onGo } = setup(book(NOTHING));
    const item = screen.getByText('The First Story').closest('li')!;
    expect(
      within(item).getByText(/Missing\. Not found yet\. Tell a story with Keeper Quill in the Story Hall\./),
    ).toBeInTheDocument();
    fireEvent.click(within(item).getByRole('button', { name: /go to the story hall/i }));
    expect(onGo).toHaveBeenCalledWith('story-hall');
  });

  it('shows a page that is back as back, with nothing to do and no way to restore it again', () => {
    const { onGo } = setup(book(TOLD));
    const item = screen.getByText('The First Story').closest('li')!;
    expect(
      within(item).getByText(/Back in the book\. The story you told has flown back/),
    ).toBeInTheDocument();
    expect(within(item).queryByRole('button')).toBeNull();
    expect(onGo).not.toHaveBeenCalled();
  });

  it('says so, and offers no button, when the child is already in the right room', () => {
    setup(book(NOTHING), 'here');
    expect(screen.getAllByText('You are in the right place.')).toHaveLength(2);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('disables the way there when the castle will not take the child there now', () => {
    setup(book(NOTHING), 'no');
    expect(screen.getByRole('button', { name: /go to the story hall/i })).toBeDisabled();
  });

  it('lists the hidden bonus page only once it is found, never as an empty slot', () => {
    const { unmount } = render(
      <StorybookSection storybook={book(NOTHING)} access={() => 'ok'} onGo={() => undefined} />,
    );
    expect(screen.queryByText('The Hidden Page')).toBeNull();
    expect(document.body.textContent ?? '').not.toMatch(/hid(den|ing)/i);
    unmount();
    render(
      <StorybookSection
        storybook={book({ worldChangeKeys: [], discoveryIds: ['castle-tapestry-stair'] })}
        access={() => 'ok'}
        onGo={() => undefined}
      />,
    );
    expect(screen.getByText('The Hidden Page')).toBeInTheDocument();
    // Found, and still a bonus: the book is not whole because of it.
    expect(screen.getByText('0 of 2 missing pages are back.')).toBeInTheDocument();
  });

  it('shows each band only its own pages', () => {
    setup(book(NOTHING, 'EXPLORER'));
    for (const title of ['Three Clues', 'The Pattern Lock', 'What Was Waiting']) {
      expect(screen.getByText(title)).toBeInTheDocument();
    }
    expect(screen.queryByText('The First Story')).toBeNull();
  });

  it('uses real buttons and no em dash', () => {
    setup(book(NOTHING, 'EXPLORER'));
    for (const button of screen.getAllByRole('button')) expect(button.tagName).toBe('BUTTON');
    expect(document.body.textContent ?? '').not.toMatch(/—|–/);
  });

  it('celebrates a whole book in a status region, and not before', () => {
    const { unmount } = render(
      <StorybookSection storybook={book(TOLD)} access={() => 'ok'} onGo={vi.fn()} />,
    );
    expect(screen.getByRole('status')).toHaveTextContent(/every missing page is back/i);
    unmount();
    setup(book(NOTHING));
    expect(screen.queryByText(/every missing page is back/i)).not.toBeInTheDocument();
  });

  it('tells a child how far along a missing page is', () => {
    render(
      <StorybookSection
        storybook={book(NOTHING)}
        access={() => 'ok'}
        onGo={vi.fn()}
        context={{
          visitedRoomIds: new Set(['illustration-studio']),
          startedAdventureSlugs: new Set(['the-painted-words']),
        }}
      />,
    );
    const item = screen.getByText('The Painted Words').closest('li')!;
    expect(within(item).getByText(/You have started this one\./)).toBeInTheDocument();
    const other = screen.getByText('The First Story').closest('li')!;
    expect(within(other).getByText(/Not found yet\./)).toBeInTheDocument();
  });

  it('says it is checking while loading, and offers a retry when the server is out of reach', () => {
    const retry = vi.fn();
    const base = book(NOTHING);
    const { unmount } = render(
      <StorybookSection
        storybook={{ ...base, status: 'loading' }}
        access={() => 'ok'}
        onGo={vi.fn()}
      />,
    );
    expect(screen.getByText(/checking the book with the castle/i)).toBeInTheDocument();
    unmount();
    render(
      <StorybookSection
        storybook={{ ...base, status: 'offline', retry }}
        access={() => 'ok'}
        onGo={vi.fn()}
      />,
    );
    expect(screen.getByText(/pages you have are still shown/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /try again/i }));
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it('shows an empty state when there is nothing to look for', () => {
    const base = book(NOTHING);
    render(
      <StorybookSection storybook={{ ...base, entries: [] }} access={() => 'ok'} onGo={vi.fn()} />,
    );
    expect(screen.getByText(/no pages to look for yet/i)).toBeInTheDocument();
  });
});

describe('StorybookSection for a book restored in an earlier edition', () => {
  const RESTORED_BEFORE: StorybookState = {
    worldChangeKeys: ['FIRST_STORY_TOLD', 'GREAT_STORYBOOK_RESTORED'],
    discoveryIds: [],
  };

  it('says the book is restored and a new page was found, never "missing pages"', () => {
    const { container } = render(
      <StorybookSection
        storybook={book(RESTORED_BEFORE)}
        access={() => 'ok'}
        onGo={() => undefined}
      />,
    );
    expect(
      screen.getByText('The Great Storybook is restored. A new page was found!'),
    ).toBeInTheDocument();
    expect(container.textContent ?? '').not.toMatch(/missing/i);
    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(screen.queryByText(/Every missing page is back/)).toBeNull();
  });

  it('offers the new page as a new page, with a way to go there', () => {
    const { onGo } = setup(book(RESTORED_BEFORE));
    const item = screen.getByText('The Painted Words').closest('li')!;
    expect(within(item).getByText(/A new page\./)).toBeInTheDocument();
    fireEvent.click(within(item).getByRole('button', { name: /go to the illustration studio/i }));
    expect(onGo).toHaveBeenCalledWith('illustration-studio');
  });
});
