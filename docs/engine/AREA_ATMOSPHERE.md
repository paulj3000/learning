# Area atmosphere and conditional scenery

Generic, data-driven additions to the Three.js Area runtime. Nothing here names a region or a
holiday. Every key is optional: when absent, an Area is drawn exactly as before. All of it is
decorative; it never changes colliders, interactions, progress or copy.

## Scene keys (`scene` in the Area's content revision)

```json
"environment": {
  "backgroundColor": 1979224,
  "lighting": {"ambientColor": 13623551, "ambientIntensity": 0.9, "sunColor": 16773856, "sunIntensity": 0.9}
},
"atmosphere": {
  "fog": {"color": 14543093, "near": 40, "far": 170},
  "precipitation": {"kind": "SNOW", "density": 0.6},
  "skyRibbons": [{"id": "sky-1", "colors": [6222512, 9075954], "x": 0, "y": 60, "z": -140, "width": 220, "height": 30}]
}
```

| Key | Rule | If invalid |
| --- | --- | --- |
| `environment.lighting.ambientColor`, `sunColor` | 24-bit integer; absent is white | field dropped |
| `environment.lighting.ambientIntensity`, `sunIntensity` | finite, clamped to 0..4; absent keeps the default (0.65 and 0.8) | field dropped |
| `atmosphere.fog` | linear; `0 < near < far <= 1000`, colour 24-bit | no fog |
| `atmosphere.precipitation` | `kind` SNOW (unknown kinds ignored), `density` clamped 0..1 | none |
| `atmosphere.skyRibbons[]` | at most 4, unique `id`, `colors` exactly two, `width` and `height` above 0 | entry dropped |

The background colour is not changed by fog. Distant ground fades to the fog colour, so authors
should choose a fog colour close to the horizon of the background, or a darker fog for a night sky.

## Render tiers and reduced motion

| | LOW | MEDIUM | HIGH | Reduced motion |
| --- | --- | --- | --- | --- |
| Fog | drawn | drawn | drawn | drawn |
| Snow particles | none | density x 600 | density x 1200 | half the count, slower fall, no sway |
| Sky ribbons | none | drawn, waving | drawn, waving | drawn, static |

Snow is one `THREE.Points` in a 40 x 24 x 40 m box that follows the camera and wraps; ribbons are
one shader plane each (24 x 1 segments). With any ribbon the camera far plane is raised to 400 m.
`RENDER_QUALITY_PRESETS[tier].maxPrecipitation` is the particle budget.

## Conditional lights and stand-ins

`effects.lights[]` (placed point lights) and `effects.standIns[]` accept optional
`shownWhenChangeKey` and `hiddenWhenChangeKey`, with the same meaning as steam: hidden once the
hide key exists, shown only once the show key exists. They update when the play API reports new
change keys (`setChangeKeys`). A hidden stand-in is invisible but its entity (collider, focus) is
unchanged.

## Stand-in shapes

`PINE`, `STAR`, `GIFT`, `SNOWMAN`, `CANE`, `LANTERN`, `HOUSE`, `DOME`, `SLEIGH`, `ANIMAL` and
`SIGN` are built from primitives in `areaStandIns.ts`, sized to the entity's placeholder box and
coloured from config. `STAR` and `LANTERN` glow.

## Code

`runtime/visual/atmosphere.ts` (parsing, fog, snow, ribbons), `runtime/createLocationEngine.ts`
(mounting), `extensions/regionPlay/areaEffectsScene.ts` (conditional lights and stand-ins),
`region-play/regionManifest.ts` (reads `scene.environment.lighting` and `scene.atmosphere`).
There is no Python validator for these keys; the scene JSON is passed through as authored.
