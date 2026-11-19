import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createEngineRuntime, type EngineRuntime } from '@lai/game-engine/core';
import {
  PhysicsProviderService,
  createGameplayEventFactory,
  type GameplayEventFactory,
} from '@lai/game-engine/contracts';
import {
  createCollisionDebugView,
  createPlayerGizmo,
  countCollidersByClass,
  type CollisionDebugView,
  type PlayerGizmo,
} from '@lai/game-engine/debug';
import { GameHost } from '../GameHost';
import type { HostView, RendererFactory } from '../hostTypes';
import { DebugOverlay } from '../debug/DebugOverlay';
import { EventLog } from '../debug/EventLog';
import { useEventLog } from '../debug/useEventLog';
import {
  PLAYGROUND_CAPABILITIES,
  createPlaygroundRegistry,
  type PlaygroundAgeBand,
} from './playgroundScene';
import styles from './GameEnginePlayground.module.css';

/**
 * DEV ONLY. Registered at `/dev/game-engine` behind `import.meta.env.DEV`, so it is absent
 * from production builds. It never touches child data, the API or AI.
 */

const AGE_BAND_OPTIONS: readonly { value: PlaygroundAgeBand; label: string }[] = [
  { value: 'SPROUT', label: 'Sprouts (3-4)' },
  { value: 'PATHFINDER', label: 'Pathfinders (5-6)' },
  { value: 'EXPLORER', label: 'Explorers (7-8)' },
];

type ClaimSpec = { label: string; emit(factory: GameplayEventFactory): unknown };

const SAMPLE_CLAIMS: readonly ClaimSpec[] = [
  { label: 'Collect coin', emit: (f) => f.create('collectible.collected', { collectibleId: 'coin.demo.1', setId: null }) },
  { label: 'Enter area', emit: (f) => f.create('exploration.area.entered', { areaId: 'area.demo.harbor' }) },
  { label: 'Finish quest step', emit: (f) => f.create('quest.step.completed', { questId: 'quest.demo', stepId: 'step.1' }) },
  { label: 'Send an invalid claim', emit: () => ({ type: 'not.a.real.event', payload: {} }) },
];

export interface GameEnginePlaygroundProps {
  /** Tests inject a fake renderer; the page uses WebGL by default. */
  rendererFactory?: RendererFactory;
}

interface StageProps {
  ageBand: PlaygroundAgeBand;
  enabled: readonly string[];
  showOverlay: boolean;
  showCollision: boolean;
  onCollisionChange(visible: boolean): void;
  rendererFactory?: RendererFactory;
}

/** One engine run. Remounted (keyed) whenever capabilities or age band change. */
function PlaygroundStage({ ageBand, enabled, showOverlay, showCollision, onCollisionChange, rendererFactory }: StageProps) {
  const [runtime, setRuntime] = useState<EngineRuntime | null>(null);
  const [colliderCounts, setColliderCounts] = useState<string>('');
  const collision = useRef<CollisionDebugView | null>(null);
  const { entries, clear } = useEventLog(runtime, 25);
  const factory = useMemo(
    () => createGameplayEventFactory({ realmId: 'realm.playground', adventureId: 'adventure.playground', areaId: null, sessionRef: null }),
    [],
  );

  const capabilities = useMemo(
    () => PLAYGROUND_CAPABILITIES.filter((c) => enabled.includes(c.id)).map((c) => c.toRequest(ageBand)),
    [ageBand, enabled],
  );

  const createRuntime = useCallback(
    () => createEngineRuntime({ id: 'playground', capabilities: createPlaygroundRegistry() }),
    [],
  );

  const onReady = useCallback((started: EngineRuntime, view: HostView) => {
    const provider = started.services.get(PhysicsProviderService);
    if (provider) {
      const scope = started.resources.child('playground.debug');
      const view3d = createCollisionDebugView(provider, { scope });
      view.scene.add(view3d.group);
      collision.current = view3d;
      const counts = countCollidersByClass(provider.colliders());
      setColliderCounts(`SOLID ${counts.SOLID}, JUMPABLE ${counts.JUMPABLE}, TRIGGER ${counts.TRIGGER}, gate ${counts.GATE}`);
    }
    const gizmo: PlayerGizmo = createPlayerGizmo(started.world, { scope: started.resources });
    view.scene.add(gizmo.group);
    started.systems.add({
      id: 'playground.debug.gizmo',
      phase: 'presentation',
      order: 100,
      update: ({ alpha }) => gizmo.update(alpha),
    });
    setRuntime(started);
  }, []);

  useEffect(() => {
    if (collision.current) {
      collision.current.visible = showCollision;
    }
  }, [showCollision, runtime]);

  const emit = (claim: ClaimSpec) => {
    runtime?.events.emit('gameplay.event' as never, claim.emit(factory) as never);
  };

  return (
    <div className={styles.stage}>
      <GameHost
        runtimeId="playground"
        label="Game engine test scene"
        capabilities={capabilities}
        createRuntime={createRuntime}
        rendererFactory={rendererFactory}
        onRuntimeReady={onReady}
      >
        {showOverlay ? (
          <DebugOverlay runtime={runtime} collisionVisible={showCollision} onCollisionVisibleChange={onCollisionChange} />
        ) : null}
      </GameHost>
      {colliderCounts ? <p className={styles.muted}>Colliders: {colliderCounts}</p> : null}
      <section className={styles.claims} aria-label="Sample gameplay claims">
        <h3>Sample claims</h3>
        <div className={styles.buttonRow}>
          {SAMPLE_CLAIMS.map((claim) => (
            <button key={claim.label} type="button" disabled={!runtime} onClick={() => emit(claim)}>
              {claim.label}
            </button>
          ))}
        </div>
      </section>
      <EventLog entries={entries} onClear={clear} />
    </div>
  );
}

export function GameEnginePlayground({ rendererFactory }: GameEnginePlaygroundProps) {
  const [ageBand, setAgeBand] = useState<PlaygroundAgeBand>('PATHFINDER');
  const [enabled, setEnabled] = useState<readonly string[]>(() =>
    PLAYGROUND_CAPABILITIES.filter((c) => c.defaultEnabled).map((c) => c.id),
  );
  const [showOverlay, setShowOverlay] = useState(true);
  const [showCollision, setShowCollision] = useState(true);

  const toggleCapability = (id: string) =>
    setEnabled((current) => (current.includes(id) ? current.filter((c) => c !== id) : [...current, id]));

  return (
    <main className={styles.page}>
      <h1>Game engine playground</h1>
      <p className={styles.muted}>Development only. Changing capabilities or age band restarts the engine.</p>
      <div className={styles.layout}>
        <form className={styles.controls} aria-label="Playground controls" onSubmit={(e) => e.preventDefault()}>
          <fieldset>
            <legend>Capabilities</legend>
            {PLAYGROUND_CAPABILITIES.map((capability) => (
              <label key={capability.id} className={styles.control}>
                <input type="checkbox" checked={enabled.includes(capability.id)} onChange={() => toggleCapability(capability.id)} />
                <span>
                  {capability.label}
                  <small className={styles.muted}> {capability.id}</small>
                </span>
              </label>
            ))}
          </fieldset>
          <label className={styles.control}>
            <span>Age band</span>
            <select value={ageBand} onChange={(e) => setAgeBand(e.target.value as PlaygroundAgeBand)}>
              {AGE_BAND_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
          <label className={styles.control}>
            <input type="checkbox" checked={showOverlay} onChange={(e) => setShowOverlay(e.target.checked)} />
            <span>Debug overlay</span>
          </label>
          <label className={styles.control}>
            <input type="checkbox" checked={showCollision} onChange={(e) => setShowCollision(e.target.checked)} />
            <span>Collision view</span>
          </label>
        </form>
        <PlaygroundStage
          key={`${ageBand}|${[...enabled].sort().join(',')}`}
          ageBand={ageBand}
          enabled={enabled}
          showOverlay={showOverlay}
          showCollision={showCollision}
          onCollisionChange={setShowCollision}
          rendererFactory={rendererFactory}
        />
      </div>
    </main>
  );
}
