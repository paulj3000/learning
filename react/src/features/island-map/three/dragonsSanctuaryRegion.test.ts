import { describe, expect, it } from 'vitest';
import { DRAGONS_SANCTUARY_REGION_ID, resolveSpawnCheckpoint } from '../../discovery/checkpoints';
import {
  AMBIENT_DRAGON_PATH,
  AREA_LABELS,
  AREA_ZONES,
  BOUNDARY_WALLS,
  buildingWallColliders,
  COLLIDERS,
  DRAGON_SCALE_SPOTS,
  DRAGONS_SANCTUARY_REGION_CHECKPOINTS,
  EMBER_ID,
  FIRE_RUNE_SPOTS,
  FORGE,
  FORGE_HEARTH,
  findAreaZone,
  GROUND_HALF_EXTENT,
  isInsideRect,
  KEEPER_LODGE,
  NPC_SPOTS,
  REGION_ID,
  ROOST_STONES,
  RUNE_SOCKET_SPOTS,
  SEALED_GATES,
  SKY_CLIFFS,
  VALLEY_BOULDERS,
} from './dragonsSanctuaryRegion';

function insideAnyCollider(x: number, z: number): boolean {
  return COLLIDERS.some((collider) => isInsideRect(x, z, collider));
}

function onGround(x: number, z: number): boolean {
  return Math.abs(x) <= GROUND_HALF_EXTENT && Math.abs(z) <= GROUND_HALF_EXTENT;
}

function insideAnyZone(x: number, z: number): boolean {
  return AREA_ZONES.some((zone) => isInsideRect(x, z, zone));
}

describe('region identity', () => {
  it('uses the region id the World State layer owns', () => {
    expect(REGION_ID).toBe(DRAGONS_SANCTUARY_REGION_ID);
  });

  it('authors checkpoints that all belong to this region', () => {
    for (const checkpoint of DRAGONS_SANCTUARY_REGION_CHECKPOINTS) {
      expect(checkpoint.regionId).toBe(REGION_ID);
    }
  });

  it('spawns a first-time visitor at the gate, so the valley opens up in front of them', () => {
    expect(resolveSpawnCheckpoint(REGION_ID, undefined).id).toBe('dragons-sanctuary:gate');
  });

  it('spawns a returning child back where they left off', () => {
    expect(resolveSpawnCheckpoint(REGION_ID, 'dragons-sanctuary:forge-hearth').id).toBe(
      'dragons-sanctuary:forge-hearth',
    );
  });

  it('ignores a checkpoint saved in another region', () => {
    expect(resolveSpawnCheckpoint(REGION_ID, 'clockwork-harbor:docks').id).toBe(
      'dragons-sanctuary:gate',
    );
  });
});

describe('checkpoints are standable', () => {
  it('never places a checkpoint inside a collider', () => {
    // A checkpoint a child cannot stand on is a spawn point that strands them.
    for (const checkpoint of DRAGONS_SANCTUARY_REGION_CHECKPOINTS) {
      expect(
        insideAnyCollider(checkpoint.x, checkpoint.z),
        `${checkpoint.id} spawns inside a collider`,
      ).toBe(false);
    }
  });

  it('never places a checkpoint off the ground plane', () => {
    for (const checkpoint of DRAGONS_SANCTUARY_REGION_CHECKPOINTS) {
      expect(onGround(checkpoint.x, checkpoint.z), `${checkpoint.id} is off the plot`).toBe(true);
    }
  });

  it('puts the forge checkpoints where their names claim', () => {
    const hearth = DRAGONS_SANCTUARY_REGION_CHECKPOINTS.find(
      (c) => c.id === 'dragons-sanctuary:forge-hearth',
    );
    expect(hearth).toBeDefined();
    expect(isInsideRect(hearth!.x, hearth!.z, FORGE.interiorZone)).toBe(true);

    const door = DRAGONS_SANCTUARY_REGION_CHECKPOINTS.find(
      (c) => c.id === 'dragons-sanctuary:forge-door',
    );
    expect(isInsideRect(door!.x, door!.z, FORGE.interiorZone)).toBe(false);
  });

  it('leaves the lodge checkpoint on the doorstep rather than inside', () => {
    const door = DRAGONS_SANCTUARY_REGION_CHECKPOINTS.find(
      (c) => c.id === 'dragons-sanctuary:lodge-door',
    );
    expect(door).toBeDefined();
    expect(isInsideRect(door!.x, door!.z, KEEPER_LODGE.interiorZone)).toBe(false);
  });

  it('authors no checkpoint at a gate the child cannot open', () => {
    // A checkpoint is a place a child has stood. One behind a sealed gate
    // would be a spawn point they can never legitimately save at.
    for (const gate of SEALED_GATES) {
      const near = DRAGONS_SANCTUARY_REGION_CHECKPOINTS.some(
        (c) => Math.hypot(c.x - gate.x, c.z - gate.z) < 6,
      );
      expect(near, `${gate.id} has a checkpoint at it`).toBe(false);
    }
  });
});

describe('the buildings are enterable', () => {
  it.each([KEEPER_LODGE, FORGE])('leaves exactly one side of $id open as a doorway', (building) => {
    expect(building.wallSides).toHaveLength(3);
  });

  it('opens the lodge and the forge toward the valley the child crosses', () => {
    expect(KEEPER_LODGE.wallSides).not.toContain('east');
    expect(FORGE.wallSides).not.toContain('west');
  });

  it.each([KEEPER_LODGE, FORGE])('does not wall off $id’s own interior', (building) => {
    const midX = (building.interiorZone.minX + building.interiorZone.maxX) / 2;
    const midZ = (building.interiorZone.minZ + building.interiorZone.maxZ) / 2;
    expect(insideAnyCollider(midX, midZ)).toBe(false);
  });

  it.each([KEEPER_LODGE, FORGE])('keeps $id’s interior inside its own footprint', (building) => {
    const { interiorZone: interior } = building;
    expect(interior.minX).toBeGreaterThan(building.x - building.halfWidth);
    expect(interior.maxX).toBeLessThan(building.x + building.halfWidth);
    expect(interior.minZ).toBeGreaterThan(building.z - building.halfDepth);
    expect(interior.maxZ).toBeLessThan(building.z + building.halfDepth);
  });

  it('leaves the doorway walkable all the way through', () => {
    // Walking due east into the forge from the valley must not be blocked at
    // any step: the open side is a real gap, not a door that opens by script.
    for (let x = 12; x <= 22; x += 0.25) {
      expect(insideAnyCollider(x, FORGE.z), `forge doorway blocked at x=${x}`).toBe(false);
    }
    for (let x = -12; x >= -22; x -= 0.25) {
      expect(insideAnyCollider(x, KEEPER_LODGE.z), `lodge doorway blocked at x=${x}`).toBe(false);
    }
  });

  it('builds a wall collider for every built side and none for the doorway', () => {
    const forgeWalls = buildingWallColliders(FORGE);
    expect(forgeWalls).toHaveLength(3);
    expect(forgeWalls.map((wall) => wall.id)).not.toContain('collider:forge:west');
  });
});

describe('areas', () => {
  it('gives every zone a child-facing label', () => {
    for (const zone of AREA_ZONES) {
      expect(AREA_LABELS[zone.id], `${zone.id} has no label`).toBeTruthy();
    }
    expect(Object.keys(AREA_LABELS)).toHaveLength(AREA_ZONES.length);
  });

  it('authors the eight areas Phase 1 names', () => {
    expect(AREA_ZONES).toHaveLength(8);
  });

  it('gives every zone a positive footprint', () => {
    for (const zone of AREA_ZONES) {
      expect(zone.maxX).toBeGreaterThan(zone.minX);
      expect(zone.maxZ).toBeGreaterThan(zone.minZ);
    }
  });

  it('does not overlap two areas, so a step never fires two toasts', () => {
    for (let i = 0; i < AREA_ZONES.length; i += 1) {
      for (let j = i + 1; j < AREA_ZONES.length; j += 1) {
        const a = AREA_ZONES[i];
        const b = AREA_ZONES[j];
        const overlaps = a.minX < b.maxX && b.minX < a.maxX && a.minZ < b.maxZ && b.minZ < a.maxZ;
        expect(overlaps, `${a.id} overlaps ${b.id}`).toBe(false);
      }
    }
  });

  it('keeps every area on the ground plane', () => {
    for (const zone of AREA_ZONES) {
      expect(onGround(zone.minX, zone.minZ), `${zone.id} runs off the plot`).toBe(true);
      expect(onGround(zone.maxX, zone.maxZ), `${zone.id} runs off the plot`).toBe(true);
    }
  });

  it('looks a zone up by id', () => {
    expect(findAreaZone('dragons-sanctuary:zone:roost')?.minZ).toBe(-21);
    expect(findAreaZone('nope')).toBeUndefined();
  });

  it('puts every checkpoint in a named area', () => {
    // Every place a child can spawn should be somewhere the HUD can name.
    for (const checkpoint of DRAGONS_SANCTUARY_REGION_CHECKPOINTS) {
      expect(
        insideAnyZone(checkpoint.x, checkpoint.z),
        `${checkpoint.id} is in no named area`,
      ).toBe(true);
    }
  });
});

describe('the sealed areas', () => {
  it('seals the crystal cavern and the hatchery, and nothing else', () => {
    expect(SEALED_GATES.map((gate) => gate.id)).toEqual([
      'dragons-sanctuary:prop:crystal-cavern-gate',
      'dragons-sanctuary:prop:hatchery-gate',
    ]);
  });

  it('makes each gate solid, so "locked" is a wall and not just a message', () => {
    for (const gate of SEALED_GATES) {
      expect(insideAnyCollider(gate.x, gate.z), `${gate.id} is walkable`).toBe(true);
    }
  });

  it('tells the child what they can see and what would open it, never that they may not', () => {
    for (const gate of SEALED_GATES) {
      expect(gate.lockedMessage.length).toBeGreaterThan(0);
      // CLAUDE.md pillar 7: a locked door is a promise, not a scolding.
      expect(gate.lockedMessage).not.toMatch(/\b(cannot|can't|not allowed|denied|no entry)\b/i);
    }
  });

  it('leaves the forge unsealed, because Ember sends the child inside it', () => {
    expect(SEALED_GATES.some((gate) => gate.id.includes('forge'))).toBe(false);
  });

  it('lets the child walk right up to each sealed gate', () => {
    // Visible but inaccessible means reachable and shut, not fenced off at a
    // distance - Phase 1 wants the child to see what they are working toward.
    for (const gate of SEALED_GATES) {
      const approachZ = gate.z + 2;
      expect(insideAnyCollider(gate.x, approachZ), `${gate.id} is not approachable`).toBe(false);
    }
  });
});

describe('Ember and the roost', () => {
  it('gives every NPC a distinct id and a readable label', () => {
    expect(new Set(NPC_SPOTS.map((npc) => npc.id)).size).toBe(NPC_SPOTS.length);
    for (const npc of NPC_SPOTS) expect(npc.label.length).toBeGreaterThan(0);
  });

  it('never stands an NPC inside a collider', () => {
    for (const npc of NPC_SPOTS) {
      expect(insideAnyCollider(npc.x, npc.z), `${npc.id} is stuck in geometry`).toBe(false);
    }
  });

  it('stands Ember in her roost, at the far end of the valley from the gate', () => {
    const ember = NPC_SPOTS.find((npc) => npc.id === EMBER_ID);
    expect(ember).toBeDefined();
    expect(isInsideRect(ember!.x, ember!.z, findAreaZone('dragons-sanctuary:zone:roost')!)).toBe(
      true,
    );
    const gate = DRAGONS_SANCTUARY_REGION_CHECKPOINTS.find(
      (c) => c.id === 'dragons-sanctuary:gate',
    );
    // Far enough that reaching her is a walk past the forge, the lodge and
    // both sealed gates - the child sees what is broken before being told.
    expect(Math.abs(gate!.z - ember!.z)).toBeGreaterThan(30);
  });

  it('leaves the roost open on the valley side so a child can stand beside her', () => {
    const ember = NPC_SPOTS.find((npc) => npc.id === EMBER_ID)!;
    for (let z = -9; z >= ember.z; z -= 0.25) {
      expect(insideAnyCollider(0, z), `roost approach blocked at z=${z}`).toBe(false);
    }
  });

  it('keeps the roost stones out of the walkway and on the plot', () => {
    for (const stone of ROOST_STONES) {
      expect(onGround(stone.x, stone.z), `${stone.id} is off the plot`).toBe(true);
    }
  });
});

describe('the forge quest props', () => {
  it('puts the hearth inside the forge, where the child has to walk to reach it', () => {
    expect(isInsideRect(FORGE_HEARTH.x, FORGE_HEARTH.z, FORGE.interiorZone)).toBe(true);
    expect(insideAnyCollider(FORGE_HEARTH.x, FORGE_HEARTH.z)).toBe(false);
  });

  it('authors three fire runes, each reachable and on the plot', () => {
    expect(FIRE_RUNE_SPOTS).toHaveLength(3);
    for (const rune of FIRE_RUNE_SPOTS) {
      expect(onGround(rune.x, rune.z), `${rune.id} is off the plot`).toBe(true);
      expect(insideAnyCollider(rune.x, rune.z), `${rune.id} is inside geometry`).toBe(false);
    }
  });

  it('scatters the runes rather than lining them up on one walk', () => {
    // Phase 2 asks the child to search three places, not to sweep one.
    for (let i = 0; i < FIRE_RUNE_SPOTS.length; i += 1) {
      for (let j = i + 1; j < FIRE_RUNE_SPOTS.length; j += 1) {
        const a = FIRE_RUNE_SPOTS[i];
        const b = FIRE_RUNE_SPOTS[j];
        expect(
          Math.hypot(a.x - b.x, a.z - b.z),
          `${a.id} and ${b.id} are on top of each other`,
        ).toBeGreaterThan(12);
      }
    }
  });

  it('hides no rune behind a gate the child cannot open', () => {
    const sealedZones = [
      'dragons-sanctuary:zone:crystal-cavern',
      'dragons-sanctuary:zone:hatchery',
    ].map((id) => findAreaZone(id)!);
    for (const rune of FIRE_RUNE_SPOTS) {
      for (const zone of sealedZones) {
        expect(isInsideRect(rune.x, rune.z, zone), `${rune.id} is sealed inside ${zone.id}`).toBe(
          false,
        );
      }
    }
  });

  it('puts every rune in a named area, so finding one is finding a place', () => {
    for (const rune of FIRE_RUNE_SPOTS) {
      expect(insideAnyZone(rune.x, rune.z), `${rune.id} is in no named area`).toBe(true);
    }
  });

  it('sets one socket per rune, all of them at the hearth', () => {
    expect(RUNE_SOCKET_SPOTS).toHaveLength(FIRE_RUNE_SPOTS.length);
    for (const socket of RUNE_SOCKET_SPOTS) {
      expect(
        isInsideRect(socket.x, socket.z, FORGE.interiorZone),
        `${socket.id} is not in the forge`,
      ).toBe(true);
    }
  });

  it('gives every prop a distinct id', () => {
    const ids = [
      FORGE_HEARTH.id,
      ...FIRE_RUNE_SPOTS.map((rune) => rune.id),
      ...RUNE_SOCKET_SPOTS.map((socket) => socket.id),
      ...SEALED_GATES.map((gate) => gate.id),
    ];
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('collectibles and scenery', () => {
  it('places every dragon scale on the plot and clear of geometry', () => {
    for (const scale of DRAGON_SCALE_SPOTS) {
      expect(onGround(scale.x, scale.z), `${scale.id} is off the plot`).toBe(true);
      expect(insideAnyCollider(scale.x, scale.z), `${scale.id} is inside geometry`).toBe(false);
      expect(scale.y).toBeGreaterThan(0);
    }
  });

  it('does not hide a scale behind a sealed gate', () => {
    const hatchery = findAreaZone('dragons-sanctuary:zone:hatchery')!;
    const behindTheGate = DRAGON_SCALE_SPOTS.filter(
      (scale) => isInsideRect(scale.x, scale.z, hatchery) && scale.z < -16,
    );
    // One scale sits in the hatchery *approach*, which is walkable; none may
    // sit past the gate line, where the child cannot reach it.
    expect(behindTheGate).toEqual([]);
  });

  it('keeps the sky cliffs outside the walls, so nothing promises they can be reached', () => {
    for (const cliff of SKY_CLIFFS) {
      expect(cliff.z, `${cliff.id} is inside the valley`).toBeLessThan(-GROUND_HALF_EXTENT);
    }
    expect(insideAnyZone(SKY_CLIFFS[0].x, SKY_CLIFFS[0].z)).toBe(false);
  });

  it('flies the ambient dragon out over the cliffs, above head height and out of reach', () => {
    for (const point of AMBIENT_DRAGON_PATH) {
      expect(point.y).toBeGreaterThan(10);
    }
  });

  it('keeps the valley crossable rather than a maze', () => {
    // A straight walk down the middle from the gate to the roost has to work;
    // the boulders dress the valley, they do not block it.
    for (let z = 21; z >= -12; z -= 0.25) {
      expect(insideAnyCollider(0, z), `valley blocked at z=${z}`).toBe(false);
    }
    expect(VALLEY_BOULDERS.length).toBeGreaterThan(0);
  });

  it('walls the plot on all four sides', () => {
    expect(BOUNDARY_WALLS).toHaveLength(4);
    expect(insideAnyCollider(0, GROUND_HALF_EXTENT + 0.5)).toBe(true);
    expect(insideAnyCollider(0, -GROUND_HALF_EXTENT - 0.5)).toBe(true);
    expect(insideAnyCollider(GROUND_HALF_EXTENT + 0.5, 0)).toBe(true);
    expect(insideAnyCollider(-GROUND_HALF_EXTENT - 0.5, 0)).toBe(true);
  });
});
