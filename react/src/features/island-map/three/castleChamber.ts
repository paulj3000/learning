import type { WorldInteraction, WorldRequirement } from '../worldObjects';
import { SECRET_PASSAGE_DISCOVERY_ID } from './castleLayout';

/**
 * The Secret Chamber's walk-up descriptions (SC-R03-05). **Flavour only**:
 * three crystals that each hum a note, and a sealed round door. They are
 * `SHOW_MESSAGE`, so they grade nothing, grant nothing, record nothing and
 * open nothing. The door is a promise (SC-R08 may give the chamber content),
 * not a puzzle: the castle's one pattern lock and secret door stay in the
 * Library and are not duplicated here.
 *
 * Every one is gated on the tapestry nook having been found, so to a child
 * who has not found it none of these is available, none appears in "Things
 * to do here", and the manifest also lists them as hidden, because a secret
 * that announces itself in a list is signage.
 */
/** A fresh list each time: `WorldInteraction.requirements` is mutable, and sharing one list would share its edits. */
const found = (): WorldRequirement[] => [
  { type: 'DISCOVERY_PRESENT', discoveryId: SECRET_PASSAGE_DISCOVERY_ID },
];

const note = (n: number, id: string, title: string, message: string): WorldInteraction => ({
  id,
  type: 'OBJECT',
  trigger: 'APPROACH',
  title,
  targetId: `chamber-crystal-${n}`,
  requirements: found(),
  action: { kind: 'SHOW_MESSAGE', message },
  zoneId: id,
});

export const CASTLE_CHAMBER_INTERACTIONS: readonly WorldInteraction[] = [
  note(
    1,
    'chamber-glow-1',
    'A violet crystal',
    'A violet crystal glows softly. It hums one low, gentle note.',
  ),
  note(
    2,
    'chamber-glow-2',
    'A teal crystal',
    'A teal crystal glows like shallow sea water. It hums a note a little higher.',
  ),
  note(
    3,
    'chamber-glow-3',
    'A rose crystal',
    'A rose crystal glows like the sky at sunrise. It hums the highest, softest note.',
  ),
  {
    id: 'chamber-door',
    type: 'OBJECT',
    trigger: 'APPROACH',
    title: 'A round door',
    targetId: 'chamber-door',
    requirements: found(),
    action: {
      kind: 'SHOW_MESSAGE',
      message:
        'A round door glows with a quiet light. It is sealed for now. Remember it, because one day it may open.',
    },
    zoneId: 'chamber-door',
  },
];
