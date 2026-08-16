import { describe, expect, it } from 'vitest';
import {
  getNpcInteraction,
  isOnWalkableTile,
  isWithinWorldBounds,
  WELCOME_HARBOR_NPCS,
} from './npcs';

describe('WELCOME_HARBOR_NPCS', () => {
  it('resolves every NPC to a tap-triggered NPC interaction', () => {
    for (const npc of WELCOME_HARBOR_NPCS) {
      const interaction = getNpcInteraction(npc);
      expect(interaction.type).toBe('NPC');
      expect(interaction.trigger).toBe('TAP');
    }
  });

  it('throws for an NPC whose interactionId does not resolve', () => {
    expect(() =>
      getNpcInteraction({
        id: 'ghost',
        interactionId: 'nope',
        name: 'Ghost',
        spawn: { x: 0, y: 0 },
        palette: { body: 0, belly: 0, beak: 0, eye: 0 },
        followDistancePx: 0,
        idleBobPx: 0,
      }),
    ).toThrow();
  });

  it('spawns every NPC within world bounds on a walkable tile', () => {
    for (const npc of WELCOME_HARBOR_NPCS) {
      expect(isWithinWorldBounds(npc.spawn.x, npc.spawn.y)).toBe(true);
      expect(isOnWalkableTile(npc.spawn.x, npc.spawn.y)).toBe(true);
    }
  });
});
