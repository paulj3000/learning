import Phaser from 'phaser';
import { WorldEventBus } from '../worldEvents';
import {
  isInteractionAvailable,
  WELCOME_HARBOR_INTERACTIONS,
  type WorldInteraction,
  type WorldInteractionContext,
} from '../worldObjects';
import { WELCOME_HARBOR_ZONES } from '../zones';
import { WELCOME_HARBOR_NPCS, type NpcDefinition } from '../npcs';
import {
  WELCOME_HARBOR_DECOR,
  WELCOME_HARBOR_WATER_SHIMMER_POINTS,
  type DecorDefinition,
} from '../decor';
import { getAvatarAppearance } from '../avatarAppearance';
import {
  applyTileOverride,
  HARBOR_COLLIDING_TILES,
  HARBOR_TILE_COLORS,
  HARBOR_TILE_GRID,
  HarborTile,
  TILE_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../tilemap';
import { prefersReducedMotion } from '../../../lib/motionPreference';

export { WORLD_WIDTH, WORLD_HEIGHT };
export const WELCOME_HARBOR_SCENE_KEY = 'welcome-harbor';

const AVATAR_RADIUS = 16;
const AVATAR_SPEED = 220;
const TILESET_KEY = 'harbor-tileset';
const NPC_FOLLOW_LERP = 0.12;

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
 * Welcome Harbor, Phase 10's production explorable environment
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 29):
 * a tile-based map (`../tilemap.ts`) rendered from a procedurally generated
 * tileset texture (no binary asset pipeline exists yet), keyboard + touch
 * avatar movement with per-tile water collision, camera follow, a
 * data-driven NPC framework (`../npcs.ts`) with Chatty following the avatar,
 * static decor/doors/signs (`../decor.ts`), ambient animation, and
 * interaction zones sourced from `../zones.ts`. Stays a thin renderer: all
 * map/NPC/decor/appearance *data* lives in Phaser-free modules so it can be
 * unit-tested without a rendering context; this class only turns that data
 * into sprites, tweens, and input handling.
 *
 * All gameplay-relevant signals leave the scene only through `bus`
 * (docs/ARCHITECTURE.md "World engine layering") — this class never touches
 * React state, adventure state, or AI directly.
 */
export class WelcomeHarborScene extends Phaser.Scene {
  private readonly bus: WorldEventBus;
  private readonly interactionContext: WorldInteractionContext;
  private readonly reducedMotion: boolean;
  private readonly avatarKey: string;

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

  constructor(bus: WorldEventBus, interactionContext: WorldInteractionContext, avatarKey: string) {
    super({ key: WELCOME_HARBOR_SCENE_KEY });
    this.bus = bus;
    this.interactionContext = interactionContext;
    this.reducedMotion = prefersReducedMotion();
    this.avatarKey = avatarKey;
  }

  create(): void {
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

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
    const canvasTexture = this.textures.createCanvas(
      TILESET_KEY,
      TILE_SIZE * HARBOR_TILE_COLORS.length,
      TILE_SIZE,
    );
    const ctx = canvasTexture?.getContext();
    if (canvasTexture && ctx) {
      HARBOR_TILE_COLORS.forEach((color, index) => {
        ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        ctx.fillRect(index * TILE_SIZE, 0, TILE_SIZE, TILE_SIZE);
      });
      canvasTexture.refresh();
    }

    const bridgeRepaired = this.interactionContext.worldChangeKeys.includes('BRIDGE_REPAIRED');
    const grid = bridgeRepaired
      ? applyTileOverride(
          HARBOR_TILE_GRID,
          HarborTile.BRIDGE_PLANK,
          HarborTile.BRIDGE_PLANK_REPAIRED,
        )
      : HARBOR_TILE_GRID;

    const map = this.make.tilemap({
      data: grid,
      tileWidth: TILE_SIZE,
      tileHeight: TILE_SIZE,
    });
    const tileset = map.addTilesetImage(TILESET_KEY, TILESET_KEY, TILE_SIZE, TILE_SIZE, 0, 0);
    const layer = tileset ? map.createLayer(0, tileset, 0, 0) : null;
    if (layer) {
      layer.setCollision([...HARBOR_COLLIDING_TILES]);
    }
    return layer;
  }

  private createZones(): void {
    this.zones = WELCOME_HARBOR_INTERACTIONS.flatMap((interaction) => {
      const rect = WELCOME_HARBOR_ZONES[interaction.zoneId ?? interaction.id];
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
    texture.generateTexture('child-avatar', AVATAR_RADIUS * 2, AVATAR_RADIUS * 2);
    texture.destroy();

    const bridgeZone = WELCOME_HARBOR_ZONES['broken-bridge'];
    const startX = Math.min(120, bridgeZone ? bridgeZone.x - 80 : 120);
    this.avatar = this.physics.add.sprite(startX, 320, 'child-avatar');
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
    this.npcs = WELCOME_HARBOR_NPCS.map((def) => {
      const graphics = this.make.graphics({ x: 0, y: 0 }, false);
      graphics.fillStyle(def.palette.body, 1);
      graphics.fillEllipse(20, 24, 26, 32);
      graphics.fillStyle(def.palette.belly, 1);
      graphics.fillEllipse(20, 30, 12, 16);
      graphics.fillStyle(def.palette.beak, 1);
      graphics.fillTriangle(28, 20, 40, 24, 28, 28);
      graphics.fillStyle(def.palette.eye, 1);
      graphics.fillCircle(26, 16, 2.5);
      const textureKey = `npc-${def.id}`;
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
    for (const decor of WELCOME_HARBOR_DECOR) {
      const sprite = this.drawDecorSprite(decor);
      this.tappables.push({ gameObject: sprite, interactionId: decor.interactionId });
      if (decor.ambientAnimation === 'SWAY' && !this.reducedMotion) {
        this.swayTargets.push(sprite);
      }
    }

    for (const point of WELCOME_HARBOR_WATER_SHIMMER_POINTS) {
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
    }
    const textureKey = `decor-${decor.id}`;
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
    const interaction = WELCOME_HARBOR_INTERACTIONS.find((item) => item.id === interactionId);
    if (interaction && isInteractionAvailable(interaction, this.interactionContext)) {
      this.bus.emit('INTERACTION_TRIGGERED', { interactionId });
    }
  }
}
