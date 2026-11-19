import { describe, expect, it } from 'vitest';
import { RequirementCheckService, signalBoard } from './common';
import { ChestsService } from './chests';
import { CollectiblesService, validateCollectiblesConfig } from './collectibles';
import { CheckpointsService } from './checkpoints';
import { DoorsService, validateDoorsConfig } from './doors';
import { registerGameplayComponents } from './registerGameplayComponents';
import { ensureWorldObject, TriggersService } from './triggers';
import { createHarness } from './testHarness';

const harness = () => createHarness(registerGameplayComponents);

describe('collectibles', () => {
  const config = { collectibles: [{ id: 'coin.a', position: { x: 0, y: 0, z: 0 }, pickupRadius: 1, setId: 'set.coins' }, { id: 'coin.b', position: { x: 10, y: 0, z: 0 } }] };

  it('claims once per visit when within the pickup radius on x/z', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.collectibles', config }]);
    h.setPlayer({ x: 3, y: 0, z: 0 });
    h.advance(0.1);
    expect(h.claimsOfType('collectible.collected')).toHaveLength(0);
    h.setPlayer({ x: 0.5, y: 0, z: 0.5 });
    h.advance(0.1);
    h.advance(0.5);
    const claims = h.claimsOfType('collectible.collected');
    expect(claims).toHaveLength(1);
    expect(claims[0]!.payload).toEqual({ collectibleId: 'coin.a', setId: 'set.coins' });
    expect(h.eventsNamed('CollectiblePickedUp')).toHaveLength(1);
    const api = h.runtime.services.require(CollectiblesService);
    expect(api.remaining()).toBe(1);
    api.resetVisit();
    h.advance(0.1);
    expect(h.claimsOfType('collectible.collected')).toHaveLength(2);
    h.dispose();
  });

  it('does not re-emit for an id the host says is already collected, and ignores far vertical offsets', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.collectibles', config: { ...config, alreadyCollected: ['coin.a'] } }]);
    h.setPlayer({ x: 0, y: 0, z: 0 });
    h.advance(0.2);
    expect(h.claims).toHaveLength(0);
    h.setPlayer({ x: 10, y: 5, z: 0 });
    h.advance(0.2);
    expect(h.claims).toHaveLength(0);
    h.dispose();
  });

  it('validates', () => {
    expect(validateCollectiblesConfig({ collectibles: [{ id: 'a', position: { x: 0, y: 0, z: 0 }, pickupRadius: 99 }] }).ok).toBe(false);
    expect(validateCollectiblesConfig({ collectibles: [{ id: 'bad id', position: { x: 0, y: 0, z: 0 } }] }).ok).toBe(false);
    expect(validateCollectiblesConfig({ collectibles: [{ id: 'a', position: { x: 0, y: 0, z: 0 } }, { id: 'a', position: { x: 0, y: 0, z: 0 } }] }).ok).toBe(false);
  });
});

describe('chests', () => {
  const chests = [
    { id: 'chest.free', position: { x: 0, y: 0, z: 0 } },
    { id: 'chest.gated', position: { x: 0, y: 0, z: 5 }, challengeGated: true },
    { id: 'chest.replay', position: { x: 0, y: 0, z: 10 }, replay: true },
  ];

  it('opens closed to opening to open and claims a discovery for a normal chest', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.chests', config: { chests } }]);
    const api = h.runtime.services.require(ChestsService);
    h.setPlayer({ x: 1, y: 0, z: 0 });
    expect(api.requestOpen('chest.free')).toBe('OPENING');
    expect(api.requestOpen('chest.free')).toBe('ALREADY_OPEN');
    h.advance(0.3);
    expect(api.phaseOf('chest.free')).toBe('OPENING');
    h.advance(1);
    expect(api.phaseOf('chest.free')).toBe('OPEN');
    expect(h.claimsOfType('exploration.discovery.found')).toHaveLength(1);
    h.dispose();
  });

  it('requires proximity and, when gated, a host unlock (the engine never grades the challenge)', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.chests', config: { chests } }]);
    const api = h.runtime.services.require(ChestsService);
    h.setPlayer({ x: 50, y: 0, z: 50 });
    expect(api.requestOpen('chest.free')).toBe('TOO_FAR');
    h.setPlayer({ x: 0, y: 0, z: 5 });
    expect(api.requestOpen('chest.gated')).toBe('LOCKED_BY_CHALLENGE');
    expect(api.phaseOf('chest.gated')).toBe('CLOSED');
    expect(api.unlock('chest.gated')).toBe(true);
    expect(api.requestOpen('chest.gated')).toBe('OPENING');
    expect(api.requestOpen('nope')).toBe('UNKNOWN');
    h.dispose();
  });

  it('replay chests open but grant nothing and emit no claim', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.chests', config: { chests } }]);
    const api = h.runtime.services.require(ChestsService);
    h.setPlayer({ x: 0, y: 0, z: 10 });
    api.requestOpen('chest.replay');
    h.advance(1.5);
    expect(api.phaseOf('chest.replay')).toBe('OPEN');
    expect(h.claims).toHaveLength(0);
    expect(h.eventsNamed('ChestStateChanged').at(-1)).toMatchObject({ state: 'OPEN', replay: true });
    h.dispose();
  });
});

describe('doors', () => {
  const door = { id: 'door.gate', position: { x: 0, y: 0, z: 0 }, size: { x: 2, y: 3, z: 0.4 }, requirementId: 'quest.key' };

  it('locked doors are SOLID gate colliders and never jumpable', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.doors', config: { doors: [door] } }]);
    const collider = h.physics.getCollider('door.gate')!;
    expect(collider.kind).toBe('SOLID');
    expect(collider.gate).toBe(true);
    const api = h.runtime.services.require(DoorsService);
    expect(api.phaseOf('door.gate')).toBe('LOCKED');
    expect(api.requestOpen('door.gate')).toBe('LOCKED');
    expect(h.eventsNamed('DoorBumped')).toHaveLength(1);
    h.dispose();
  });

  it('unlocks from the host requirement check, then opens by sliding the collider out', async () => {
    const h = harness();
    let met = false;
    h.runtime.services.provide(RequirementCheckService, (id) => id === 'quest.key' && met);
    await h.start([{ id: 'gameplay.doors', config: { doors: [door] } }]);
    const api = h.runtime.services.require(DoorsService);
    h.advance(0.1);
    expect(api.phaseOf('door.gate')).toBe('LOCKED');
    met = true;
    h.advance(0.1);
    expect(api.phaseOf('door.gate')).toBe('UNLOCKED');
    expect(api.requestOpen('door.gate')).toBe('OPENING');
    h.advance(0.5);
    expect(h.physics.getCollider('door.gate')!.min.y).toBeGreaterThan(0);
    h.advance(1);
    expect(api.phaseOf('door.gate')).toBe('OPEN');
    expect(h.physics.hasCollider('door.gate')).toBe(false);
    h.dispose();
  });

  it('a world signal can satisfy the requirement', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.doors', config: { doors: [door] } }]);
    signalBoard(h.runtime).set('quest.key', true);
    h.advance(0.1);
    expect(h.runtime.services.require(DoorsService).phaseOf('door.gate')).toBe('UNLOCKED');
    h.dispose();
  });

  it('never closes on top of the child, and closes once they step clear', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.doors', config: { doors: [{ ...door, requirementId: undefined }] } }]);
    const api = h.runtime.services.require(DoorsService);
    api.requestOpen('door.gate');
    h.advance(1.2);
    expect(h.physics.hasCollider('door.gate')).toBe(false);
    h.setPlayer({ x: 0, y: 0, z: 0 });
    expect(api.requestClose('door.gate')).toBe(true);
    h.advance(1);
    expect(api.phaseOf('door.gate')).toBe('CLOSING');
    expect(h.physics.hasCollider('door.gate')).toBe(false);
    h.setPlayer({ x: 5, y: 0, z: 5 });
    h.advance(0.1);
    expect(api.phaseOf('door.gate')).toBe('UNLOCKED');
    expect(h.physics.hasCollider('door.gate')).toBe(true);
    h.dispose();
  });

  it('removes its colliders on dispose and validates sizes', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.doors', config: { doors: [door] } }]);
    h.dispose();
    expect(h.physics.hasCollider('door.gate')).toBe(false);
    expect(validateDoorsConfig({ doors: [{ id: 'd', position: { x: 0, y: 0, z: 0 }, size: { x: 0, y: 1, z: 1 } }] }).ok).toBe(false);
  });
});

describe('portals', () => {
  it('requests a transition once per entry and re-arms after leaving', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.portals', config: { portals: [{ id: 'portal.a', position: { x: 0, y: 0, z: 0 }, targetAreaId: 'area.next' }] } }]);
    h.setPlayer({ x: 0.5, y: 0, z: 0 });
    h.advance(0.5);
    expect(h.eventsNamed('PortalRequested')).toEqual([{ portalId: 'portal.a', targetAreaId: 'area.next' }]);
    h.setPlayer({ x: 20, y: 0, z: 0 });
    h.advance(0.1);
    h.setPlayer({ x: 0, y: 0, z: 0 });
    h.advance(0.1);
    expect(h.eventsNamed('PortalRequested')).toHaveLength(2);
    h.dispose();
  });

  it('blocks when the host requirement is not met', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.portals', config: { portals: [{ id: 'portal.a', position: { x: 0, y: 0, z: 0 }, targetAreaId: 'area.next', requirementId: 'quest.done' }] } }]);
    h.setPlayer({ x: 0, y: 0, z: 0 });
    h.advance(0.1);
    expect(h.eventsNamed('PortalRequested')).toHaveLength(0);
    expect(h.eventsNamed('PortalBlocked')).toHaveLength(1);
    h.dispose();
  });
});

describe('switches and pressure plates', () => {
  const config = {
    switches: [{ id: 'switch.a', position: { x: 0, y: 0, z: 0 } }],
    plates: [
      { id: 'plate.a', position: { x: 10, y: 0, z: 0 }, halfSize: 0.6 },
      { id: 'plate.latch', position: { x: 20, y: 0, z: 0 }, latch: true },
    ],
  };

  it('toggles a switch on the press edge only and writes its signal', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.triggers', config }]);
    const api = h.runtime.services.require(TriggersService);
    h.setPlayer({ x: 1, y: 0, z: 0 });
    expect(api.interact('switch.a', true)).toBe('TOGGLED');
    expect(api.interact('switch.a', true)).toBe('HELD');
    expect(api.isOn('switch.a')).toBe(true);
    expect(signalBoard(h.runtime).get('switch.a')).toBe(true);
    api.interact('switch.a', false);
    expect(api.interact('switch.a', true)).toBe('TOGGLED');
    expect(api.isOn('switch.a')).toBe(false);
    h.setPlayer({ x: 30, y: 0, z: 0 });
    expect(api.toggle('switch.a')).toBe('TOO_FAR');
    expect(api.toggle('missing')).toBe('UNKNOWN');
    h.dispose();
  });

  it('a plate is pressed only while the player or an object is on it', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.triggers', config }]);
    const api = h.runtime.services.require(TriggersService);
    h.setPlayer({ x: 10, y: 0, z: 0 });
    h.advance(0.1);
    expect(api.isPressed('plate.a')).toBe(true);
    expect(signalBoard(h.runtime).get('plate.a')).toBe(true);
    h.setPlayer({ x: 40, y: 0, z: 0 });
    h.advance(0.1);
    expect(api.isPressed('plate.a')).toBe(false);
    ensureWorldObject(h.runtime, 'crate.1', { x: 10.2, y: 0, z: 0 });
    h.advance(0.1);
    expect(api.isPressed('plate.a')).toBe(true);
    expect(h.eventsNamed('PressurePlatePressed')).toHaveLength(2);
    expect(h.eventsNamed('PressurePlateReleased')).toHaveLength(1);
    h.dispose();
  });

  it('latching plates stay pressed', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.triggers', config }]);
    h.setPlayer({ x: 20, y: 0, z: 0 });
    h.advance(0.1);
    h.setPlayer({ x: 40, y: 0, z: 0 });
    h.advance(0.1);
    expect(h.runtime.services.require(TriggersService).isPressed('plate.latch')).toBe(true);
    h.dispose();
  });
});

describe('checkpoints and goals', () => {
  const config = {
    checkpoints: [
      { id: 'cp.1', courseId: 'course.a', position: { x: 0, y: 0, z: 0 }, label: 'the old dock' },
      { id: 'cp.2', courseId: 'course.a', position: { x: 10, y: 0, z: 0 }, label: 'the bridge' },
    ],
    goals: [{ id: 'goal.a', courseId: 'course.a', rect: { minX: 20, maxX: 22, minZ: -1, maxZ: 1 } }],
  };

  it('reaches each checkpoint once, claims it, and resolves recovery to the latest', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.checkpoints', config }]);
    const api = h.runtime.services.require(CheckpointsService);
    expect(api.resolveRecovery('cp.1')?.id).toBe('cp.1');
    expect(api.resolveRecovery(null)).toBeNull();
    h.setPlayer({ x: 0.5, y: 0, z: 0 });
    h.advance(0.1);
    h.advance(0.1);
    h.setPlayer({ x: 10, y: 0, z: 0 });
    h.advance(0.1);
    expect(h.claimsOfType('course.checkpoint.reached').map((c) => c.payload)).toEqual([
      { courseId: 'course.a', checkpointId: 'cp.1' },
      { courseId: 'course.a', checkpointId: 'cp.2' },
    ]);
    expect(api.latest()?.id).toBe('cp.2');
    expect(api.resolveRecovery('cp.1')?.id).toBe('cp.2');
    h.setPlayer({ x: 21, y: 0, z: 0 });
    h.advance(0.1);
    h.advance(0.1);
    expect(h.claimsOfType('course.completed')).toHaveLength(1);
    h.dispose();
  });

  it('resume marks reached without events', async () => {
    const h = harness();
    await h.start([{ id: 'gameplay.checkpoints', config: { ...config, alreadyReached: ['cp.2'] } }]);
    h.setPlayer({ x: 10, y: 0, z: 0 });
    h.advance(0.1);
    expect(h.claims).toHaveLength(0);
    expect(h.runtime.services.require(CheckpointsService).latest()?.id).toBe('cp.2');
    h.dispose();
  });
});
