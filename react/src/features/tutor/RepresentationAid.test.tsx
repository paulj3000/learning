import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { RepresentationAid } from './RepresentationAid';
import { representationAidFor } from './content/representationAids';

function aidFor(skillId: string) {
  const aid = representationAidFor(skillId);
  if (!aid) throw new Error(`test fixture skill ${skillId} must have an aid`);
  return aid;
}

describe('RepresentationAid', () => {
  it('renders the authored manipulative for the skill', () => {
    render(<RepresentationAid aid={aidFor('counting-sets')} />);

    expect(screen.getByText('Tap each shell once as you count it out loud.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Shell 1' })).toBeInTheDocument();
  });

  it('tells the child plainly that nothing here counts', () => {
    render(<RepresentationAid aid={aidFor('counting-sets')} />);

    expect(screen.getByText(/Nothing here counts/)).toBeInTheDocument();
  });

  it('encourages the child whether or not the answer matched', async () => {
    const user = userEvent.setup();
    const aid = aidFor('measurement');
    render(<RepresentationAid aid={aid} />);

    await user.type(screen.getByRole('spinbutton'), '2');
    await user.click(screen.getByRole('button', { name: /Check my measurement/ }));

    // 2 is not 6, and the child is still told something true and kind.
    expect(screen.getByRole('status')).toHaveTextContent(aid.encouragement);
    expect(screen.getByRole('status')).not.toHaveTextContent('That matches');
  });

  it('says so when the answer does match', async () => {
    const user = userEvent.setup();
    render(<RepresentationAid aid={aidFor('measurement')} />);

    await user.type(screen.getByRole('spinbutton'), '6');
    await user.click(screen.getByRole('button', { name: /Check my measurement/ }));

    expect(screen.getByRole('status')).toHaveTextContent('That matches');
  });

  it('says nothing at all until the child has had a go', () => {
    render(<RepresentationAid aid={aidFor('measurement')} />);

    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
