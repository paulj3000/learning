import { renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { ServerStorybook, StorybookApi } from '../../api/play/storybookApi';
import type { StorybookPage } from './pages';
import { useGreatStorybook } from './useGreatStorybook';

const serverBook = (restoredIds: string[]): ServerStorybook => ({
  band: 'PATHFINDER',
  pages: restoredIds.map((id) => ({
    id,
    title: id,
    required: id !== 'page-tapestry',
    restored: true,
    roomId: 'story-hall',
    text: '',
  })),
  restoredRequired: 0,
  totalRequired: 1,
  restoredBonus: 0,
  complete: false,
  quest: { questId: null, status: 'NOT_STARTED' },
});

const fakeApi = (restored: string[] = []) => {
  const get = vi.fn().mockResolvedValue(serverBook(restored));
  return { api: { get } as StorybookApi, get };
};

type Props = { changes: string[]; found: string[] };
const render = (
  props: Props,
  api: StorybookApi | null,
  callbacks: {
    onPageRestored?: (page: StorybookPage) => void;
    onBookRestored?: () => void;
  } = {},
) =>
  renderHook(
    ({ changes, found }: Props) =>
      useGreatStorybook({
        childId: 'child-1',
        band: 'PATHFINDER',
        worldChangeKeys: changes,
        discoveryIds: found,
        api,
        ...callbacks,
      }),
    { initialProps: props },
  );

describe('useGreatStorybook', () => {
  it('shows an empty book for a child who has done nothing, with no hidden page slot', () => {
    const { result } = render({ changes: [], found: [] }, null);
    expect(result.current.progress.complete).toBe(false);
    expect(result.current.entries.map((e) => e.page.id)).toEqual(['page-first-story']);
    expect(result.current.entries[0].restored).toBe(false);
  });

  it('shows the book already restored for a child who finished the Tale long ago', () => {
    const { result } = render({ changes: ['FIRST_STORY_TOLD'], found: [] }, null);
    expect(result.current.progress.complete).toBe(true);
  });

  it('does not announce a page that was already back when the view loaded', () => {
    const onPageRestored = vi.fn();
    const onBookRestored = vi.fn();
    render({ changes: ['FIRST_STORY_TOLD'], found: [] }, null, { onPageRestored, onBookRestored });
    expect(onPageRestored).not.toHaveBeenCalled();
    expect(onBookRestored).not.toHaveBeenCalled();
  });

  it('announces a page the moment it comes back during the visit, once, and the book when it is whole', () => {
    const onPageRestored = vi.fn();
    const onBookRestored = vi.fn();
    const { rerender } = render({ changes: [], found: [] }, null, {
      onPageRestored,
      onBookRestored,
    });
    rerender({ changes: ['FIRST_STORY_TOLD'], found: [] });
    expect(onPageRestored).toHaveBeenCalledTimes(1);
    expect(onPageRestored.mock.calls[0][0]).toMatchObject({ id: 'page-first-story' });
    expect(onBookRestored).toHaveBeenCalledTimes(1);
    rerender({ changes: ['FIRST_STORY_TOLD'], found: [] });
    expect(onPageRestored).toHaveBeenCalledTimes(1);
  });

  it('announces the hidden page when found, but that never makes the book whole by itself', () => {
    const onPageRestored = vi.fn();
    const onBookRestored = vi.fn();
    const { rerender, result } = render({ changes: [], found: [] }, null, {
      onPageRestored,
      onBookRestored,
    });
    rerender({ changes: [], found: ['castle-tapestry-stair'] });
    expect(onPageRestored.mock.calls[0][0]).toMatchObject({ id: 'page-tapestry' });
    expect(onBookRestored).not.toHaveBeenCalled();
    expect(result.current.entries.map((e) => e.page.id)).toContain('page-tapestry');
  });

  it('counts a page the server holds, without announcing it as new', async () => {
    const onPageRestored = vi.fn();
    const { api } = fakeApi(['page-first-story']);
    const { result } = render({ changes: [], found: [] }, api, { onPageRestored });
    await waitFor(() => expect(result.current.progress.complete).toBe(true));
    expect(onPageRestored).not.toHaveBeenCalled();
  });

  it("reads the server once on load and again when the child's own pages change", async () => {
    const { api, get } = fakeApi();
    const { rerender } = render({ changes: [], found: [] }, api);
    await waitFor(() => expect(get).toHaveBeenCalledTimes(1));
    rerender({ changes: [], found: [] });
    expect(get).toHaveBeenCalledTimes(1);
    rerender({ changes: ['FIRST_STORY_TOLD'], found: [] });
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
  });

  it('survives a failing server: the book is whatever the records alone say', async () => {
    const api = { get: vi.fn().mockRejectedValue(new Error('down')) } as StorybookApi;
    const { result } = render({ changes: ['FIRST_STORY_TOLD'], found: [] }, api);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    expect(result.current.progress.complete).toBe(true);
  });

  it('ignores a server answer that arrives after it is gone', async () => {
    let finish: (value: ServerStorybook) => void = () => undefined;
    const api = {
      get: vi.fn().mockImplementation(() => new Promise((resolve) => (finish = resolve))),
    } as StorybookApi;
    const { result, unmount } = render({ changes: [], found: [] }, api);
    await waitFor(() => expect(api.get).toHaveBeenCalled());
    unmount();
    finish(serverBook(['page-first-story']));
    await Promise.resolve();
    expect(result.current.progress.complete).toBe(false);
  });

  it('works with no Django API: records alone decide', () => {
    const { result } = render({ changes: ['FIRST_STORY_TOLD'], found: [] }, null);
    expect(result.current.progress.restoredRequired).toBe(1);
  });
});
