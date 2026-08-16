import Phaser from 'phaser';
import { WorldEventBus } from '../worldEvents';
import {
  isInteractionAvailable,
  WELCOME_HARBOR_INTERACTIONS,
  type WorldInteraction,
  type WorldInteractionContext,
} from '../worldObjects';

export const WELCOME_HARBOR_SCENE_KEY = 'welcome-harbor';
export const WORLD_WIDTH = 960;
export const WORLD_HEIGHT = 640;

const AVATAR_RADIUS = 16;
const AVATAR_SPEED = 220;

/**
 * Stand-in zone geometry for the Phase 9 prototype. Real map-driven
 * interaction zones arrive with the map pipeline
 * (docs/LEARNING_ADVENTURE_ISLAND_EXPLORABLE_WORLD_ROADMAP.md section 38);
 * `WorldInteraction` itself intentionally carries no position, since that
 * is map data, not object identity.
 */
const ZONE_RECTS: Record<string, Phaser.Types.Math.RectangleLike> = {
  'broken-bridge': { x: 760, y: 220, width: 120, height: 200 },
};

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
 * A minimal, deliberately placeholder Welcome Harbor: no tile/image assets
 * (matching the ChattyAvatar precedent of procedural drawing, since no
 * binary asset pipeline exists yet), keyboard + touch avatar movement,
 * camera follow, and one interaction zone wired to the broken bridge. Proves
 * the Phase 9 vertical slice; does not attempt Phase 10's production harbor.
 *
 * All gameplay-relevant signals leave the scene only through `bus`
 * (docs/ARCHITECTURE.md "World engine layering") — this class never touches
 * React state, adventure state, or AI directly.
 */
export class WelcomeHarborScene extends Phaser.Scene {
  private readonly bus: WorldEventBus;
  private readonly interactionContext: WorldInteractionContext;

  private avatar!: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private cursors: Phaser.Types.Input.Keyboard.CursorKeys | null = null;
  private wasd: WasdKeys | null = null;
  private touchTarget: Phaser.Math.Vector2 | null = null;

  private zones: ZoneRecord[] = [];
  private activeZoneIds = new Set<string>();

  constructor(bus: WorldEventBus, interactionContext: WorldInteractionContext) {
    super({ key: WELCOME_HARBOR_SCENE_KEY });
    this.bus = bus;
    this.interactionContext = interactionContext;
  }

  create(): void {
    this.physics.world.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    this.cameras.main.setBounds(0, 0, WORLD_WIDTH, WORLD_HEIGHT);

    this.drawGround();
    this.createZones();
    this.createAvatar();
    this.createControls();

    this.cameras.main.startFollow(this.avatar, true, 0.15, 0.15);
  }

  update(): void {
    this.moveAvatar();
    this.bus.emit('AVATAR_MOVED', { position: { x: this.avatar.x, y: this.avatar.y } });
    this.updateZoneOverlaps();
  }

  private drawGround(): void {
    const graphics = this.add.graphics();
    graphics.fillStyle(0x1c3a52, 1);
    graphics.fillRect(0, 0, WORLD_WIDTH, WORLD_HEIGHT);
    graphics.fillStyle(0xd8c48a, 1);
    graphics.fillRect(0, 0, WORLD_WIDTH, 420);
    graphics.fillStyle(0x2f8f4e, 1);
    graphics.fillRect(0, 0, 220, WORLD_HEIGHT);

    const bridgeRect = ZONE_RECTS['broken-bridge'];
    graphics.fillStyle(0x8a5a34, 1);
    graphics.fillRect(bridgeRect.x, bridgeRect.y, bridgeRect.width, bridgeRect.height * 0.35);
  }

  private createZones(): void {
    this.zones = WELCOME_HARBOR_INTERACTIONS.map((interaction) => {
      const rect = ZONE_RECTS[interaction.id];
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

    this.avatar = this.physics.add.sprite(120, 320, 'child-avatar');
    this.avatar.setCircle(AVATAR_RADIUS);
    this.avatar.setCollideWorldBounds(true);
  }

  private createControls(): void {
    if (!this.input.keyboard) {
      return;
    }
    this.cursors = this.input.keyboard.createCursorKeys();
    this.wasd = this.input.keyboard.addKeys('W,S,A,D') as WasdKeys;

    this.input.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
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

  /** APPROACH/ENTER interactions fire as soon as the avatar walks in; TAP/USE wait for input (not yet built in this prototype). */
  private maybeAutoTrigger(interactionId: string): void {
    const record = this.zones.find((zone) => zone.interaction.id === interactionId);
    if (!record) {
      return;
    }
    const { interaction } = record;
    const isAutoTrigger = interaction.trigger === 'APPROACH' || interaction.trigger === 'ENTER';
    if (isAutoTrigger && isInteractionAvailable(interaction, this.interactionContext)) {
      this.bus.emit('INTERACTION_TRIGGERED', { interactionId });
    }
  }
}
