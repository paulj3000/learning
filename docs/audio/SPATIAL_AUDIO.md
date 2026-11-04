# Spatial audio (SM-P7)

Status: development complete and unit-tested on `feature/sound-manager` (2026-11-03) with the fake
audio engine and fake Web Audio context. **Not heard.** Panning, distance falloff, the listener
following the camera and the Lookout wind bed need your ears in a browser.

There is one audio engine, one `AudioContext` and one channel mix. Spatial audio adds a
`PannerNode` between a voice's gain and its channel, so master volume, channel volume, mute,
reduced intensity, ducking, scopes, handles and diagnostics all still apply to a positional sound.

## 1. Audit (SM-P7-01)

| Question | Finding |
|---|---|
| Who owns the `AudioContext`? | `createWebAudioEngine` (one per page, created lazily on the first play or unlock). The shared Sound Manager owns the engine. Three.js creates none. |
| How is Three.js sound reached? | Not at all before this phase. The scene (`regionPlayScene.ts`) and the React companion were silent; TR-19 added only a sink for cue moments. |
| Do we use `THREE.AudioListener` / `PositionalAudio`? | No. They would create a second context or a second listener. We use Web Audio nodes on the engine's context directly, and a **structural** adapter (`audio/world/threeBindings.ts`) that reads an object's `matrixWorld` without importing `three`. |
| The camera | `context.camera` in the engine; the scene API now exposes it as a world-matrix source. The listener pose is its world position, local -Z (forward) and local Y (up). |
| The player's position | The engine's controller position; zone entry events came from `WorldTriggerTracker`. There was **no exit event**. |
| Treasure Rush zones | Four volumes in `treasure_cove_layout.py`: landing, grove, beach, ruins. **Lookout Point had no zone.** |
| Object positions | `context.entityRoot(entityId)` gives every chest, pickup and NPC root; gates are procedural groups. |
| StrictMode | The companion and the audio hook already survive remounts; spatial additions follow the same rule (no permanent disposal in effect cleanup). |

## 2. Engine (SM-P7-02, SM-P7-08)

```ts
manager.play('sfx.chest.open', {
  spatial: { position: [4, 0, 12], refDistance: 3, maxDistance: 40, rolloffFactor: 1 },
});
manager.setListener({ position, forward, up });   // every frame, allocation free
handle.setPosition(x, y, z); handle.setOrientation(x, y, z);
manager.getSpatialStats(); // { supported, active, limit }
```

- **Options.** `position` `[x, y, z]` in metres; `refDistance`, `maxDistance`, `rolloffFactor`, `distanceModel` (`linear`, `inverse`, `exponential`); directional sound with `orientation` and `coneInnerAngle`, `coneOuterAngle`, `coneOuterGain`. Panning is equal-power (cheap and predictable).
- **Staff defaults.** A `SoundDefinition.spatial` block (from the manifest) supplies distances. The game supplies the position and may override distances. `enabled: false` forbids positional playback of that sound whatever the game asks.
- **Validation.** Bad values (position not three finite numbers, `refDistance` <= 0, `maxDistance` <= `refDistance`, negative rolloff, bad cone angles) are reported as an `invalid-spatial` diagnostic and the sound **plays flat** rather than not at all.
- **Fallback.** An engine that cannot place sounds (`supportsSpatial` false) plays them flat.
- **Limits and culling.** At most 12 positional sounds at once. A new one nearer than the farthest steals its place; a farther one is dropped (`voice-limit` diagnostic). A one-shot starting beyond its `maxDistance` from the listener is not started (it would be inaudible). Loops are ranged by the emitters (below).
- **Cleanup.** The panner is disconnected with the voice; positional sounds belong to a scope, so disposing the scope stops them and later plays resolve `null`.
- **Mix.** Because the panner feeds the channel node, `setMasterVolume`, `muteChannel`, reduced-intensity mode and voice ducking apply unchanged.

## 3. Emitters (SM-P7-03)

`audio/world/SpatialEmitters.ts`, no game names, no Three.js import.

```ts
const emitters = createSpatialEmitters({ player: scope, setListener: (p) => manager.setListener(p) });
emitters.add({ id: 'fall', soundId: 'ambient.cove.waterfall', loop: true,
               spatial: { maxDistance: 30 }, read: objectPositionReader(waterfallObject) });
// once per frame, in the scene loop (not React):
emitters.setListener(cameraListener.update());
emitters.update();
```

- A position is a **reader function** (`(out) => boolean`), so the emitter holds no Three.js object, only the closure you give it, and drops it on `remove()`/`dispose()`. A reader returning false (the object left the scene) removes the emitter.
- Static and moving sources use the same path; moves smaller than 1 cm are not sent to the engine. The per-frame path allocates nothing when nothing moves.
- **Loops are range-aware** with 2 m hysteresis: they stop beyond range and resume when the listener returns, so distant sources cost nothing.
- One-shots: `emitter.start()` or `emitters.playAt(soundId, at)`.
- A sound that cannot play is silent and is not retried every frame. Removing an emitter while its sound is still loading leaves nothing playing. Disposing the scope removes everything and restarts nothing.
- Adapters for Three.js in `threeBindings.ts`: `objectPositionReader`, `fixedPosition`, `createCameraListener` (reused pose object).

## 4. Environmental zones (SM-P7-04)

`audio/world/AudioZones.ts` picks one ambient bed from the zones the child is in.

- Overlap: the highest `priority` wins; a tie goes to the most recently entered. A zone with no cue is skipped. No zone with a cue: the `defaultCue`; none: fade to silence.
- A zone whose cue has no audio falls back to the default bed.
- Transitions are crossfades through the shared `MusicDirector`; a bed is never doubled, re-entering a zone that shares the current bed does not restart it, and a burst of enters and exits ends on the right bed.
- `deactivate()`/`activate()` for StrictMode; `dispose()` or disposing the scope stops everything and ignores later events.
- `zonesFromAssignments(manifest.assignments)` builds zones from **Django**: assignments with target type `zone`, event `on_enter`, and a priority.

## 5. Lookout Point and Treasure Rush (SM-P7-05, SM-P7-06)

Facts from the code: Lookout Point is the sand and plaza strip at z -44 to -40.4, reachable only
over the bridge that the first quest lays (TR-17). The gate and the water hold until then.

Changes (no geometry, collider, route, progression or reward changed):

- **Zone exit events.** `WorldTriggerTracker` reports `leftZoneIds` (present only on a frame where a zone was left) and the engine emits `PlayerLeftZone`. The existing step shape for a quiet frame is unchanged.
- **A Lookout zone** `cove-zone-lookout` (x -36..36, z -44..-40.4) was added to the layout (`treasure_cove_layout.py` and its JSON snapshot). It is a trigger volume only. Tests prove it is **never entered while the gate holds**, is entered after crossing the bridge, and is left on the way back. Its enter message is a toast. **Existing databases need `seed_treasure_rush` (and a publish of the region) to pick the new zone up.**
- **Cue.** `ambient.treasure_rush.wind` is now a **required** cue (the Treasure Rush list is 16 cues). Priorities: ruins 3; grove and Lookout 2; landing and beach 1. Staff can override cue and priority with a `zone` assignment on the 3D Area.
- **Positional one-shots.** `sfx.chest.open` and `sfx.treasure.reveal` at the chest, `sfx.key.discover` at the key, `sfx.world.bridge_open` at the gate (`refDistance` 3 m, `maxDistance` 40 m). Positions come from the real scene objects through new scene API readers.
- **Stays flat on purpose:** correct and retry feedback, puzzle and quest completion, rewards, music, and any instruction. Essential narration never depends on position.
- **Listener.** The camera feeds the listener once per frame from the scene's own loop.
- Not done: nearby environmental effects (waterfalls, wind chimes) because no such cues or objects exist; the emitters are ready for them. NPC dialogue positions arrive with SM-P8.

## 6. Django configuration (SM-P7-07)

Existing models extended (migration `0004_spatial_audio_settings`), edited in Django Admin only.

| Where | Field | Meaning |
|---|---|---|
| Sound cue | Positional audio | Game decides (default, key omitted), Positional (use the distances), Never positional (`enabled: false`) |
| Sound cue | Full-volume distance, maximum distance, rolloff, distance model | Only with Positional |
| Sound cue | Inner and outer cone angle, outside-cone volume | Directional sound, only with Positional |
| Sound cue | Loop | Already existed |
| Sound assignment | Target type `zone`, events `on_enter` and `on_exit` | An ambient bed for a named zone of a 3D Area; the id is checked against the Area's layout zones |
| Sound assignment | Priority 0 to 100 | Overlap order for zones |
| Sound assignment | Target = object, NPC, chest | The source attachment target (already existed) |

Validation (model, admin and publish): distances only when Positional; `maxDistance` > `refDistance`;
rolloff 0 to 10; cone outer >= inner; angles 0 to 360; cone gain 0 to 1 and only with a cone; zone
ids must exist in the Area's layout. Invalid combinations block publishing like any other.

**Manifest compatibility.** `sounds[].spatial` and `assignments[].priority` are **optional**: a cue
the game decides has no `spatial` key, and a zero priority is omitted. Older clients ignore both
(their parser copies known fields only); older releases without the keys still build manifests
(tested). The schema version is unchanged.

## 7. Tests (SM-P7-09)

Engine (`AudioEngine.spatial.test.ts`): one context, panner parameters, move and orient,
disconnect on stop, listener, no panner for plain sounds. Manager (`SoundManager.spatial.test.ts`):
resolution and staff defaults, moving, invalid options, unsupported engine, listener, range culling,
voice cap, scope disposal, mute and master and reduced intensity. Emitters, zones and Three.js
bindings (31 tests). Treasure Rush (`treasureRushAudio.test.tsx`): zone exits, Lookout wind,
priority overlap, rapid transitions, placed one-shots, flat feedback, frame-driven listener,
cleanup, StrictMode, mute, missing audio. Engine tracker and Lookout engine tests for exits and the
zone. Django: validation, manifest schema, backward compatibility, zone targets.

## 8. Integration example for a future adventure

```tsx
const player = useSoundScope('my-adventure');
const emitters = useMemo(() => createSpatialEmitters({ player, setListener: (p) => manager.setListener(p) }), [...]);
useEffect(() => scene.onFrame(() => { emitters.setListener(listener.update()); emitters.update(); }), [...]);
emitters.add({ id: npc.id, soundId: 'voice.my_adventure.greeting', read: objectPositionReader(npc.root) });
const zones = createAudioZones({ player, zones: zonesFromAssignments(manifest.assignments), autoStart: false });
bus.on('PlayerEnteredZone', ({ zoneId }) => zones.enter(zoneId));
bus.on('PlayerLeftZone', ({ zoneId }) => zones.exit(zoneId));
```

## 9. Limits

- Not heard. Panner behavior, falloff and the HRTF-free equal-power panning were not auditioned.
- No occlusion, reverb or doppler; distance and direction only.
- Streamed (long) sounds can be positional, but a streamed source cannot be restarted mid-way by range culling; use loops that decode (not `stream`) for ranged emitters.
- Zone exit events exist only for the Three.js world engine; the Phaser worlds have none.
- The 12-voice cap and 40 m range are conservative defaults, not tuned by ear.
