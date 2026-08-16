import Phaser from 'phaser';
import { WorldEventBus } from '../worldEvents';
import {
  isInteractionAvailable,
  WELCOME_HARBOR_INTERACTIONS,
  type WorldInteraction,
  type WorldInteractionContext,
} from '../worldObjects';
import { WELCOME_HARBOR_ZONES } from '../zones';
import {
  HARBOR_COLLIDING_TILES,
  HARBOR_TILE_COLORS,
  HARBOR_TILE_GRID,
  TILE_SIZE,
  WORLD_HEIGHT,
  WORLD_WIDTH,
} from '../tilemap';
import { prefersReducedMotion } from '../../../lib/motionPreference';

export { WORLD_WIDTH, WORLD_HEIGHT };
export const WELCOME_HARBOR_SCENE_KEY = 'welcome-harbor';

const AVATAR_RADIUS = 16;
const AVATAR_SPEED = 220;
const NPC_ID = 'talk-to-chatty';
const TILESET_KEY = 'harbor-tileset';

interface ZoneRecord {
  interaction: WorldInteraction;
  rect: Phaser.Geom.Rectangle;
}

interface WasdKeys {
  W: Phaser.Input.Keyboard.Key;
  A: Phaser.Input.Keyboard.Key;
  S: Phaser.Input.Keyboard.Key;
  D: Phaser.Input.Keyboard.Key;
}

/**
 * Welcome Harbor: a real tile-based map (`../tilemap.ts`, rendered from a
 * procedurally generated tileset texture since no binary asset pipeline
 * exists yet, matching the ChattyAvatar/plank-icon precedent), keyboard +
 * touch avatar movement with per-tile water collision, camera follow, a
 * Chatty NPC, and interaction zones sourced from `../zones.ts`. Proves the
 * Phase 9 vertical slice; does not attempt Phase 10's production harbor.
 *
 * All gameplay-relevant signals leave the scene only through `bus`
 * (docs/ARCHITECTURE.md "World engine layering") — this class never touches
 * React state, adventure state, or AI directly.
 */
export class WelcomeHarborScene extends Phaser.Scene {
  private readonly bus: WorldEventBus;
  private readonly interactionContext: WorldInteractionContext;
  private readonly reducedMotion: boolean;

  private avatar!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private npc: Phaser.GameObjects.Sprite | null = null;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private wasd: WasdKeys | null = null;
  private touchTarget: Phaser.Math.Vector2 | null = null;

  private zones: ZoneRecord[] = [];
  private activeZoneIds = new Set<string>();

  constructor(bus: WorldEventBus, interactionContext: WorldInteractionContext) {
    super({ key: WELCOME_HARBOR_SCENE_KEY });
    this.bus = bus;
    this.interactionContext = interactionContext;
    this.reducedMotion = prefersReducedMotion();
  }

  create(): void {
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.createZones();
    const groundLayer = this.createTilemap();
    this.createAvatar();
    if (groundLayer) {
      this.physics.add.collider(this.avatar, groundLayer);
    }
    this.createNpc();
    this.createControls();

    const followLerp = this.reducedMotion ? 1 : 0.15;
    this.cameras.main.startFollow(this.avatar, true, followLerp, followLerp);
  }

  update(): void {
    this.moveAvatar();
    this.bus.emit('AVATAR_MOVED', { position: { x: this.avatar.x, y: this.avatar.y } });
    this.updateZoneOverlaps();
  }

  /** Adds the ground layer to the display list before the avatar/NPC so it renders as the background; returns it so `create()` can wire collision once the avatar exists. */
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

    const map = this.make.tilemap({
      data: HARBOR_TILE_GRID,
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
    this.zones = WELCOME_HARBOR_INTERACTIONS.map((interaction) => {
      const rect = WELCOME_HARBOR_ZONES[interaction.id];
      return {
        interaction,
        rect: new Phaser.Geom.Rectangle(rect.x, rect.y, rect.width, rect.height),
      };
    });
  }

  private createAvatar(): void {
    const texture = this.make.graphics({ x: 0, y: 0 }, false);
    texture.fillStyle(0xf4d35e, 1);
    texture.fillCircle(AVATAR_RADIUS, AVATAR_RADIUS, AVATAR_RADIUS);
    texture.lineStyle(2, 0xc97a1a, 1);
    texture.strokeCircle(AVATAR_RADIUS, AVATAR_RADIUS, AVATAR_RADIUS);
    texture.generateTexture('child-avatar', AVATAR_RADIUS * 2, AVATAR_RADIUS * 2);
    texture.destroy();

    const startZone = WELCOME_HARBOR_ZONES['broken-bridge'];
    const startX = Math.min(120, startZone ? startZone.x - 80 : 120);
    this.avatar = this.physics.add.sprite(startX, 320, 'child-avatar');
    this.avatar.setCircle(AVATAR_RADIUS);
    this.avatar.setCollideWorldBounds(true);
  }

  /** A simple two-frame parrot, distinct from the avatar circle, that idle-bobs unless reduced motion is set. */
  private createNpc(): void {
    const zone = WELCOME_HARBOR_ZONES[NPC_ID];
    if (!zone) {
      return;
    }
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0x2f8f4e, 1);
    graphics.fillEllipse(20, 24, 26, 32);
    graphics.fillStyle(0xf4d35e, 1);
    graphics.fillEllipse(20, 30, 12, 16);
    graphics.fillStyle(0xf2a541, 1);
    graphics.fillTriangle(28, 20, 40, 24, 28, 28);
    graphics.fillStyle(0x1b2733, 1);
    graphics.fillCircle(26, 16, 2.5);
    graphics.generateTexture('chatty-npc', 44, 40);
    graphics.destroy();

    const centerX = zone.x + zone.width / 2;
    const centerY = zone.y + zone.height / 2;
    this.npc = this.add
      .sprite(centerX, centerY, 'chatty-npc')
      .setInteractive({ useHandCursor: true });

    if (!this.reducedMotion) {
      this.tweens.add({
        targets: this.npc,
        y: centerY - 6,
        duration: 700,
        yoyo: true,
        repeat: -1,
        ease: 'Sine.easeInOut',
      });
    }
  }

  private createControls(): void {
    if (this.input.keyboard) {
      this.cursors = this.input.keyboard.createCursorKeys();
      this.wasd = this.input.keyboard.addKeys('W,S,A,D') as WasdKeys;
    }

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      if (this.npc && this.input.hitTestPointer(pointer).includes(this.npc)) {
        this.tryTriggerInteraction(NPC_ID);
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

  /** APPROACH/ENTER interactions fire as soon as the avatar walks in; TAP/USE interactions (like the NPC) fire from `createControls`'s pointerdown handler. */
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
