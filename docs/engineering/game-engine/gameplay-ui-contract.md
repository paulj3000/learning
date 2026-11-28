# Shared gameplay UI contract (GE-101)

Status: Development Complete on `feature/shared-fullscreen-gameplay-ui` (issue #101, Trello #257);
not owner-accepted. Owner: LAI 04 (Game Engine Core). Applies to every 3D realm rendered by
`ThreeLocationWorldView` (Storykeeper Castle, Treasure Cove / Treasure Rush, Firepeak, North Pole,
and the shipped TypeScript regions) and to the engine sandbox.

## 1. The defect and its cause

Owner playtest 2026-11-26: in full screen, Treasure Rush showed "Camera view", "Sprint with Shift"
(reported as "Spring View") and "Things to do here" across about half of the screen.

- `WorldStage` puts its *parent* (the view's `.wrapper`) in full screen, so the dialogue layers
  rendered beside the canvas stay visible.
- `.wrapper:fullscreen` is a viewport-high column. The stage took what was left, and every other
  child (`:where(.wrapper:fullscreen > :not([data-world-stage]))`) could take up to 45vh.
- The three panels were in-flow siblings below the stage. On a phone they took 40 to 50% of the
  height. GE-090-D8 (Trello #249, PR #67) had already met the symptom: it measured the gap
  (`--child-stage-bottom-gap`) so dialogue panels cleared the exits, and set a 23rem stage floor.
  It never moved the panels, which was out of its scope. GE-101 removes the cause. GE-090-D8's
  inset mechanism stays, and the gap is now 0 in the normal layout.

## 2. Who owns what

| Layer | Owner | Where |
|---|---|---|
| Stage, full screen, exits, toolbar, menus | Engine (shared) | `WorldStage.tsx`, `GameplayMenus.tsx` |
| Canvas sizing | Engine (shared) | `ThreeGameContainer.module.css` (4:3 or 3:4 on the page, fills in full screen) |
| HUD: quest cue, focus prompt, toast, backpack, jump, camera button | Engine (shared) | `WorldHud.tsx` |
| Settings (camera view, sprint) and the exploration list | Engine (shared) | `ThreeLocationWorldView.tsx` menus |
| Touch controls (drag to move and look, jump button) | Engine (shared) | `game/src/input/pointerControls.ts`, `WorldHud` |
| Realm HUD controls (Treasure Rush Hint, Sound, Backpack) | Realm | portal into `hudSlot` (bottom right) |
| NPC speech | Realm / NPC Manager | portal into `speechSlot` (top centre) |
| Dialogue, puzzles, interaction panels | Realm / NPC Manager | fixed layers, shown only while open |
| Scoring results | LAI 06 (Scoring) through the realm | toast plus the puzzle panel's result step (section 4) |

## 3. Rules

1. **The canvas gets the viewport.** In full screen the wrapper has no padding or gap, and nothing
   that is open all the time sits in flow beside the stage. A one-line status may stay; it scrolls
   inside itself.
2. **No permanent panels.** Settings, the exploration list, inventory, help and map are menus or
   overlays, closed by default, and at most one is open at a time.
3. **Menus overlay the canvas** (`GameplayMenus`, in the stage toolbar beside "Full screen").
   Opening one never resizes the stage, rebuilds the scene or moves the camera. Escape or "Close"
   shuts it and gives focus back to its button.
4. **An item that starts something closes its menu** (content gets `close`). A dialogue, puzzle or
   interaction panel opening for any reason closes any open menu (`suspended`).
5. **Essential HUD overlays the canvas**, in fixed regions: top left, the quest cue; top right, the
   companion and "Go back to …"; centre, the reticle and action prompt; bottom left, the toolbar
   ("Full screen", menus, and "Leave island" above it in full screen); bottom right, jump, camera,
   backpack and realm controls. A realm adds controls through `hudSlot` and `speechSlot` only,
   never as page content below the stage.
6. **Exits are always reachable.** "Exit full screen" is always in the toolbar while full screen,
   and "Leave island" sits above it (AP-04). Menu panels open above both (`:fullscreen .panel`
   moves up by 7rem). Esc also leaves full screen; that is the browser's own behaviour.
7. **Keyboard.** Every control is a real button or radio, and focus is visible. Key presses inside
   the toolbar or a menu stay there. The engine listens on `window`, so Space on a focused button
   would otherwise jump and cancel the press, and arrows would walk. Key releases still reach the
   engine, so no key is left held.
8. **Touch.** Targets are at least 44px. Below 600px the menu buttons are icon-only, and the label
   stays their accessible name. The toolbar is one row, kept clear of the right-hand column. The
   layer lets pointers through, so drags on the canvas still move and look.
9. **Reduced motion.** Menus do not animate. The engine reads `prefers-reduced-motion` itself.
10. **iPhone Safari (no element full screen).** There is no "Full screen" button, and the menus
    still work.

## 4. Elements

| Element | Contract |
|---|---|
| HUD | `WorldHud`, an overlay. Quest cue (one line), companion, focus prompt, a single transient toast (`showToast(string)`, cleared by the view), backpack, jump and camera buttons. Nothing in the HUD counts down. |
| Quest objectives | The quest cue line in the HUD. Detail belongs in a menu (for example "Things to do"), never in a persistent panel. |
| Inventory | The backpack button opens a small panel (`WorldHud`, or the realm's own through `hudSlot` with `ownsBackpack`). Closed by default. |
| Settings | The "Settings" menu: camera view (when the region allows switching) and sprint mode (when sprint is on). Shown only when there is something to set. Choices apply at once and are remembered per child. |
| Map | No in-world map yet. A future map is a menu in the toolbar, like settings. |
| Camera options | The HUD camera button (a quick toggle) and the Settings menu (an explicit choice). Both go through `setCameraMode` and `toggleCameraMode`, with no scene rebuild. |
| Help | The realm's Hint control (Treasure Rush) through `hudSlot`. The exploration list is the non-graphical way to everything in the scene. |
| Pause | No pause: there are no time limits (ADR-053). Opening a menu does not stop the world; nothing in it is timed. |
| Full screen | The `WorldStage` toggle, `aria-pressed`. Leaving the region leaves full screen. |
| Exit | "Go back to …" (HUD top right, when the manifest asks for it), "Leave island" (in full screen), and the page link below the stage on the page. |
| NPC interactions | The NPC Manager and realm dialogue panels, fixed, shown only while a conversation is open. Speech bubbles go through `speechSlot`. |
| Puzzles and scoring | The puzzle panel, shown only while open. A result shows in the panel's own result step (skill practised from the solve outcome's `skillPracticed`, and stars when scoring has them) and as one toast line. Stars come from the scoring summary after the solve, not the solve response, and appear only when that summary says the economy is enabled; otherwise no star UI at all, never "0 stars". XP and support level are not shown on the child HUD (LAI 06, #102). |

## 5. Realm compatibility (assessed 2026-11-26 against `main` `41ee7320`)

All four realms render through `LocationWorldPage` → `ThreeLocationWorldView`, so the change
applies to them with no realm code change.

- **Treasure Rush (Treasure Cove):** the realm's Hint, Sound and Backpack stay in `hudSlot`
  (bottom right), and its puzzle and Pip panels stay fixed layers. The camera and sprint settings
  and "Things to do here" are now menus. Fixed for the owner's report.
- **Storykeeper Castle:** no jump or sprint, so the Settings menu shows only when camera switching
  is allowed. Castle Tale's guide and the writing room keep their panels. The parity tests open
  "Things to do" first.
- **Firepeak:** region-play, the same as Treasure Rush. Its Area puzzles are fixed layers.
- **North Pole:** region-play. No realm-specific HUD.
- **Sandbox:** "Things to do" is a menu too.

Not changed: legacy Phaser-era and 2D views (`IslandWorldView`, `FossilRidgeCampWorldView`,
`DragonsSanctuaryWorldView`) never go full screen and keep their lists on the page.

## 6. Tests

- `GameplayMenus.test.tsx`:
  - closed by default, one at a time, focus;
  - Escape and Close give focus back;
  - keyboard alone;
  - key presses kept from `window`, releases passed;
  - suspended;
  - focus kept on re-render;
  - a menu that goes away.
- `WorldStage.test.tsx`:
  - menus in the toolbar beside "Full screen";
  - menus without full-screen support;
  - Space on "Exit full screen" kept from the engine.
- `ThreeLocationWorldView.test.tsx`:
  - nothing below the stage (no `fieldset` or `details`), closed by default;
  - menus never rebuild the scene or move the camera;
  - an item that opens a dialogue closes the list;
  - the camera and sprint settings through the menu.
- Parity tests (Welcome Harbor, Wonderwild, Castle writing room, Dragons Sanctuary, sandbox) open
  "Things to do" first.
- jsdom does no layout, so the viewport geometry is checked in the browser QA (section 7).

## 7. Browser QA checklist (owner or LAI 05, not run by LAI 04)

Run on Treasure Rush first, then Storykeeper Castle, Firepeak and North Pole. Use desktop
1280x720 and 1920x1080, a phone at 375x667 in portrait and 667x375 in landscape, and a tablet at
1024x768.

1. Enter full screen. The canvas reaches all four screen edges, with no panel below it.
2. Settings, "Things to do" and the realm's Hint, Sound and Backpack are closed on entry.
3. Open Settings and switch the camera view. The view changes at once, and the scene does not
   reload: the character stays where it was.
4. Switch the sprint mode, close Settings, and hold or tap Shift. Running follows the new mode.
5. Open "Things to do", pick an item, and the list closes as its dialogue opens. Close the dialogue.
6. Walk, jump (Space, and the touch jump button on a phone) and turn the camera with a menu open
   and closed. Nothing sticks or repeats.
7. With a menu open, press Space or the arrows on its buttons. The character does not jump or walk.
8. "Exit full screen" and "Leave island" stay visible and work with a menu open, a dialogue open
   and a puzzle open. Esc leaves full screen.
9. Rotate the phone between portrait and landscape in full screen. The canvas refills, the toolbar
   stays on one row, and a menu panel scrolls inside itself.
10. Do the same with the keyboard only (Tab, Enter, Space, Esc), with focus visible all the way.
11. With "reduce motion" on in the OS, menus open with no animation.
12. Leave the page (not full screen). The stage keeps its 4:3 (3:4 on a phone) shape, and the
    menus work the same.
13. On iPhone Safari there is no "Full screen" button, and the menus still work.
14. Treasure Rush: solve a puzzle. The result shows in its panel and as a toast, and nothing stays
    on the canvas afterwards.
