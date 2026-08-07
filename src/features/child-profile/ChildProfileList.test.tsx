import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ChildProfileList } from './ChildProfileList';
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

describe('ChildProfileList', () => {
  it('shows an empty state when there are no child profiles', () => {
    render(
      <MemoryRouter>
        <ChildProfileList childProfiles={[]} onToggleActive={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.getByText(/no child profiles yet/i)).toBeInTheDocument();
  });

  it('offers "Enter island" only for active profiles', () => {
    render(
      <MemoryRouter>
        <ChildProfileList
          childProfiles={[
            makeChild({ id: 'a', nickname: 'Robin', active: true }),
            makeChild({ id: 'b', nickname: 'Sam', active: false }),
          ]}
          onToggleActive={vi.fn()}
        />
      </MemoryRouter>,
    );

    expect(screen.getAllByRole('link', { name: /enter island/i })).toHaveLength(1);
  });

  it('hides "Add child" once the profile limit is reached', () => {
    const children = Array.from({ length: MAX_CHILD_PROFILES }, (_, index) =>
      makeChild({ id: `child-${index}`, nickname: `Child ${index}` }),
    );
    render(
      <MemoryRouter>
        <ChildProfileList childProfiles={children} onToggleActive={vi.fn()} />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('link', { name: /add child/i })).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(`limit of ${MAX_CHILD_PROFILES}`, 'i'))).toBeInTheDocument();
  });

  it('requires the parent gate before deactivating a profile', async () => {
    const onToggleActive = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChildProfileList childProfiles={[makeChild({})]} onToggleActive={onToggleActive} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /deactivate/i }));
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onToggleActive).not.toHaveBeenCalled();
  });
});
