import { createEntityWorld, defineComponent } from './entities';
import { isEngineError } from './errors';

const Position = defineComponent<{ x: number; z: number }>('core.position');
const Collectible = defineComponent<{ setId: string | null }>('gameplay.collectible');

describe('createEntityWorld', () => {
  it('stores typed components and queries by intersection', () => {
    const world = createEntityWorld();
    const shell = world.create('golden-shell-1');
    const rock = world.create();
    world.add(shell, Position, { x: 1, z: 2 });
    world.add(shell, Collectible, { setId: 'golden-shells' });
    world.add(rock, Position, { x: 0, z: 0 });
    expect(world.query(Position, Collectible)).toEqual([shell]);
    expect(world.query(Position)).toEqual([shell, rock]);
    expect(world.get(shell, Position)?.x).toBe(1);
    expect(world.bySemanticId('golden-shell-1')).toBe(shell);
  });

  it('rejects duplicate semantic ids and duplicate components', () => {
    const world = createEntityWorld();
    const e = world.create('door-1');
    expect(() => world.create('door-1')).toThrow();
    world.add(e, Position, { x: 0, z: 0 });
    let caught: unknown;
    try {
      world.add(e, Position, { x: 1, z: 1 });
    } catch (error) {
      caught = error;
    }
    expect(isEngineError(caught, 'DUPLICATE_ID')).toBe(true);
  });

  it('cleans up components and semantic ids on destroy and notifies listeners', () => {
    const world = createEntityWorld();
    const destroyed: (string | undefined)[] = [];
    world.onDestroy((_e, id) => destroyed.push(id));
    const e = world.create('chest-1');
    world.add(e, Position, { x: 0, z: 0 });
    world.destroy(e);
    expect(world.exists(e)).toBe(false);
    expect(world.get(e, Position)).toBeUndefined();
    expect(world.bySemanticId('chest-1')).toBeUndefined();
    expect(destroyed).toEqual(['chest-1']);
    expect(world.create('chest-1')).not.toBe(e);
  });

  it('requires components it is asked to require', () => {
    const world = createEntityWorld();
    const e = world.create();
    expect(() => world.require(e, Position)).toThrow(/core.position/);
    expect(() => world.set(e, Position, { x: 0, z: 0 })).toThrow();
  });

  it('validates component ids', () => {
    expect(() => defineComponent('Bad Id')).toThrow();
  });
});
