import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WorldHud } from './WorldHud';

const baseProps = {
  questCue: null,
  companionName: null,
  focusedLabel: null,
  toastMessage: null,
  backpackItems: [],
};

describe('WorldHud', () => {
  it('shows the quest cue when one is given', () => {
    render(<WorldHud {...baseProps} questCue="Help Pip fix the bridge" />);
    expect(screen.getByText('Help Pip fix the bridge')).toBeInTheDocument();
  });

  it('shows nothing for the quest cue when there is no active quest', () => {
    render(<WorldHud {...baseProps} />);
    expect(screen.queryByText(/help pip/i)).not.toBeInTheDocument();
  });

  it("shows the companion's name when a companion is chosen", () => {
    render(<WorldHud {...baseProps} companionName="Chatty" />);
    expect(screen.getByText('Chatty')).toBeInTheDocument();
  });

  it('shows a focus label and prompt only when something is focused', () => {
    const { rerender } = render(<WorldHud {...baseProps} />);
    expect(screen.queryByText(/press e to talk/i)).not.toBeInTheDocument();

    rerender(<WorldHud {...baseProps} focusedLabel="Pip" />);
    expect(screen.getByText(/pip: press e to talk/i)).toBeInTheDocument();
  });

  it('shows a toast message when given one', () => {
    render(<WorldHud {...baseProps} toastMessage="You're inside the lookout tower." />);
    expect(screen.getByText("You're inside the lookout tower.")).toBeInTheDocument();
  });

  it('shows the backpack item count and toggles the panel open and closed', async () => {
    const user = userEvent.setup();
    render(
      <WorldHud {...baseProps} backpackItems={[{ id: 'moon-shell', displayName: 'Moon Shell' }]} />,
    );

    const button = screen.getByRole('button', { name: /backpack \(1\)/i });
    expect(screen.queryByRole('dialog', { name: /backpack/i })).not.toBeInTheDocument();

    await user.click(button);
    expect(screen.getByRole('dialog', { name: /backpack/i })).toBeInTheDocument();
    expect(screen.getByText('Moon Shell')).toBeInTheDocument();

    await user.click(button);
    expect(screen.queryByRole('dialog', { name: /backpack/i })).not.toBeInTheDocument();
  });

  it('says the backpack is empty when there are no items', async () => {
    const user = userEvent.setup();
    render(<WorldHud {...baseProps} />);

    await user.click(screen.getByRole('button', { name: /backpack \(0\)/i }));

    expect(screen.getByText(/nothing here yet/i)).toBeInTheDocument();
  });
});
