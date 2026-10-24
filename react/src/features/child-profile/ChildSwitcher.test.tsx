import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ChildSwitcher } from './ChildSwitcher';
import { MAX_CHILD_PROFILES } from './constants';
import type { ChildProfile } from './api';

function makeChild(overrides: Partial<ChildProfile>): ChildProfile {
  return {
    id: 'child-1',
    nickname: 'Robin',
    ageBand: 'SPROUT',
    avatarKey: 'FOX',
    interests: [],
    readingMode: 'VOICE_FIRST',
    sessionMinutes: 6,
    active: true,
    parentProfileId: 'parent-1',
    ...overrides,
  } as unknown as ChildProfile;
}

function renderSwitcher(childProfiles: ChildProfile[], onSelect = vi.fn()) {
  render(
    <MemoryRouter>
      <ChildSwitcher
        childProfiles={childProfiles}
        selectedChildId={childProfiles[0]?.id ?? null}
        onSelect={onSelect}
      />
    </MemoryRouter>,
  );
  return onSelect;
}

describe('ChildSwitcher', () => {
  it('shows the selected child on the trigger and keeps the menu closed until asked', () => {
    renderSwitcher([makeChild({ nickname: 'Robin' }), makeChild({ id: 'b', nickname: 'Sam' })]);

    expect(screen.getByRole('button', { name: /choose a child/i })).toHaveTextContent('Robin');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('lists every child, marks the selected one, and reports the choice', async () => {
    const user = userEvent.setup();
    const onSelect = renderSwitcher([
      makeChild({ id: 'a', nickname: 'Robin' }),
      makeChild({ id: 'b', nickname: 'Sam' }),
    ]);

    await user.click(screen.getByRole('button', { name: /choose a child/i }));

    const items = screen.getAllByRole('menuitemradio');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveAttribute('aria-checked', 'true');
    expect(items[1]).toHaveAttribute('aria-checked', 'false');

    await user.click(items[1]);
    expect(onSelect).toHaveBeenCalledWith('b');
    // Choosing closes the menu, so the dashboard behind it is visible again.
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('closes on Escape without choosing anything', async () => {
    const user = userEvent.setup();
    const onSelect = renderSwitcher([makeChild({})]);

    await user.click(screen.getByRole('button', { name: /choose a child/i }));
    await user.keyboard('{Escape}');

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('offers "Add child" in the menu until the profile limit is reached', async () => {
    const user = userEvent.setup();
    const children = Array.from({ length: MAX_CHILD_PROFILES }, (_, index) =>
      makeChild({ id: `child-${index}`, nickname: `Child ${index}` }),
    );
    renderSwitcher(children);

    await user.click(screen.getByRole('button', { name: /choose a child/i }));

    expect(screen.queryByRole('menuitem', { name: /add child/i })).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(`limit of ${MAX_CHILD_PROFILES}`, 'i'))).toBeInTheDocument();
  });

  it('replaces itself with an add link when there are no profiles yet', () => {
    renderSwitcher([]);

    expect(screen.getByRole('link', { name: /add your first child/i })).toHaveAttribute(
      'href',
      '/home/children/new',
    );
    expect(screen.queryByRole('button', { name: /choose a child/i })).not.toBeInTheDocument();
  });
});
