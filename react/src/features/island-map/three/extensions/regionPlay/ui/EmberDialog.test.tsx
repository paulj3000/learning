import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { PipDialog } from './PipDialog';

/** An NPC speaking Django-authored lines (ADR-047, Firepeak FP-4 and stage 5). */

const dialogue = [
  {
    nodeId: 'ember-greeting',
    text: 'Hello, explorer! I am Professor Ember.',
    followUpOnly: false,
    choices: [
      { choiceId: 'ask', label: 'Why is it rumbling?', nextNodeId: 'ember-why-rumble' },
      { choiceId: 'bye', label: 'Let us find out!', nextNodeId: null },
    ],
  },
  {
    nodeId: 'ember-why-rumble',
    text: 'Deep below us there is hot melted rock called magma.',
    followUpOnly: true,
    choices: [],
  },
];

const quest = {
  questId: 'the-volcano-awakens',
  title: 'The Volcano Awakens',
  summary: 'Help Professor Ember.',
  giverNpcId: 'professor-ember',
  status: 'ACTIVE' as const,
  currentStageId: 'repair-the-crossing',
  completedAt: null,
  stages: [],
};

function renderEmber(returnAction: Parameters<typeof PipDialog>[0]['returnAction'] = null) {
  return render(
    <PipDialog
      name="Professor Ember"
      quests={[quest]}
      accepting={false}
      error={null}
      onAccept={vi.fn()}
      onClose={vi.fn()}
      dialogue={dialogue}
      stageLine="Fill each gap with the stone that fits."
      returnAction={returnAction}
    />,
  );
}

describe('Professor Ember', () => {
  it('greets with her own words and says what to do next', () => {
    renderEmber();
    expect(screen.getByText('Hello, explorer! I am Professor Ember.')).toBeInTheDocument();
    expect(screen.getByText('Fill each gap with the stone that fits.')).toBeInTheDocument();
    expect(screen.queryByText(/treasure/i)).not.toBeInTheDocument();
  });

  it('follows a choice to its follow-up line', async () => {
    renderEmber();
    await userEvent.click(screen.getByRole('button', { name: 'Why is it rumbling?' }));
    expect(screen.getByText(/hot melted rock called magma/)).toBeInTheDocument();
  });

  it('offers to show her the crystal only when that stage is open', async () => {
    const onReturn = vi.fn();
    renderEmber({ label: 'Show Professor Ember the crystal', busy: false, onReturn });
    await userEvent.click(screen.getByRole('button', { name: 'Show Professor Ember the crystal' }));
    expect(onReturn).toHaveBeenCalledTimes(1);
  });
});
