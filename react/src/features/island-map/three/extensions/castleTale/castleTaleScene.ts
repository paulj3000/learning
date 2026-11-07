import { Box3, Color, LoopOnce, LoopRepeat, Mesh, Object3D, PointLight, Vector3 } from 'three';
import type { StorybookSceneState } from '../../../../great-storybook/scene';
import {
  STORYBOOK_PART_IDS,
  STORYBOOK_COLOURS,
} from '../../runtime/manifests/castleRooms/greatLibrary';
import { ENTRY_MURAL_PARCHMENT } from '../../runtime/manifests/castleRooms/entryHall';
import { areRequirementsMet, type WorldInteractionContext } from '../../../worldObjects';
import {
  SECRET_PASSAGE_SEAL_ID,
  SECRET_SEAL_SURFACE_IDS,
} from '../../runtime/manifests/castleRooms/secretChamber';
import {
  castleRoomAt,
  planTravel,
  type CastleRoomId,
  type CastleTravelPlan,
  type CastleTravelRefusal,
} from '../../castleLayout';
import { EASEL_CANVASES, resolveEaselCanvas } from '../../castleEaselCanvas';
import { BINDING_SOCKET_LOCAL_X } from '../../storykeeperCastleRegion';
import type { WorldExtension, WorldExtensionContext } from '../../runtime/extensionRegistry';
import { createSeatingPuzzle, type SeatingPuzzle } from './seatingPuzzle';
import { tryParseCastleTaleConfig } from './castleTaleConfig';
import { cloneAssetScene } from '../../assets/cloneAsset';

/**
 * Storykeeper Castle's bespoke half, as a registered extension (engine
 * Phase 9, ADR-032 part J). Moved out of `storykeeperCastleScene.ts` with
 * its behaviour unchanged, and it is *behaviour* rather than art, which is
 * what made the castle the last region to migrate:
 *
 * - the state variants that flip mid-visit - a portrait lit, a window
 *   brightened, the hearth burning, the book on the shelf, the carpet
 *   running on, the door ajar, the worn carving revealed;
 * - Keeper Quill's gestures, which play once and *hold*, because a gesture
 *   is wayfinding the child needs still there when they look up from the
 *   HUD;
 * - the three seating puzzles (`seatingPuzzle.ts`), one implementation for
 *   plates into a lectern, clues onto a wall and rods into a lock;
 * - beat 7's easel, composed from seven layers rather than nine canvases.
 *
 * Everything static is manifest scenery, every focusable thing is a
 * manifest prop whose root this fills in, and the runtime still owns focus,
 * labels, pickup and disposal. **Nothing here decides anything**: which
 * portrait is lit comes from the session the React half holds, and whether
 * an answer was right stays with the Adventure Engine.
 */

/** What the React half calls. The same ten methods the per-region engine exposed. */
export interface CastleTaleSceneApi {
  /** Settles once every state variant and canvas layer has been placed. Never rejects. */
  readonly ready: Promise<void>;
  showChosenHero(entityId: string | null): void;
  showChosenSetting(entityId: string | null): void;
  playQuillClip(clip: CastleQuillClip, facing?: CastleQuillFacing): void;
  resetBindingPlates(active?: readonly string[]): void;
  resetLibraryClues(): void;
  resetPatternLockRods(): void;
  showSecretDoorOpened(opened: boolean): void;
  showEaselPainting(heroOptionId: string | null, settingOptionId: string | null): void;
  showStoryTold(told: boolean): void;
  /**
   * SM-P8: where Keeper Quill stands, for his voice. Writes his world position into `out` and
   * returns false once he has left the scene; `undefined` if the scene has no Quill.
   */
  quillPositionReader(): ((out: [number, number, number]) => boolean) | undefined;
  /**
   * Opens the secret passage behind the tapestry once the nook has been found:
   * takes the seal out of the way and hides the wall fill that covered the gap.
   * Idempotent. The build already leaves both out for a child who found the nook
   * on an earlier visit, so this is only for finding it mid-visit.
   */
  showSecretPassageOpened(opened: boolean): void;
  /**
   * Draws the Great Storybook from the records (SC-R04-03): cover torn or whole, pages
   * back, one slot per required page and the bonus slot once found. Idempotent, and it
   * decides nothing. A closed, empty book is what the scene shows until this is called.
   */
  showStorybook(state: StorybookSceneState): void;
  /** The room the child is standing in, or `undefined` in a wall or outside the castle. */
  currentRoomId(): CastleRoomId | undefined;
  /**
   * The accessible equivalent of walking to a room: places the child at that
   * room's safe spot if the castle's rules allow it (`planTravel`) and the
   * runtime agrees the spot is standable. The castle decides where and
   * whether; the runtime only checks the ground.
   */
  goToRoom(
    roomId: string,
    worldState: WorldInteractionContext,
  ): CastleTravelPlan | CastleTravelRefusal;
}

export type CastleQuillClip = 'Idle' | 'Talk' | 'Point' | 'ReactConcerned' | 'Celebrate';
export type CastleQuillFacing = 'entry' | 'gallery' | 'hearth' | 'nook';

/** Narrows `LocationEngine.extensionApi`'s `unknown` for the React half. */
export function isCastleTaleScene(value: unknown): value is CastleTaleSceneApi {
  return typeof value === 'object' && value !== null && 'playQuillClip' in value;
}

const CASTLE_TALE_EXTENSION_ID = 'castle-tale';

/** Quill's own facings. The hearth and nook ones are derived from where those things are. */
const QUILL_FACING_ENTRY_YAW = -Math.PI / 2;
const QUILL_FACING_GALLERY_YAW = 0;
/** The clips that play once and hold, rather than looping. */
const HELD_CLIPS: readonly CastleQuillClip[] = ['Point', 'ReactConcerned', 'Celebrate'];

/** Where the backdrop's bottom-centre sits on the easel's page, in the easel's own frame. */
const EASEL_PAGE_ORIGIN = { y: 0.91, z: 0.07 };
/**
 * How far a canvas layer is squashed along its depth axis. The pack's canvas
 * pieces are built from the same primitives as everything else, so a
 * mountain peak is a cone - and a cone standing 30cm out of a page is a
 * sculpture, not a picture.
 */
const CANVAS_FLATTEN = 0.02;

const TAPESTRY_SWAY_RADIANS = 0.035;
const TAPESTRY_SWAY_PERIOD_SECONDS = 4;
/**
 * The still equivalent of the sway under reduced motion: the tapestry hangs
 * at a fixed slight lean, as if the draught had left it askew. Same size as
 * the sway's swing, so it is the same hint and no louder.
 */
const TAPESTRY_STILL_LEAN_RADIANS = 0.02;
const DOORWAY_GLOW_COLOR = 0xffc98a;
const DOORWAY_GLOW_INTENSITY = 7;
/** How far in front of the eyes a picked-up plate is carried, and how far below them. */
const CARRY_FORWARD_METERS = 0.55;
const CARRY_DROP_METERS = 0.5;

/**
 * The state variants this extension places that its config does not name:
 * each is the one asset of its kind in the castle, so it stays a constant
 * rather than a config field. Declared through `assetIds` with the config's
 * own portraits and windows and every easel layer.
 */
const CASTLE_TALE_ASSETS = {
  hearth: 'hearth',
  hearthLit: 'hearth-lit',
  shelfSlotEmpty: 'shelf-slot-empty',
  storyBookShelved: 'story-book-shelved',
  carpet: 'carpet',
  secretDoor: 'secret-door',
  secretDoorAjar: 'secret-door-ajar',
  carvingWorn: 'carving-worn',
  carvingWornRevealed: 'carving-worn-revealed',
  bookshelf: 'bookshelf',
  bookshelfAjar: 'bookshelf-ajar',
} as const;

const EASEL_LAYER_ASSET_IDS: readonly string[] = [
  ...new Set(EASEL_CANVASES.flatMap((entry) => [entry.settingAssetId, entry.heroAssetId])),
];

const yawTowards = (from: { x: number; z: number }, to: { x: number; z: number }) =>
  Math.atan2(to.x - from.x, to.z - from.z);

export const castleTaleExtension: WorldExtension = {
  id: CASTLE_TALE_EXTENSION_ID,
  assetIds(rawConfig) {
    const config = tryParseCastleTaleConfig(rawConfig);
    if (!config) return [];
    return [
      ...Object.values(CASTLE_TALE_ASSETS),
      ...[...config.portraits, ...config.windows].flatMap((pair) => [pair.plain, pair.lit]),
      ...EASEL_LAYER_ASSET_IDS,
    ];
  },
  mount(context: WorldExtensionContext) {
    const parsed = tryParseCastleTaleConfig(context.config);
    if (!parsed) {
      console.warn('[castle-tale] ignoring a binding with unreadable config');
      return;
    }
    // Narrowed once, so the hoisted helpers below see a non-null config.
    const config = parsed;

    const loaded: Object3D[] = [];
    const unsubscribes: (() => void)[] = [];
    let storyTold = areRequirementsMet(
      [{ type: 'WORLD_CHANGE_PRESENT', changeKey: config.storyToldChangeKey }],
      context.worldState,
    );
    let secretDoorOpen = false;

    /** A model, cloned and placed; failures are warned about, never fatal. */
    async function place(
      assetId: string,
      at: { x: number; y?: number; z: number },
      yaw: number,
      options: { centre?: boolean; parent?: Object3D; rotationX?: number } = {},
    ): Promise<Object3D | null> {
      try {
        const asset = await context.loadModel(assetId);
        const object = cloneAssetScene(asset.scene);
        // Named after the asset, so a test (and a debugger) can find the
        // state variant it is looking at.
        object.name = assetId;
        object.rotation.y = yaw;
        if (options.rotationX !== undefined) object.rotation.x = options.rotationX;
        const drop = options.centre
          ? new Box3().setFromObject(object).getSize(new Vector3()).y / 2
          : 0;
        object.position.set(at.x, (at.y ?? 0) - drop, at.z);
        (options.parent ?? context.scene).add(object);
        loaded.push(object);
        return object;
      } catch {
        console.warn(`[castle-tale] could not load ${assetId}`);
        return null;
      }
    }

    // --- state variants -----------------------------------------------------

    const portraitVariants = new Map<string, { plain: Object3D; lit: Object3D }>();
    const windowVariants = new Map<string, { plain: Object3D; lit: Object3D }>();
    /** Pairs toggled by `FIRST_STORY_TOLD`, and by the secret door opening. */
    const toldVariants: { told: Object3D; untold: Object3D }[] = [];
    const openedVariants: { opened: Object3D; shut: Object3D }[] = [];
    let chosenHeroEntityId: string | null = null;
    let chosenSettingEntityId: string | null = null;

    function applyVariants(
      variants: Map<string, { plain: Object3D; lit: Object3D }>,
      chosen: string | null,
    ): void {
      for (const [entityId, variant] of variants) {
        const isChosen = chosen === entityId;
        variant.lit.visible = isChosen;
        variant.plain.visible = !isChosen;
      }
    }

    function applyStoryTold(): void {
      for (const variant of toldVariants) {
        variant.told.visible = storyTold;
        variant.untold.visible = !storyTold;
      }
    }

    const doorwayGlow = new PointLight(DOORWAY_GLOW_COLOR, 0, 0, 1.8);
    function applySecretDoorOpened(): void {
      for (const variant of openedVariants) {
        variant.opened.visible = secretDoorOpen;
        variant.shut.visible = !secretDoorOpen;
      }
      // Warm light across the library floor: the one bright thing in the
      // room authored as the castle's darkest.
      doorwayGlow.intensity = secretDoorOpen ? DOORWAY_GLOW_INTENSITY : 0;
    }

    // --- Keeper Quill -------------------------------------------------------

    const quillRoot = context.entityRoot(config.quillEntityId);
    const quillFacingYaw: Readonly<Record<CastleQuillFacing, number>> = {
      entry: QUILL_FACING_ENTRY_YAW,
      gallery: QUILL_FACING_GALLERY_YAW,
      hearth: yawTowards(
        { x: quillRoot?.position.x ?? 0, z: quillRoot?.position.z ?? 0 },
        config.hearth,
      ),
      nook: yawTowards(
        { x: quillRoot?.position.x ?? 0, z: quillRoot?.position.z ?? 0 },
        // The cushioned nook, which is where the swaying tapestry hangs.
        { x: -8.3, z: -5.4 },
      ),
    };

    function playQuillClip(clip: CastleQuillClip, facing?: CastleQuillFacing): void {
      const animator = context.npcAnimator(config.quillEntityId);
      const authored = animator?.clips.find((candidate) => candidate.name === clip);
      if (!animator || !authored) return;
      const action = animator.mixer.clipAction(authored);
      animator.mixer.stopAllAction();
      action.reset();
      if (HELD_CLIPS.includes(clip)) {
        // Once, and held at its end: a gesture is wayfinding the child needs
        // still there when they look up from the HUD.
        action.setLoop(LoopOnce, 1);
        action.clampWhenFinished = true;
      } else {
        action.setLoop(LoopRepeat, Infinity);
        action.clampWhenFinished = false;
      }
      /*
        Where he looks. `Point` defaults to the gallery archway (beat 2's
        wayfinding); everything else looks back at the child, which is also
        what turns him round again after a held gesture.
      */
      if (quillRoot) {
        quillRoot.rotation.y = quillFacingYaw[facing ?? (clip === 'Point' ? 'gallery' : 'entry')];
      }
      action.play();
    }

    // --- the three seating puzzles -----------------------------------------

    const bindingLecternRoot = context.entityRoot('binding-lectern');
    const bindingLecternYaw = bindingLecternRoot?.rotation.y ?? Math.PI;
    const bindingLecternSpot = {
      x: bindingLecternRoot?.position.x ?? 0,
      z: bindingLecternRoot?.position.z ?? 0,
    };
    const platePuzzle = createSeatingPuzzle({
      context,
      targetEntityId: 'binding-lectern',
      pieceEntityIds: ['story-plate-choice', 'story-plate-ending', 'story-plate-problem'],
      slots: BINDING_SOCKET_LOCAL_X.map((offsetX) => ({
        x: bindingLecternSpot.x + offsetX * Math.cos(bindingLecternYaw),
        y: 1.07,
        z: bindingLecternSpot.z - offsetX * Math.sin(bindingLecternYaw),
      })),
      seatedYaw: bindingLecternYaw,
      carry: { forward: CARRY_FORWARD_METERS, drop: CARRY_DROP_METERS },
    });

    const clueWallRoot = context.entityRoot('library-clue-wall');
    const cluePuzzle = createSeatingPuzzle({
      context,
      targetEntityId: 'library-clue-wall',
      pieceEntityIds: ['library-clue-diary', 'library-clue-map', 'library-clue-note'],
      slots: [-0.55, 0, 0.55].map((offset) => ({
        x: (clueWallRoot?.position.x ?? 0) + offset,
        y: clueWallRoot?.position.y ?? 1.6,
        z: clueWallRoot?.position.z ?? 0,
      })),
      seatedYaw: 0,
      carry: { forward: CARRY_FORWARD_METERS, drop: CARRY_DROP_METERS },
    });

    const rodPuzzle = createSeatingPuzzle({
      context,
      targetEntityId: 'secret-door',
      pieceEntityIds: ['lock-rod-silver', 'lock-rod-iron', 'lock-rod-brass'],
      /*
        Laid out along the wall rather than stacked: `order-the-keys` grades
        by length, and three rods side by side at one height is what lets a
        child compare them without picking any of them up again.
      */
      slots: [0.75, 1.15, 1.55].map((y) => ({ x: 11.4, y, z: -9.55 })),
      seatedYaw: 0,
      carry: { forward: CARRY_FORWARD_METERS, drop: CARRY_DROP_METERS },
    });
    const puzzles: readonly SeatingPuzzle[] = [platePuzzle, cluePuzzle, rodPuzzle];

    /*
      Picking a piece up and putting it down are moves inside a puzzle, not
      domain events, so the runtime emits nothing for them - only the
      completed arrangement is worth an event, and `seatingPuzzle.ts` sends
      that one itself.
    */
    unsubscribes.push(
      context.interceptInteract((entityId) => {
        const carrying = puzzles.some((puzzle) => puzzle.carriedId() !== null);
        for (const puzzle of puzzles) {
          if (puzzle.holdsPiece(entityId)) {
            if (!carrying) puzzle.pickUp(entityId);
            return true;
          }
          if (puzzle.targetEntityId === entityId) {
            puzzle.seatCarried();
            return true;
          }
        }
        return false;
      }),
    );

    // --- the easel ----------------------------------------------------------

    const easelGroup = new Object3D();
    easelGroup.position.set(config.easel.x, 0, config.easel.z);
    easelGroup.rotation.y = config.easel.yaw;
    context.scene.add(easelGroup);
    loaded.push(easelGroup);
    const canvasLayers = new Map<string, Object3D>();
    let paintedHeroOptionId: string | null = null;
    let paintedSettingOptionId: string | null = null;

    function applyEaselPainting(): void {
      const painting = resolveEaselCanvas(paintedHeroOptionId, paintedSettingOptionId);
      for (const [assetId, layer] of canvasLayers) {
        layer.visible =
          painting !== undefined &&
          (assetId === painting.heroAssetId || assetId === painting.settingAssetId);
      }
      if (!painting) return;
      const hero = canvasLayers.get(painting.heroAssetId);
      if (hero) {
        hero.position.set(
          painting.heroOffset.x,
          EASEL_PAGE_ORIGIN.y + painting.heroOffset.y,
          EASEL_PAGE_ORIGIN.z + 0.02,
        );
        hero.scale.set(painting.heroScale, painting.heroScale, CANVAS_FLATTEN);
      }
    }

    // --- build --------------------------------------------------------------

    async function build(): Promise<void> {
      // Both states of every portrait, in the prop's own root, so a chosen
      // portrait stays something the reticle can read rather than a hole.
      for (const portrait of config.portraits) {
        const root = context.entityRoot(portrait.entityId);
        if (!root) continue;
        const [plain, lit] = await Promise.all([
          place(portrait.plain, { x: 0, z: 0 }, 0, { centre: true, parent: root }),
          place(portrait.lit, { x: 0, z: 0 }, 0, { centre: true, parent: root }),
        ]);
        if (plain && lit) portraitVariants.set(portrait.entityId, { plain, lit });
      }
      applyVariants(portraitVariants, chosenHeroEntityId);

      // The three tower windows' backdrops, sitting just beyond their frames.
      for (const window of config.windows) {
        const [plain, lit] = await Promise.all([
          place(window.plain, { x: window.x, z: window.z }, window.yaw),
          place(window.lit, { x: window.x, z: window.z }, window.yaw),
        ]);
        if (plain && lit) windowVariants.set(window.entityId, { plain, lit });
      }
      applyVariants(windowVariants, chosenSettingEntityId);

      // Beat 8: the hearth lit, the book on the shelf, the carpet running on.
      const [hearth, hearthLit] = await Promise.all([
        place(CASTLE_TALE_ASSETS.hearth, config.hearth, 0),
        place(CASTLE_TALE_ASSETS.hearthLit, config.hearth, 0),
      ]);
      if (hearth && hearthLit) toldVariants.push({ told: hearthLit, untold: hearth });

      const [slotEmpty, shelved] = await Promise.all([
        place(CASTLE_TALE_ASSETS.shelfSlotEmpty, config.shelfSlot, config.shelfSlot.yaw, {
          centre: true,
        }),
        place(CASTLE_TALE_ASSETS.storyBookShelved, config.shelfSlot, config.shelfSlot.yaw, {
          centre: true,
        }),
      ]);
      if (slotEmpty && shelved) toldVariants.push({ told: shelved, untold: slotEmpty });

      const carpetExtension = new Object3D();
      context.scene.add(carpetExtension);
      loaded.push(carpetExtension);
      await Promise.all(
        config.carpetExtension.map((tile) =>
          place(CASTLE_TALE_ASSETS.carpet, tile, tile.rotationY, { parent: carpetExtension }),
        ),
      );
      // An extension with no "before" state: an empty object stands in for
      // the untold half, so it is toggled like any other pair.
      toldVariants.push({ told: carpetExtension, untold: new Object3D() });
      applyStoryTold();

      /*
        Beat 10's payoff and beat 11's way in: the door ajar, the worn
        carving revealed as the moon it always was, and the last bookshelf
        swung aside. The shut door is also the pattern lock a rod is seated
        into, so both states go in that prop's root.
      */
      const doorRoot = context.entityRoot('secret-door');
      if (doorRoot) {
        const [shut, ajar] = await Promise.all([
          place(CASTLE_TALE_ASSETS.secretDoor, { x: 0, z: 0 }, 0, {
            centre: true,
            parent: doorRoot,
          }),
          place(CASTLE_TALE_ASSETS.secretDoorAjar, { x: 0, z: 0 }, 0, {
            centre: true,
            parent: doorRoot,
          }),
        ]);
        if (shut && ajar) openedVariants.push({ opened: ajar, shut });
      }

      const [worn, revealed] = await Promise.all([
        place(CASTLE_TALE_ASSETS.carvingWorn, config.wornCarving, config.wornCarving.yaw, {
          rotationX: -Math.PI / 2,
        }),
        place(CASTLE_TALE_ASSETS.carvingWornRevealed, config.wornCarving, config.wornCarving.yaw, {
          rotationX: -Math.PI / 2,
        }),
      ]);
      if (worn && revealed) openedVariants.push({ opened: revealed, shut: worn });

      const [shelfShut, shelfAjar] = await Promise.all([
        place(CASTLE_TALE_ASSETS.bookshelf, config.lastBookshelf, config.lastBookshelf.yaw),
        place(CASTLE_TALE_ASSETS.bookshelfAjar, config.lastBookshelf, config.lastBookshelf.yaw),
      ]);
      if (shelfShut && shelfAjar) openedVariants.push({ opened: shelfAjar, shut: shelfShut });

      doorwayGlow.position.set(doorRoot?.position.x ?? 0, 1.4, (doorRoot?.position.z ?? 0) + 0.9);
      context.scene.add(doorwayGlow);
      loaded.push(doorwayGlow);
      applySecretDoorOpened();

      // Beat 7: every canvas layer, loaded up front and hidden until a story
      // earns one, so the picture costs no fetch at the moment it is painted.
      for (const assetId of EASEL_LAYER_ASSET_IDS) {
        const layer = await place(assetId, { x: 0, y: EASEL_PAGE_ORIGIN.y, z: 0 }, 0, {
          parent: easelGroup,
        });
        if (!layer) continue;
        layer.position.z = EASEL_PAGE_ORIGIN.z;
        layer.scale.z = CANVAS_FLATTEN;
        layer.visible = false;
        canvasLayers.set(assetId, layer);
      }
      applyEaselPainting();

      // Every piece of every puzzle starts where it was authored.
      for (const puzzle of puzzles) puzzle.reset();
      playQuillClip('Idle');
    }

    const ready = build().catch(() => undefined);

    /*
      Beat 12's draught: the tapestry in the hub's south-west corner stirs
      very slightly, and that movement is the *only* thing marking the
      castle's one unmarked secret. Small enough to read as a draught rather
      than as a signpost, and the frame callback is the whole animation.
    */
    const swayingTapestry = context.sceneryRoot(config.swayingTapestrySceneryId);
    const swayRest = swayingTapestry?.rotation.y ?? 0;
    let elapsedSeconds = 0;
    // Reduced motion: no sway. The tapestry holds a fixed lean instead, so the hint survives without movement.
    if (context.reducedMotion && swayingTapestry) {
      swayingTapestry.rotation.y = swayRest + TAPESTRY_STILL_LEAN_RADIANS;
    }
    unsubscribes.push(
      context.onFrame((deltaSeconds) => {
        elapsedSeconds += deltaSeconds;
        if (swayingTapestry && !context.reducedMotion) {
          swayingTapestry.rotation.y =
            swayRest +
            Math.sin((elapsedSeconds / TAPESTRY_SWAY_PERIOD_SECONDS) * Math.PI * 2) *
              TAPESTRY_SWAY_RADIANS;
        }
        for (const puzzle of puzzles) puzzle.frame();
      }),
    );

    // The Great Storybook: parts are manifest scenery, found by id. Closed and empty until told.
    const paint = (root: Object3D | undefined, colour: number) => {
      root?.traverse((node) => {
        const material = node instanceof Mesh ? node.material : undefined;
        if (material && !Array.isArray(material) && 'color' in material) {
          (material.color as Color).setHex(colour);
        }
      });
    };
    const slotRoots = STORYBOOK_PART_IDS.slots.map((id) => context.sceneryRoot(id));
    let shownSlots: boolean[] | undefined;
    let pulseUntil = 0;
    const pulsing = new Set<number>();
    const PULSE_SECONDS = 1.2;
    const setStorybook = (state: StorybookSceneState) => {
      const pagesBack = state.required.some(Boolean) || state.bonusFound;
      const pages = context.sceneryRoot(STORYBOOK_PART_IDS.pages);
      if (pages) pages.visible = pagesBack;
      paint(
        context.sceneryRoot(STORYBOOK_PART_IDS.cover),
        state.complete ? STORYBOOK_COLOURS.coverWhole : STORYBOOK_COLOURS.coverTorn,
      );
      paint(
        context.sceneryRoot(ENTRY_MURAL_PARCHMENT.id),
        state.complete ? ENTRY_MURAL_PARCHMENT.whole : ENTRY_MURAL_PARCHMENT.blank,
      );
      const bonusIndex = STORYBOOK_PART_IDS.slots.length - 1;
      const back = slotRoots.map((_, i) =>
        i === bonusIndex ? state.bonusFound : (state.required[i] ?? false),
      );
      slotRoots.forEach((root, i) => {
        if (!root) return;
        const exists = i === bonusIndex ? state.bonusFound : i < state.required.length;
        root.visible = exists;
        paint(root, back[i] ? STORYBOOK_COLOURS.slotBack : STORYBOOK_COLOURS.slotMissing);
        if (shownSlots && back[i] && !shownSlots[i] && !context.reducedMotion) {
          pulsing.add(i);
          pulseUntil = elapsedSeconds + PULSE_SECONDS;
        }
      });
      shownSlots = back;
    };
    unsubscribes.push(
      context.onFrame(() => {
        if (pulsing.size === 0) return;
        const left = pulseUntil - elapsedSeconds;
        const scale = left > 0 ? 1 + 0.25 * Math.sin((1 - left / PULSE_SECONDS) * Math.PI) : 1;
        for (const i of pulsing) slotRoots[i]?.scale.setScalar(scale);
        if (left <= 0) pulsing.clear();
      }),
    );
    setStorybook({ required: [], bonusFound: false, complete: false });
    shownSlots = undefined; // the first push from the records primes it, so a returning child sees no pulse

    const api: CastleTaleSceneApi = {
      ready,
      quillPositionReader() {
        const root = quillRoot;
        if (!root) return undefined;
        return (out) => {
          if (root.parent === null) return false;
          root.updateWorldMatrix(true, false);
          const e = root.matrixWorld.elements;
          out[0] = e[12] as number;
          out[1] = e[13] as number;
          out[2] = e[14] as number;
          return true;
        };
      },
      showStorybook: setStorybook,
      showChosenHero(entityId) {
        chosenHeroEntityId = entityId;
        applyVariants(portraitVariants, entityId);
      },
      showChosenSetting(entityId) {
        chosenSettingEntityId = entityId;
        applyVariants(windowVariants, entityId);
      },
      playQuillClip,
      resetBindingPlates: (active) => platePuzzle.reset(active),
      resetLibraryClues: () => cluePuzzle.reset(),
      resetPatternLockRods: () => rodPuzzle.reset(),
      showSecretDoorOpened(opened) {
        secretDoorOpen = opened;
        applySecretDoorOpened();
      },
      showEaselPainting(heroOptionId, settingOptionId) {
        paintedHeroOptionId = heroOptionId;
        paintedSettingOptionId = settingOptionId;
        applyEaselPainting();
      },
      showStoryTold(told) {
        storyTold = told;
        applyStoryTold();
      },
      showSecretPassageOpened(opened) {
        if (!opened) return;
        context.removeCollider(SECRET_PASSAGE_SEAL_ID);
        for (const id of SECRET_SEAL_SURFACE_IDS) {
          const fill = context.sceneryRoot(id);
          if (fill) fill.visible = false;
        }
      },
      currentRoomId() {
        const { x, z } = context.childPlacement();
        return castleRoomAt(x, z)?.id;
      },
      goToRoom(roomId, worldState) {
        const plan = planTravel(api.currentRoomId(), roomId, worldState);
        if (!plan.ok) return plan;
        // The castle says yes; the ground still has the last word.
        return context.placeChild(plan.placement)
          ? plan
          : { ok: false, reason: 'blocked', message: 'You cannot get there yet.' };
      },
    };

    return {
      api,
      dispose() {
        for (const unsubscribe of unsubscribes) unsubscribe();
        for (const object of loaded) object.removeFromParent();
      },
    };
  },
};
