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
  return { progress, entries: visibleEntries(progress) };
};

const NOTHING: StorybookState = { worldChangeKeys: [], discoveryIds: [] };
const TOLD: StorybookState = { worldChangeKeys: ['FIRST_STORY_TOLD'], discoveryIds: [] };

const setup = (storybook: GreatStorybook, access: 'ok' | 'here' | 'no' = 'ok') => {
  const onGo = vi.fn();
  render(<StorybookSection storybook={storybook} access={() => access} onGo={onGo} />);
  return { onGo };
};

describe('StorybookSection', () => {
  it('says how many missing pages are back, in words and in a progress element', () => {
    setup(book(NOTHING));
    expect(screen.getByText('0 of 1 missing pages are back.')).toBeInTheDocument();
    const bar = screen.getByRole('progressbar', { name: /missing pages that are back/i });
    expect(bar).toHaveAttribute('max', '1');
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
      within(item).getByText(/Missing\. Tell a story with Keeper Quill in the Story Hall\./),
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
    expect(screen.getByText('You are in the right place.')).toBeInTheDocument();
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
    expect(screen.getByText('0 of 1 missing pages are back.')).toBeInTheDocument();
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
});
