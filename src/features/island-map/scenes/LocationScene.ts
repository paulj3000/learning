import Phaser from 'phaser';
import { WorldEventBus } from '../worldEvents';
import {
  isInteractionAvailable,
  type WorldInteraction,
  type WorldInteractionContext,
} from '../worldObjects';
import type { PixelRect } from '../zones';
import type { NpcDefinition } from '../npcs';
import type { DecorDefinition } from '../decor';
import { getAvatarAppearance } from '../avatarAppearance';
import type { HarborTileId } from '../tilemap';
import { TILE_SIZE } from '../tilemap';
import { prefersReducedMotion } from '../../../lib/motionPreference';

const AVATAR_RADIUS = 16;
const AVATAR_SPEED = 220;
const NPC_FOLLOW_LERP = 0.12;

/** Swaps one tile id for another once `changeKey` is recorded for this child. */
export interface TileOverrideRule {
  changeKey: string;
  from: HarborTileId;
  to: HarborTileId;
}

/**
 * Everything a `LocationScene` needs to render one explorable location.
 * Every field is Phaser-free data sourced from a location's own
 * `*Tilemap.ts`/`*Zones.ts`/`npcs.ts`/`decor.ts` modules — this class stays
 * a thin renderer over whichever location's config it is given, matching
 * the roadmap's "adding an adventure [should be] primarily a
 * content-authoring task" goal (section 39) one level up, at the world-map
 * layer.
 */
export interface LocationSceneConfig {
  sceneKey: string;
  interactions: WorldInteraction[];
  zones: Record<string, PixelRect>;
  npcs: NpcDefinition[];
  decor: DecorDefinition[];
  waterShimmerPoints: { x: number; y: number }[];
  tileGrid: HarborTileId[][];
  tileColors: readonly number[];
  collidingTiles: readonly HarborTileId[];
  tileOverrides: TileOverrideRule[];
  avatarSpawn: { x: number; y: number };
  worldWidth: number;
  worldHeight: number;
}

interface ZoneRecord {
  interaction: WorldInteraction;
  rect: Phaser.Geom.Rectangle;
}

interface TappableRecord {
  gameObject: Phaser.GameObjects.GameObject;
  interactionId: string;
}

interface NpcRuntime {
  def: NpcDefinition;
  sprite: Phaser.GameObjects.Sprite;
  /** Position before this frame's idle bob offset, tracked separately so bob never accumulates. */
  baseX: number;
  baseY: number;
}

interface WasdKeys {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
}

/**
 * A generic explorable-location Phaser scene, extracted from Phase 9/10's
 * original `WelcomeHarborScene` once Phase 11 introduced a second location
 * (Pirate Builder Bay) needing the same engine: tile-based rendering from a
 * procedurally generated tileset texture, keyboard + touch avatar movement
 * with per-tile collision, camera follow, a data-driven NPC framework with
 * following behavior, static decor/doors/signs, ambient animation, and
 * interaction zones. `WelcomeHarborScene.ts` and `PirateBuilderBayScene.ts`
 * are now both thin subclasses that just supply their own
 * `LocationSceneConfig`.
 *
 * All gameplay-relevant signals leave the scene only through `bus`
 * (docs/ARCHITECTURE.md "World engine layering") — this class never touches
 * React state, adventure state, or AI directly.
 */
export class LocationScene extends Phaser.Scene {
  private readonly locationConfig: LocationSceneConfig;
  private readonly bus: WorldEventBus;
  private readonly interactionContext: WorldInteractionContext;
  private readonly reducedMotion: boolean;
  private readonly avatarKey: string;
  private readonly tilesetKey: string;

  private avatar!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private wasd: WasdKeys | null = null;
  private touchTarget: Phaser.Math.Vector2 | null = null;

  private zones: ZoneRecord[] = [];
  private activeZoneIds = new Set<string>();
  private npcs: NpcRuntime[] = [];
  private tappables: TappableRecord[] = [];
  private swayTargets: Phaser.GameObjects.GameObject[] = [];
  private shimmerTargets: Phaser.GameObjects.GameObject[] = [];

  constructor(
    config: LocationSceneConfig,
    bus: WorldEventBus,
    interactionContext: WorldInteractionContext,
    avatarKey: string,
  ) {
    super({ key: config.sceneKey });
    this.locationConfig = config;
    this.bus = bus;
    this.interactionContext = interactionContext;
    this.reducedMotion = prefersReducedMotion();
    this.avatarKey = avatarKey;
    this.tilesetKey = `${config.sceneKey}-tileset`;
  }

  create(): void {
    const { worldWidth, worldHeight } = this.locationConfig;
    this.physics.world.setBounds(0, 0, worldWidth, worldHeight);
    this.cameras.main.setBounds(0, 0, worldWidth, worldHeight);

    this.createZones();
    const groundLayer = this.createTilemap();
    this.createDecor();
    this.createAvatar();
    if (groundLayer) {
      this.physics.add.collider(this.avatar, groundLayer);
    }
    this.createNpcs();
    this.createControls();

    const followLerp = this.reducedMotion ? 1 : 0.15;
    this.cameras.main.startFollow(this.avatar, true, followLerp, followLerp);
  }

  update(time: number): void {
    this.moveAvatar();
    this.bus.emit('AVATAR_MOVED', { position: { x: this.avatar.x, y: this.avatar.y } });
    this.updateNpcFollow();
    this.updateAmbientAnimation(time);
    this.updateZoneOverlaps();
  }

  /** Adds the ground layer to the display list before decor/avatar/NPCs so it renders as the background. */
  private createTilemap(): Phaser.Tilemaps.TilemapLayer | Phaser.Tilemaps.TilemapGPULayer | null {
    const { tileColors, tileGrid, tileOverrides, collidingTiles } = this.locationConfig;
    const canvasTexture = this.textures.createCanvas(
      this.tilesetKey,
      TILE_SIZE * tileColors.length,
      TILE_SIZE,
    );
    const ctx = canvasTexture?.getContext();
    if (canvasTexture && ctx) {
      tileColors.forEach((color, index) => {
        ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        ctx.fillRect(index * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE);
      });
      canvasTexture.refresh();
    }

    let grid = tileGrid;
    for (const override of tileOverrides) {
      if (this.interactionContext.worldChangeKeys.includes(override.changeKey)) {
        grid = grid.map((line) =>
          line.map((tile) => (tile === override.from ? override.to : tile)),
        );
      }
    }

    const map = this.make.tilemap({
      data: grid,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const tileset = map.addTilesetImage(
      this.tilesetKey,
      this.tilesetKey,
      TILE_SIZE,
      TILE_SIZE,
      0,
      0,
    );
    const layer = tileset ? map.createLayer(0, tileset, 0, 0) : null;
    if (layer) {
      layer.setCollision([...collidingTiles]);
    }
    return layer;
  }

  private createZones(): void {
    this.zones = this.locationConfig.interactions.flatMap((interaction) => {
      const rect = this.locationConfig.zones[interaction.zoneId ?? interaction.id];
      // TAP/USE interactions (NPCs, decor) intentionally have no zone entry.
      if (!rect) {
        return [];
      }
      return [
        { interaction, rect: new Phaser.Geom.Rectangle(rect.x, rect.y, rect.width, rect.height) },
      ];
    });
  }

  private createAvatar(): void {
    const appearance = getAvatarAppearance(this.avatarKey);
    const texture = this.make.graphics({ x: 0, y: 0 }, false);
    texture.fillStyle(appearance.body, 1);
    // Inset by 2px so the stroke (which extends 1px past the fill radius) and every accessory
    // shape stay fully inside the AVATAR_RADIUS*2 canvas — Phase 9's version drew the fill at
    // the full radius, so its stroke was clipped at the canvas edge and simply never rendered.
    texture.fillCircle(AVATAR_RADIUS, AVATAR_RADIUS, AVATAR_RADIUS - 2);
    texture.lineStyle(2, appearance.accent, 1);
    texture.strokeCircle(AVATAR_RADIUS, AVATAR_RADIUS, AVATAR_RADIUS - 2);
    this.drawAvatarAccessory(texture, appearance.accessory, appearance.accent);
    const avatarTextureKey = `${this.locationConfig.sceneKey}-child-avatar`;
    texture.generateTexture(avatarTextureKey, AVATAR_RADIUS * 2, AVATAR_RADIUS * 2);
    texture.destroy();

    const { avatarSpawn } = this.locationConfig;
    this.avatar = this.physics.add.sprite(avatarSpawn.x, avatarSpawn.y, avatarTextureKey);
    this.avatar.setCircle(AVATAR_RADIUS);
    this.avatar.setCollideWorldBounds(true);
  }

  /**
   * A small accessory shape distinguishing each avatarKey, drawn on top of the base circle.
   * Every coordinate stays within the AVATAR_RADIUS*2 canvas (no negative y, e.g. an ear or
   * antenna poking up past the top edge) — Graphics content outside those bounds is silently
   * clipped by `generateTexture`, not just visually cropped, so it would never appear at all.
   */
  private drawAvatarAccessory(
    graphics: Phaser.GameObjects.Graphics,
    accessory: ReturnType<typeof getAvatarAppearance>['accessory'],
    accent: number,
  ): void {
    graphics.fillStyle(accent, 1);
    switch (accessory) {
      case 'EARS':
        graphics.fillTriangle(4, 8, 12, 8, 8, 1);
        graphics.fillTriangle(20, 8, 28, 8, 24, 1);
        return;
      case 'ANTENNA':
        graphics.fillRect(AVATAR_RADIUS - 1, 2, 2, 6);
        graphics.fillCircle(AVATAR_RADIUS, 2, 3);
        return;
      case 'FIN':
        graphics.fillTriangle(AVATAR_RADIUS, 3, AVATAR_RADIUS - 6, 10, AVATAR_RADIUS + 6, 10);
        return;
      case 'SPIKES':
        graphics.fillTriangle(6, 8, 10, 8, 8, 2);
        graphics.fillTriangle(14, 6, 18, 6, 16, 1);
        graphics.fillTriangle(22, 8, 26, 8, 24, 2);
        return;
      case 'NONE':
        return;
    }
  }

  private createNpcs(): void {
    this.npcs = this.locationConfig.npcs.map((def) => {
      const graphics = this.make.graphics({ x: 0, y: 0 }, false);
      graphics.fillStyle(def.palette.body, 1);
      graphics.fillEllipse(20, 24, 26, 32);
      graphics.fillStyle(def.palette.belly, 1);
      graphics.fillEllipse(20, 30, 12, 16);
      graphics.fillStyle(def.palette.beak, 1);
      graphics.fillTriangle(28, 20, 40, 24, 28, 28);
      graphics.fillStyle(def.palette.eye, 1);
      graphics.fillCircle(26, 16, 2.5);
      const textureKey = `${this.locationConfig.sceneKey}-npc-${def.id}`;
      graphics.generateTexture(textureKey, 44, 40);
      graphics.destroy();

      const sprite = this.add.sprite(def.spawn.x, def.spawn.y, textureKey).setInteractive({
        useHandCursor: true,
      });
      this.tappables.push({ gameObject: sprite, interactionId: def.interactionId });

      return { def, sprite, baseX: def.spawn.x, baseY: def.spawn.y };
    });
  }

  private createDecor(): void {
    for (const decor of this.locationConfig.decor) {
      if (
        decor.requiredChangeKey &&
        !this.interactionContext.worldChangeKeys.includes(decor.requiredChangeKey)
      ) {
        continue;
      }
      const sprite = this.drawDecorSprite(decor);
      this.tappables.push({ gameObject: sprite, interactionId: decor.interactionId });
      if (decor.ambientAnimation === 'SWAY' && !this.reducedMotion) {
        this.swayTargets.push(sprite);
      }
    }

    for (const point of this.locationConfig.waterShimmerPoints) {
      const shimmer = this.add.circle(point.x, point.y, 5, 0x9fd8e8, 0.5);
      if (!this.reducedMotion) {
        this.shimmerTargets.push(shimmer);
      }
    }
  }

  private drawDecorSprite(decor: DecorDefinition): Phaser.GameObjects.Sprite {
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    const size = { width: 24, height: 32 };
    switch (decor.shape) {
      case 'SIGN':
        graphics.fillStyle(0x8a5a34, 1);
        graphics.fillRect(10, 12, 4, 20);
        graphics.fillStyle(0xd8c48a, 1);
        graphics.fillRect(0, 0, 24, 14);
        break;
      case 'TREE':
        graphics.fillStyle(0x8a5a34, 1);
        graphics.fillRect(10, 16, 4, 16);
        graphics.fillStyle(0x2f8f4e, 1);
        graphics.fillCircle(12, 12, 12);
        break;
      case 'DOOR':
        graphics.fillStyle(0x5a3d24, 1);
        graphics.fillRoundedRect(2, 0, 20, 32, 4);
        graphics.fillStyle(0xf4d35e, 1);
        graphics.fillCircle(18, 18, 2);
        break;
      case 'CHARACTER':
        // Pirate Pip: boots, a coat, a head, and a tricorn hat.
        graphics.fillStyle(0x2b2b2b, 1);
        graphics.fillRect(6, 26, 5, 6);
        graphics.fillRect(13, 26, 5, 6);
        graphics.fillStyle(0x2f5d8a, 1);
        graphics.fillRoundedRect(4, 12, 16, 16, 3);
        graphics.fillStyle(0xd9a066, 1);
        graphics.fillCircle(12, 9, 7);
        graphics.fillStyle(0x1b2733, 1);
        graphics.fillTriangle(2, 8, 22, 8, 12, 0);
        break;
      case 'ROPE':
        graphics.lineStyle(3, 0x8a5a34, 1);
        graphics.strokeCircle(12, 16, 9);
        graphics.strokeCircle(12, 16, 5);
        break;
      case 'TOOLBOX':
        graphics.fillStyle(0xc0392b, 1);
        graphics.fillRoundedRect(1, 10, 22, 16, 3);
        graphics.fillStyle(0x8a5a34, 1);
        graphics.fillRect(9, 4, 6, 8);
        break;
      case 'CHEST':
        graphics.fillStyle(0x6b3f1d, 1);
        graphics.fillRoundedRect(1, 12, 22, 16, 3);
        graphics.fillStyle(0x8a5a34, 1);
        graphics.fillRoundedRect(1, 6, 22, 10, 6);
        graphics.fillStyle(0xf4d35e, 1);
        graphics.fillRect(10, 14, 4, 6);
        break;
      case 'HIVE':
        graphics.fillStyle(0xe8b923, 1);
        graphics.fillEllipse(12, 20, 20, 22);
        graphics.fillStyle(0xd9a066, 1);
        graphics.fillRect(2, 14, 20, 3);
        graphics.fillRect(3, 20, 18, 3);
        graphics.fillStyle(0x3a2a12, 1);
        graphics.fillCircle(12, 26, 3);
        break;
      case 'FROG':
        graphics.fillStyle(0x4caf50, 1);
        graphics.fillEllipse(12, 24, 18, 12);
        graphics.fillCircle(6, 16, 4);
        graphics.fillCircle(18, 16, 4);
        graphics.fillStyle(0x1b2733, 1);
        graphics.fillCircle(6, 15, 1.5);
        graphics.fillCircle(18, 15, 1.5);
        break;
      case 'LEAVES':
        graphics.fillStyle(0xd35400, 1);
        graphics.fillEllipse(8, 24, 10, 6);
        graphics.fillStyle(0xf2a541, 1);
        graphics.fillEllipse(16, 22, 10, 6);
        graphics.fillStyle(0xc0392b, 1);
        graphics.fillEllipse(12, 27, 10, 6);
        break;
      case 'CAVE':
        graphics.fillStyle(0x6b6b6b, 1);
        graphics.fillCircle(12, 14, 12);
        graphics.fillRect(0, 14, 24, 18);
        graphics.fillStyle(0x14141c, 1);
        graphics.fillEllipse(12, 24, 12, 16);
        break;
      case 'MOON':
        graphics.fillStyle(0x1b2a4a, 1);
        graphics.fillRoundedRect(0, 0, 24, 32, 4);
        graphics.fillStyle(0xf4ecd8, 1);
        graphics.fillCircle(13, 12, 8);
        graphics.fillStyle(0x1b2a4a, 1);
        graphics.fillCircle(17, 9, 7);
        graphics.fillStyle(0xf4ecd8, 1);
        graphics.fillCircle(6, 22, 1.5);
        graphics.fillCircle(19, 24, 1.5);
        break;
      case 'PORTRAIT':
        graphics.fillStyle(0x8a5a34, 1);
        graphics.fillRoundedRect(1, 1, 22, 28, 2);
        graphics.fillStyle(0xf4ecd8, 1);
        graphics.fillRect(4, 4, 16, 22);
        graphics.fillStyle(0xd9a066, 1);
        graphics.fillCircle(12, 12, 5);
        graphics.fillStyle(0x2f5d8a, 1);
        graphics.fillTriangle(6, 24, 18, 24, 12, 15);
        break;
      case 'WINDOW':
        graphics.fillStyle(0x5a3d24, 1);
        graphics.fillRoundedRect(0, 0, 24, 32, 4);
        graphics.fillStyle(0x9fd8e8, 1);
        graphics.fillRect(4, 4, 16, 22);
        graphics.fillStyle(0x5a3d24, 1);
        graphics.fillRect(11, 4, 2, 22);
        graphics.fillRect(4, 14, 16, 2);
        break;
      case 'WARDROBE':
        graphics.fillStyle(0x6b3f1d, 1);
        graphics.fillRoundedRect(1, 0, 22, 32, 2);
        graphics.fillStyle(0x8a5a34, 1);
        graphics.fillRect(11, 0, 2, 32);
        graphics.fillStyle(0xf4d35e, 1);
        graphics.fillCircle(9, 16, 1.5);
        graphics.fillCircle(15, 16, 1.5);
        break;
      case 'BOOKSHELF':
        graphics.fillStyle(0x6b3f1d, 1);
        graphics.fillRect(0, 0, 24, 32);
        graphics.fillStyle(0xc0392b, 1);
        graphics.fillRect(2, 3, 4, 10);
        graphics.fillStyle(0x2f8f4e, 1);
        graphics.fillRect(7, 3, 4, 10);
        graphics.fillStyle(0x2f5d8a, 1);
        graphics.fillRect(12, 3, 4, 10);
        graphics.fillStyle(0xf2a541, 1);
        graphics.fillRect(17, 3, 4, 10);
        graphics.fillStyle(0xd9a066, 1);
        graphics.fillRect(2, 17, 19, 10);
        break;
      case 'EASEL':
        graphics.fillStyle(0x8a5a34, 1);
        graphics.fillTriangle(2, 32, 8, 6, 12, 32);
        graphics.fillTriangle(22, 32, 16, 6, 12, 32);
        graphics.fillStyle(0xf4ecd8, 1);
        graphics.fillRect(4, 8, 16, 16);
        break;
      case 'DRAGON':
        graphics.fillStyle(0xd35400, 1);
        graphics.fillTriangle(0, 22, 10, 10, 10, 26);
        graphics.fillTriangle(23, 22, 14, 10, 14, 26);
        graphics.fillEllipse(12, 22, 18, 16);
        graphics.fillCircle(12, 10, 7);
        graphics.fillStyle(0xf2a541, 1);
        graphics.fillEllipse(12, 26, 8, 6);
        graphics.fillStyle(0xf4d35e, 1);
        graphics.fillCircle(10, 8, 1.5);
        break;
      case 'EGG':
        graphics.fillStyle(0xf4d35e, 1);
        graphics.fillEllipse(12, 20, 16, 20);
        graphics.fillStyle(0xf2a541, 1);
        graphics.fillCircle(9, 14, 2);
        graphics.fillCircle(15, 22, 2);
        break;
      case 'BUTTERFLY':
        graphics.fillStyle(0xe685c9, 1);
        graphics.fillEllipse(7, 12, 10, 8);
        graphics.fillEllipse(17, 12, 10, 8);
        graphics.fillStyle(0xf4d35e, 1);
        graphics.fillEllipse(8, 20, 7, 6);
        graphics.fillEllipse(16, 20, 7, 6);
        graphics.fillStyle(0x1b2733, 1);
        graphics.fillRect(11, 8, 2, 18);
        break;
      case 'SKELETON':
        graphics.fillStyle(0xf4ecd8, 1);
        graphics.fillEllipse(10, 8, 8, 6);
        graphics.fillRect(9, 12, 3, 16);
        graphics.fillTriangle(2, 16, 12, 14, 2, 22);
        graphics.fillTriangle(23, 18, 12, 20, 23, 26);
        graphics.fillRect(6, 26, 3, 6);
        graphics.fillRect(14, 26, 3, 6);
        break;
      case 'DESK':
        graphics.fillStyle(0x8a5a34, 1);
        graphics.fillRect(1, 10, 22, 4);
        graphics.fillRect(2, 14, 3, 12);
        graphics.fillRect(19, 14, 3, 12);
        graphics.fillStyle(0xf4ecd8, 1);
        graphics.fillRect(7, 5, 10, 5);
        break;
      case 'ROBOT':
        graphics.fillStyle(0xb0b8bf, 1);
        graphics.fillRoundedRect(4, 10, 16, 16, 3);
        graphics.fillRect(7, 3, 10, 8);
        graphics.fillStyle(0xf2a541, 1);
        graphics.fillCircle(9, 7, 1.5);
        graphics.fillCircle(15, 7, 1.5);
        graphics.fillStyle(0x1b2733, 1);
        graphics.fillRect(2, 22, 5, 8);
        graphics.fillRect(17, 22, 5, 8);
        break;
    }
    const textureKey = `${this.locationConfig.sceneKey}-decor-${decor.id}`;
    graphics.generateTexture(textureKey, size.width, size.height);
    graphics.destroy();

    return this.add.sprite(decor.position.x, decor.position.y, textureKey).setInteractive({
      useHandCursor: true,
    });
  }

  private createControls(): void {
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,S,A,D') as WasdKeys;
    }

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      const hit = this.input.hitTestPointer(pointer);
      const tapped = this.tappables.find((record) => hit.includes(record.gameObject));
      if (tapped) {
        this.tryTriggerInteraction(tapped.interactionId);
        return;
      }
      const worldPoint = this.cameras.main.getWorldPoint(pointer.x, pointer.y);
      this.touchTarget = new Phaser.Math.Vector2(worldPoint.x, worldPoint.y);
    });
  }

  private moveAvatar(): void {
    const velocity = new Phaser.Math.Vector2(0, 0);
    const left = Boolean(this.cursors?.left.isDown || this.wasd?.A.isDown);
    const right = Boolean(this.cursors?.right.isDown || this.wasd?.D.isDown);
    const up = Boolean(this.cursors?.up.isDown || this.wasd?.W.isDown);
    const down = Boolean(this.cursors?.down.isDown || this.wasd?.S.isDown);

    if (left) velocity.x -= 1;
    if (right) velocity.x += 1;
    if (up) velocity.y -= 1;
    if (down) velocity.y += 1;

    if (velocity.lengthSq() > 0) {
      this.touchTarget = null;
      velocity.normalize().scale(AVATAR_SPEED);
      this.avatar.setVelocity(velocity.x, velocity.y);
      return;
    }

    if (this.touchTarget) {
      const toTarget = this.touchTarget
        .clone()
        .subtract(new Phaser.Math.Vector2(this.avatar.x, this.avatar.y));
      if (toTarget.length() < 4) {
        this.touchTarget = null;
        this.avatar.setVelocity(0, 0);
      } else {
        toTarget.normalize().scale(AVATAR_SPEED);
        this.avatar.setVelocity(toTarget.x, toTarget.y);
      }
      return;
    }

    this.avatar.setVelocity(0, 0);
  }

  /**
   * Must run after `moveAvatar()` within the same frame. Each NPC maintains
   * at least `followDistancePx` from the avatar rather than chasing its
   * live position directly — a naive "lag behind N recent positions" trail
   * closes the gap to zero and overlaps the avatar once the avatar stops
   * moving for longer than the trail length, which is common (reading a
   * dialogue panel, deciding where to go next). Bob is a computed sine
   * offset applied on top of a separately tracked `baseX`/`baseY` (not a
   * `tweens.add` loop, Phase 9's approach, and not baked into `sprite.y`
   * directly) so it never accumulates frame over frame.
   */
  private updateNpcFollow(): void {
    for (const npc of this.npcs) {
      const dx = npc.baseX - this.avatar.x;
      const dy = npc.baseY - this.avatar.y;
      const distance = Math.hypot(dx, dy);
      if (distance > npc.def.followDistancePx) {
        const ratio = npc.def.followDistancePx / (distance || 1);
        const targetX = this.avatar.x + dx * ratio;
        const targetY = this.avatar.y + dy * ratio;
        const lerp = this.reducedMotion ? 1 : NPC_FOLLOW_LERP;
        npc.baseX = Phaser.Math.Linear(npc.baseX, targetX, lerp);
        npc.baseY = Phaser.Math.Linear(npc.baseY, targetY, lerp);
      }
      const bob = this.reducedMotion ? 0 : Math.sin(this.time.now / 250) * npc.def.idleBobPx;
      npc.sprite.x = npc.baseX;
      npc.sprite.y = npc.baseY + bob;
    }
  }

  private updateAmbientAnimation(time: number): void {
    if (this.reducedMotion) {
      return;
    }
    const sway = Math.sin(time / 400) * 0.05;
    for (const target of this.swayTargets) {
      (target as Phaser.GameObjects.Sprite).rotation = sway;
    }
    const shimmerScale = 1 + Math.sin(time / 500) * 0.15;
    for (const target of this.shimmerTargets) {
      (target as Phaser.GameObjects.Arc).setScale(shimmerScale);
    }
  }

  private updateZoneOverlaps(): void {
    const currentlyInside = new Set<string>();
    const avatarPoint = new Phaser.Math.Vector2(this.avatar.x, this.avatar.y);

    for (const { interaction, rect } of this.zones) {
      if (Phaser.Geom.Rectangle.ContainsPoint(rect, avatarPoint)) {
        currentlyInside.add(interaction.id);
      }
    }

    for (const id of currentlyInside) {
      if (!this.activeZoneIds.has(id)) {
        this.bus.emit('INTERACTION_ZONE_ENTERED', { interactionId: id });
        this.maybeAutoTrigger(id);
      }
    }
    for (const id of this.activeZoneIds) {
      if (!currentlyInside.has(id)) {
        this.bus.emit('INTERACTION_ZONE_EXITED', { interactionId: id });
      }
    }
    this.activeZoneIds = currentlyInside;
  }

  /** APPROACH/ENTER interactions fire as soon as the avatar walks in; TAP/USE interactions fire from `createControls`'s pointerdown handler. */
  private maybeAutoTrigger(interactionId: string): void {
    const record = this.zones.find((zone) => zone.interaction.id === interactionId);
    if (!record) {
      return;
    }
    const { interaction } = record;
    const isAutoTrigger = interaction.trigger === 'APPROACH' || interaction.trigger === 'ENTER';
    if (isAutoTrigger) {
      this.tryTriggerInteraction(interactionId);
    }
  }

  private tryTriggerInteraction(interactionId: string): void {
    const interaction = this.locationConfig.interactions.find((item) => item.id === interactionId);
    if (interaction && isInteractionAvailable(interaction, this.interactionContext)) {
      this.bus.emit('INTERACTION_TRIGGERED', { interactionId });
    }
  }
}
