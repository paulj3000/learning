# Firepeak Volcano: asset manifest (FP-3)

Status 2026-11-01. Every Firepeak model is **missing**: no GLB has been delivered. The game is
playable without them. Each placement names a stable asset id, and until a version is published
the client draws a labelled stand-in (`stand-in:<entity>`), never the developer magenta box.

**How a model goes live.** No code change is needed:
1. An asset editor uploads a GLB for the id in Django Admin (Asset Manager, ADR-035).
2. A publisher publishes it and makes it the default.
3. The bootstrap's `catalog.assets[].deliverable` becomes true for that id.
4. The child's next visit loads the model in place of the stand-in.

Ids follow the flat-slug rule (FP-D4); the request's `firepeak/...` ids are not valid asset ids.

| Asset id | Kind | Used for (entity) | Stand-in shape | Clips wanted | Status |
|---|---|---|---|---|---|
| `firepeak-volcano-main` | kit-piece | Backdrop volcano (`scene.effects.backdrop`) | Cone with a glowing crater | none | Missing |
| `firepeak-base-camp` | prop | Research tent (`firepeak-tent`) | TENT | none | Missing |
| `firepeak-professor-ember` | character | Professor Ember (`firepeak-ember`) | Figure | `Idle`, `Talk`, `Wave`, `Celebrate` | Missing |
| `firepeak-telescope` | prop | Telescope (`firepeak-telescope`) | TELESCOPE | none | Missing |
| `firepeak-lava-crossing` | kit-piece | Not placed yet; the lava is a shader plane (`scene.effects.lava`) | none | none | Missing (optional) |
| `firepeak-stone-platform` | prop | Three movable stones (`firepeak-stone-*`) | STONE (length shows size) | none | Missing |
| `firepeak-steam-valve` | prop | Three valves (`firepeak-valve-*`) | VALVE (the wheel turns) | `Activate` | Missing |
| `firepeak-steam-pipe` | prop | Steam pipes (`firepeak-pipes`) | PIPE | none | Missing |
| `firepeak-crystal-cavern` | kit-piece | Crystal clusters (`firepeak-crystal-cluster-*`) | CRYSTAL | none | Missing |
| `firepeak-heart-crystal-fragment` | collectible | The Heart Crystal fragment (`firepeak-crystal`) | CRYSTAL (glowing) | none | Missing |
| `firepeak-crystal-pedestal` | prop | Ancient pedestal (`firepeak-pedestal`) | PEDESTAL | none | Missing |

**Bundled models reused (already delivered):**
- `signpost`: the information sign.
- `rock`: four rocks.
- `fern`: two plants.
- `ground-tile-stone`: the ground.

**Not a model.** These are code and data, not files:
- The lava: an animated shader plane.
- The steam: at most 48 particles per plume, or a still column with reduced motion.
- The gap outlines: flat glowing markers.
- The rope lift: a stand-in portal.

**Art direction for the delivered models:**
- Low-poly, consistent with the Kenney-style kit already in use.
- Under 2 MB each, and under 20,000 triangles for the backdrop.
- One material per model where possible.
- Stones about 1 m wide and 0.4 m high; the client scales their length by size.
- Valves 1 m tall, with the wheel as a separate node named `valve-wheel` so it can turn.
