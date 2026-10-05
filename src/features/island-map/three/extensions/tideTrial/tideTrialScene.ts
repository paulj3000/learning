import {
  BoxGeometry,
  CanvasTexture,
  Group,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
  type BufferGeometry,
  type Material,
  type Object3D,
} from 'three';
import { TIDE_BOARD, TIDE_DURATION_MS, tideLevelAt } from '../../../tideTrial';
import type { WorldExtension, WorldExtensionMount } from '../../runtime/extensionRegistry';
import { parseTideTrialConfig } from './tideTrialConfig';

export const TIDE_TRIAL_EXTENSION_ID = 'tide-trial';

/**
 * The scene half of "Beat the Tide" (`../../../tideTrial.ts`), as a world
 * extension (engine Phase 7, ADR-025): the tide board, the deck the child
 * raises and lowers, the water rising past it, and the bridge collider
 * coming away once a deck survives. Moved here from `pirateBuilderBayScene.ts`
 * with its behaviour unchanged; what that file read from
 * `pirateBuilderBayRegion.ts` now comes from the manifest config and the
 * manifest's own channel and sea scenery.
 *
 * `TideTrialPanel` drives it through this API, handed over as the
 * extension's `api`.
 */
export interface TideTrialScene {
  /** Clears the broken bridge, shows the board and a deck at `deckCm`, and lets the water out to low tide. */
  begin(deckCm: number): void;
  setDeckHeight(deckCm: number): void;
  /** Runs one tide, reporting the level as it goes. Resolves when the tide is done. */
  runTide(onLevel: (waterCm: number) => void): Promise<void>;
  /** A fresh deck at `deckCm` after a failed try, and the water back down. */
  rebuild(deckCm: number): void;
  /** The deck stands: the bridge becomes walkable and the water settles. */
  complete(): void;
  /** Leaving mid-trial: everything back as it was. */
  cancel(): void;
}

export function isTideTrialScene(value: unknown): value is TideTrialScene {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ['begin', 'setDeckHeight', 'runTide', 'rebuild', 'complete', 'cancel'].every(
    (method) => typeof candidate[method] === 'function',
  );
}

/** Where the water settles once the new deck stands: comfortably under any deck that passed. */
const SETTLED_WATER_CM = 120;
/** The tide board runs from the bed (0 cm) to just above the banks. */
const TIDE_BOARD_TOP_CM = 200;
const TIDE_BOARD_WIDTH = 0.8;

interface WaterAnimation {
  startedAt: number;
  durationMs: number;
  levelAt: (elapsedMs: number) => number;
  onLevel?: (cm: number) => void;
  resolve: () => void;
}

interface FloatingPlank {
  plank: Object3D;
  driftPerSecond: number;
  spinPerSecond: number;
}

function drawTideBoard(heightMeters: number): CanvasTexture | null {
  const canvas = document.createElement('canvas');
  canvas.height = 1024;
  // Matching the board's own proportions, so the numbers are not stretched.
  canvas.width = Math.round((canvas.height * TIDE_BOARD_WIDTH) / heightMeters);
  const context = canvas.getContext('2d');
  if (!context) return null;
  context.fillStyle = '#f4efe1';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const pxPerCm = canvas.height / TIDE_BOARD_TOP_CM;
  for (let cm = 0; cm < TIDE_BOARD_TOP_CM; cm += 10) {
    context.fillStyle = (cm / 10) % 2 === 0 ? '#c8372d' : '#ffffff';
    context.fillRect(0, canvas.height - (cm + 10) * pxPerCm, 200, 10 * pxPerCm);
  }
  context.fillStyle = '#1d2a33';
  context.font = 'bold 92px sans-serif';
  context.textBaseline = 'middle';
  for (let cm = 20; cm < TIDE_BOARD_TOP_CM; cm += 20) {
    const y = canvas.height - cm * pxPerCm;
    context.fillRect(200, y - 4, 50, 8);
    context.fillText(String(cm), 280, y);
  }
  return new CanvasTexture(canvas);
}

export const tideTrialSceneExtension: WorldExtension = {
  id: TIDE_TRIAL_EXTENSION_ID,
  mount(context): WorldExtensionMount {
    const config = parseTideTrialConfig(context.config);
    const channelSpec = context.manifest.scenery.find(
      (item) => item.id === config.channelSceneryId,
    );
    if (!channelSpec || channelSpec.kind !== 'BOX') {
      throw new Error(`channelSceneryId "${config.channelSceneryId}" must name a BOX scenery item`);
    }
    const channel = context.sceneryRoot(config.channelSceneryId);
    const sea = context.sceneryRoot(config.seaSceneryId);
    const hiddenDuringTrial = config.hideDuringTrialSceneryIds.flatMap((id) => {
      const root = context.sceneryRoot(id);
      return root ? [root] : [];
    });

    const bedY = channelSpec.minY;
    const restingSurfaceY = channelSpec.maxY;
    const channelHeight = restingSurfaceY - bedY;
    const channelReachZ =
      2 * Math.max(Math.abs(channelSpec.area.minZ), Math.abs(channelSpec.area.maxZ));
    const cmToWorldY = (cm: number) => bedY + (cm / config.bankTopCm) * (config.bankTopY - bedY);

    const ownedGeometries: BufferGeometry[] = [];
    const ownedMaterials: Material[] = [];
    const ownMesh = (geometry: BufferGeometry, material: Material) => {
      ownedGeometries.push(geometry);
      ownedMaterials.push(material);
      return new Mesh(geometry, material);
    };

    const restingWaterCm = ((restingSurfaceY - bedY) / (config.bankTopY - bedY)) * config.bankTopCm;
    let waterCm = restingWaterCm;
    let waterAnimation: WaterAnimation | null = null;
    let disposed = false;

    /** Moves the channel's water and the open sea together, so the channel never shows a step where it meets the sea. */
    function setWaterLevel(cm: number): void {
      waterCm = cm;
      const surfaceY = cmToWorldY(cm);
      if (channel) channel.scale.y = Math.max(0.01, surfaceY - bedY) / channelHeight;
      // A centimetre under the channel's surface: coplanar, the two would z-fight along the seam.
      if (sea) sea.position.y = surfaceY - 0.01;
    }

    function animateWater(
      durationMs: number,
      levelAt: (elapsedMs: number) => number,
      onLevel?: (cm: number) => void,
    ): Promise<void> {
      // A newer animation replaces an unfinished one; the old one's caller is released rather than left hanging.
      waterAnimation?.resolve();
      return new Promise((resolve) => {
        waterAnimation = { startedAt: context.now(), durationMs, levelAt, onLevel, resolve };
      });
    }

    function easeWaterTo(targetCm: number, durationMs: number): void {
      const fromCm = waterCm;
      void animateWater(durationMs, (elapsed) => {
        const t = Math.min(1, elapsed / durationMs);
        return fromCm + (targetCm - fromCm) * (1 - (1 - t) ** 2);
      });
    }

    const group = new Group();
    group.visible = false;
    context.scene.add(group);

    const boardHeight = cmToWorldY(TIDE_BOARD_TOP_CM) - bedY;
    const tidePost = ownMesh(
      new BoxGeometry(0.12, boardHeight + 0.2, 0.12),
      new MeshStandardMaterial({ color: 0x5b4632 }),
    );
    tidePost.position.set(
      config.tidePost.x + 0.08,
      bedY + (boardHeight + 0.2) / 2,
      config.tidePost.z,
    );
    group.add(tidePost);
    const boardTexture = drawTideBoard(boardHeight);
    if (boardTexture) {
      const board = ownMesh(
        new PlaneGeometry(TIDE_BOARD_WIDTH, boardHeight),
        new MeshStandardMaterial({ map: boardTexture }),
      );
      // A plane faces +z; turn it to face west, at the dock side.
      board.rotation.y = -Math.PI / 2;
      board.position.set(config.tidePost.x, bedY + boardHeight / 2, config.tidePost.z);
      group.add(board);
    }

    // The deck's support posts, stretched from the bed to wherever the deck is.
    const postGeometry = new BoxGeometry(0.14, 1, 0.14);
    const postMaterial = new MeshStandardMaterial({ color: 0x6b4a2b });
    ownedGeometries.push(postGeometry);
    ownedMaterials.push(postMaterial);
    const deckPosts = config.deckPostXs.flatMap((x) =>
      [config.bridge.minZ + 0.15, config.bridge.maxZ - 0.15].map((z) => {
        const post = new Mesh(postGeometry, postMaterial);
        post.position.set(x, 0, z);
        group.add(post);
        return post;
      }),
    );

    let deckPlanks: Object3D[] = [];
    let deckCm = TIDE_BOARD.lowWaterCm;
    let floatingPlanks: FloatingPlank[] = [];

    function placeDeck(cm: number): void {
      deckCm = cm;
      const deckY = cmToWorldY(cm);
      for (const [index, plank] of deckPlanks.entries()) {
        plank.visible = true;
        plank.position.set(config.deckPlankXs[index] ?? 0, deckY, 0);
        plank.rotation.set(0, 0, 0);
      }
      const postHeight = deckY - bedY;
      for (const post of deckPosts) {
        post.scale.y = postHeight;
        post.position.y = bedY + postHeight / 2;
      }
      floatingPlanks = [];
    }

    async function loadDeckPlanks(): Promise<void> {
      const plank = await context.loadModel(config.plankAssetId);
      if (disposed || deckPlanks.length > 0) return;
      deckPlanks = config.deckPlankXs.map((x) => {
        const copy = plank.scene.clone(true);
        copy.position.set(x, 0, 0);
        group.add(copy);
        return copy;
      });
      placeDeck(deckCm);
    }

    function startFloatingAway(): void {
      context.playNpcGesture(config.npcEntityId, 'Talk', 2);
      floatingPlanks = deckPlanks.map((plank, index) => ({
        plank,
        // Alternate planks drift out opposite ends of the channel, at different speeds.
        driftPerSecond: (index % 2 === 0 ? 1 : -1) * (0.7 + 0.2 * index),
        spinPerSecond: (index % 2 === 0 ? 0.5 : -0.4) * (1 + index * 0.1),
      }));
    }

    const stopFrames = context.onFrame((deltaSeconds) => {
      if (waterAnimation) {
        const animation = waterAnimation;
        const elapsed = context.now() - animation.startedAt;
        const level = animation.levelAt(Math.min(elapsed, animation.durationMs));
        setWaterLevel(level);
        animation.onLevel?.(Math.round(level));
        if (elapsed >= animation.durationMs) {
          waterAnimation = null;
          animation.resolve();
        }
      }
      if (floatingPlanks.length > 0) {
        const surfaceY = cmToWorldY(waterCm);
        for (const floating of floatingPlanks) {
          const { plank } = floating;
          if (!plank.visible) continue;
          // Riding on the surface, a little low in the water.
          plank.position.y = surfaceY - 0.08;
          plank.position.z += floating.driftPerSecond * deltaSeconds;
          plank.rotation.y += floating.spinPerSecond * deltaSeconds;
          if (Math.abs(plank.position.z) > channelReachZ) plank.visible = false;
        }
      }
    });

    const api: TideTrialScene = {
      begin(startDeckCm) {
        for (const part of hiddenDuringTrial) part.visible = false;
        group.visible = true;
        deckCm = startDeckCm;
        if (deckPlanks.length === 0) {
          void loadDeckPlanks().catch(() => undefined);
        } else {
          placeDeck(startDeckCm);
        }
        easeWaterTo(TIDE_BOARD.lowWaterCm, 1800);
        context.playNpcGesture(config.npcEntityId, 'Talk', 2);
      },
      setDeckHeight(cm) {
        placeDeck(cm);
      },
      runTide(onLevel) {
        let flooded = false;
        return animateWater(
          TIDE_DURATION_MS,
          (elapsed) => tideLevelAt(elapsed),
          (cm) => {
            // Water level with the underside of the deck is enough to lift it (`evaluateDeck`).
            if (!flooded && cm >= deckCm) {
              flooded = true;
              startFloatingAway();
            }
            onLevel(cm);
          },
        );
      },
      rebuild(cm) {
        placeDeck(cm);
        easeWaterTo(TIDE_BOARD.lowWaterCm, 1500);
      },
      complete() {
        context.removeCollider(config.bridgeColliderId);
        easeWaterTo(SETTLED_WATER_CM, 2500);
        context.playNpcGesture(config.npcEntityId, 'Wave', 3);
      },
      cancel() {
        group.visible = false;
        for (const part of hiddenDuringTrial) part.visible = true;
        floatingPlanks = [];
        easeWaterTo(restingWaterCm, 1500);
      },
    };

    return {
      api,
      dispose() {
        disposed = true;
        stopFrames();
        // Release anyone awaiting a tide, so an unmounted panel's promise does not hang.
        waterAnimation?.resolve();
        waterAnimation = null;
        boardTexture?.dispose();
        for (const geometry of ownedGeometries) geometry.dispose();
        for (const material of ownedMaterials) material.dispose();
        context.scene.remove(group);
      },
    };
  },
};
