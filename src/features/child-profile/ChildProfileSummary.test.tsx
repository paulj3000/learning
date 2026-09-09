import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ChildProfileSummary } from './ChildProfileSummary';
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

describe('ChildProfileSummary', () => {
  it('offers "Enter island" only while the profile is active', () => {
    const { rerender } = render(
      <MemoryRouter>
        <ChildProfileSummary childProfile={makeChild({ active: true })} onToggleActive={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: /enter island/i })).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ChildProfileSummary childProfile={makeChild({ active: false })} onToggleActive={vi.fn()} />
      </MemoryRouter>,
    );
    expect(screen.queryByRole('link', { name: /enter island/i })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /reactivate/i })).toBeInTheDocument();
  });

  it('requires the parent gate before deactivating a profile', async () => {
    const onToggleActive = vi.fn().mockResolvedValue(undefined);
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <ChildProfileSummary childProfile={makeChild({})} onToggleActive={onToggleActive} />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole('button', { name: /deactivate/i }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(onToggleActive).not.toHaveBeenCalled();
  });
});
