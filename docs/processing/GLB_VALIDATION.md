# GLB validation (`asset.validate_model`, LAI-LAMBDA-002)

Trello: https://trello.com/c/PDHxtgBP. Code: `processing/lai_processing/processors/gltf/`.
Tests: `tests/processing/test_processing_glb_*.py`, the synthetic fixture builder
`tests/processing/glb_builder.py`, and the Django parity test
`lai/apps/assets/tests/test_glb_processing_parity.py`.

| Item | Value |
|---|---|
| Job type | `asset.validate_model` |
| Processor | `asset.glb_validator` 1.0.0 |
| Profile | `glb-default` v1 |
| Dependencies | Python standard library only (enforced by `test_processing_runtime_independence.py`) |
| Network | None. No URI is ever fetched, opened or resolved |
| Artifact (optional) | `glb-report` JSON, artifact type `report.glb_validation` (library only; not written on the canonical path) |
| Where it runs | The jobs worker zip on the media queue (`lambda/build.py` vendors `lai_processing`), as `apps.jobs` kind `asset.validate_model` in the schema-1 envelope; Django's inline backend runs the same code locally (`ASYNC_MODEL_VALIDATION.md`) |

The validator answers "is this GLB well formed, self-contained, within limits and loadable by
the game, and what does it contain?". It is a bounded structural validator, **not** a full
Khronos glTF conformance validator (see "What is not validated").

## 1. Outcome

A bad file is a *finding*, never a job error. The job succeeds with verdict `fail` when any
finding has severity `error`, and `pass` otherwise; findings use the Asset Library shape
`{code, severity, message, path}`, so a result maps onto `AssetVersion.validation_report`. The
job itself fails only on cancellation (`cancelled`), the deadline (`processing_timeout`,
retryable), a refused option (`invalid_processing_profile`), or an internal fault
(`unexpected_failure`). Processing success is not approval: Django applies the verdict to a
`DRAFT` version only (`VALIDATED` or `REJECTED`), records it for staff review, and publishing
stays an explicit staff action (ADR-061, ADR-064).

Messages are authored by code and never contain file content: names, URIs and extension
strings stay out of messages; the `path` is an index path such as `accessors[3]` or
`meshes[0].primitives[1]`. At most 200 findings are listed; the rest are summarised by one
`too_many_findings` finding, which is an `error` whenever a dropped finding was an error, so
truncation can never turn a fail into a pass.

## 2. Profile `glb-default` v1

Options (unknown options are refused):

| Option | Type | Default | Meaning |
|---|---|---|---|
| `max_texture_dimension` | int, 1 to 16384 | 8192 | Largest embedded texture width or height (from the image header) |
| `require_animations` | bool | false | Fail a model with no animation clip (`animations_required`) |
| `write_report` | bool | false | Also write the `glb-report` artifact (findings, warnings, metadata, verdict). Django never sets it; on the canonical path a write is refused (`permission_denied`) |

Limits: the profile carries `DEFAULT_LIMITS` plus these complexity defaults. A request's
`limits.complexity` overrides a default, and the processor clamps every value to its own ceiling
(10 times the default; `max_json_bytes` 64 MiB, `max_json_depth` 128, `max_node_depth` 256),
because the platform ceilings do not name processor counters. Exceeding a complexity limit is a
`too_complex` finding (verdict `fail`), matching Django.

| Limit | Default | Django `LIMITS` |
|---|---|---|
| `max_json_bytes` | 16 MiB | `json_bytes` (same) |
| `max_json_depth` | 64 | (none; Python's recursion limit) |
| `max_node_depth` | 64 | `depth` (same) |
| `max_nodes` (also cameras) | 10,000 | `nodes` (same) |
| `max_meshes` | 2,000 | `meshes` (same) |
| `max_accessors` | 20,000 | `accessors` (same) |
| `max_accessor_count` (elements per accessor) | 10,000,000 | `accessor_count` (same) |
| `max_animations` | 200 | `animations` (same) |
| `max_materials` | 500 | `materials` (same) |
| `max_images` | 200 | `images` (same) |
| `max_primitives`, `max_buffer_views`, `max_channels`, `max_animation_samplers` | 20,000 | (none) |
| `max_textures`, `max_samplers` | 500 | (none) |
| `max_skins` | 200 | (none) |
| `max_joints` (all skins) | 10,000 | (none) |
| `max_buffers` | 64 | (none) |
| `max_scenes` | 64 | (none) |
| `max_extensions` (each list) | 64 | (none) |
| `max_vertices`, `max_triangles` (whole model) | 10,000,000 | (none) |

The input size is bounded by `max_input_bytes` (50 MiB, `DEFAULT_LIMITS`, equal to the default
`LAI_ASSET_MAX_UPLOAD_BYTES` of 52,428,800 bytes). A request for a larger input is refused with
`resource_limit_exceeded` when it is built, so on the canonical path Django refuses it before any
job exists; the engine checks the size again before the processor runs. Django's request also
lowers `max_execution_seconds` to 90 (inside the 120 s media function timeout).

## 3. Checks, in order

Every loop over a document array, and the JSON depth walk, calls `context.check()`, so
cancellation and the deadline stop work mid-file. Every array is counted against its limit
before it is walked. Nothing is allocated from a size a file declares: Python integers do not
overflow, and every count that feeds a product (`stride * (count - 1)`) is capped by a limit
first. Vertex data is never decoded.

1. **Container** (`container.py`): empty file; GLB magic (a file starting with `{` is a .gltf,
   which this processor does not validate); header shorter than 12 bytes; version 2; declared
   length equal to the file size; a JSON chunk first; JSON chunk length within the file and
   `max_json_bytes`; an optional BIN chunk second whose length stays within the file; no bytes
   after the last chunk; 4-byte padding of each chunk (a warning, as in Django).
2. **JSON** (`jsonparse.py`): strict UTF-8 (no BOM), unique object keys, no `NaN`/`Infinity`
   or numbers that overflow to infinity, no integer too large for a float (no glTF value can be
   one), an object at the top, nesting at most `max_json_depth` (nesting beyond Python's recursion limit is caught and
   refused, never a crash).
3. **Asset**: `asset.version == "2.0"`; `asset.minVersion`, when present, `"2.0"`.
4. **Top-level arrays**: each present one is an array, within its count limit.
5. **Extensions**: Draco, meshopt and BasisU (`NEEDS_DECODER`) are refused; a required extension
   outside `SUPPORTED_EXTENSIONS` is refused; an unknown used extension is a warning; entries
   must be non-empty strings.
6. **Buffers**: `byteLength` a positive integer; a buffer without `uri` must be buffer 0 of a
   GLB with a BIN chunk at least as long (a BIN chunk more than 3 bytes longer warns); a `uri`
   must be a `data:` URI of type `application/octet-stream` or `application/gltf-buffer`,
   valid base64, at least `byteLength` long. Its length is computed from the base64 text; the
   buffer is never decoded. Every other `uri` (`http(s)`, `file:`, `s3:`, relative or traversal
   paths, non-strings) is `external_resource` and is never fetched.
7. **Buffer views**: buffer index in range; `byteOffset` and `byteLength` whole, length > 0;
   `byteOffset + byteLength` within the buffer; `byteStride` 4 to 252 and a multiple of 4;
   `target` 34962 or 34963.
8. **Accessors**: `count >= 1`, valid `componentType` and `type`; `count <=
   max_accessor_count`; `normalized` a boolean and not on float or unsigned-int data; `min`/`max`
   of the type's length and finite; `byteOffset` whole and aligned to the component size (also
   with the view's offset); stride not smaller than the element; `byteOffset + stride * (count -
   1) + elementSize <= view.byteLength` (element size with glTF's column padding for small
   matrices); sparse: `1 <= count <= accessor.count`, index type unsigned, both views in range,
   both data ranges within their views.
9. **Samplers**: filters and wrap modes from the glTF enums.
10. **Images**: a `uri` image must be a `data:` URI (else `external_resource`) and not also
    have a `bufferView`; a `bufferView` image needs `mimeType`. PNG and JPEG are accepted (the
    game's loader); WebP and everything else is `image_type`. The leading bytes must match the
    type; dimensions come from the PNG IHDR, the first JPEG start-of-frame (at most 256 segments,
    inside the image's own byte range) or the WebP VP8/VP8L/VP8X header. A width or height over
    `max_texture_dimension` is `texture_too_large`; an unreadable header warns. Data-URI images
    decode only a bounded base64 prefix (64 KiB). An image in a buffer view of a data-URI buffer
    is sniffed and measured from a decoded prefix of at most 64 KiB of that view.
11. **Textures**: `source` and `sampler` in range. **Materials**: texture references
    (`baseColorTexture`, `metallicRoughnessTexture`, `normalTexture`, `occlusionTexture`,
    `emissiveTexture`) in range with a whole `texCoord`.
12. **Meshes**: at least one primitive; total primitives within the limit; attributes reference
    accessors; `POSITION` required and VEC3 float (or quantized types with
    `KHR_mesh_quantization`); equal attribute counts; indices an unsigned integer scalar
    accessor; `mode` 0 to 6; `material` in range; morph targets reference accessors. Vertex
    count is the sum of `POSITION` counts; triangle count is index (or vertex) count `// 3` for
    mode 4 and `n - 2` for strips and fans (5, 6), 0 for points and lines. Both are limited.
13. **Nodes**: `mesh`, `skin`, `camera`, `children` in range; finite `matrix` (16),
    `translation` (3), `rotation` (4), `scale` (3); one parent per node, no self-parenting, no
    cycles (a node no root reaches is in a cycle); hierarchy depth within `max_node_depth`.
14. **Scenes and bounds**: a default scene (`scene`, default 0) must exist (`no_scene`); scene
    nodes in range, unique (tracked in a set) and parentless; the default scene must contain
    geometry with `POSITION` min/max (`no_geometry`). Bounds equal the 8 corners of each
    reachable primitive's `POSITION` min/max box through the node transforms, as Django computes
    them (missing min/max on some primitives warns `missing_bounds`), but without a node x
    primitive loop: each axis extreme is computed exactly from the matrix terms; a single
    primitive, or a node whose world matrix maps axes to axes, uses the union box of its mesh;
    only a rotated instance of a multi-primitive mesh is measured per primitive, and those
    node-primitive pairs are capped at `MAX_BOUNDS_PAIRS` (200,000), beyond which the scene is
    `too_complex`. A non-finite world coordinate (overflowing transforms) is `invalid_node`.
15. **Skins**: non-empty unique joints in range; total joints within the limit; `skeleton` in
    range; `inverseBindMatrices` a float MAT4 accessor with at least one matrix per joint.
16. **Animations**: samplers and channels non-empty; sampler `input` a float scalar accessor
    with `min`/`max`, non-negative and ordered; `output` in range; interpolation `LINEAR`,
    `STEP` or `CUBICSPLINE`; channel sampler in range; target `path` translation, rotation,
    scale or weights; target `node` in range; output type and count match the keyframes (3 values
    per key for cubic spline; a multiple for weights). Duration is the largest keyframe `max`.
    Clip names follow Django's rules: blank is `unnamed_clip` (warning), over 64 characters
    `clip_name`, repeated `duplicate_clip`, outside the clip vocabulary `unknown_clip`
    (warning), an exporter default take such as Mixamo's `Armature|mixamo.com|Layer0`
    `generic_clip_name` (warning). Nothing ever guesses what a clip shows.

## 4. Findings

Codes shared with `lai/apps/assets/validation.py` keep Django's meaning; Django's messages quote
file content (clip and extension names), so the processor's messages differ in wording only.

| Code | Severity | Shared with Django | Meaning |
|---|---|---|---|
| `empty_file` | error | yes | The file is empty |
| `not_a_model` | error | yes | Not GLB bytes |
| `gltf_not_supported` | error | new | A .gltf JSON file; this processor validates GLB only |
| `not_glb` | error | yes | Shorter than a GLB header |
| `glb_version` | error | yes | GLB version other than 2 |
| `glb_length` | error | yes | Header length differs from the file size (truncated, padded) |
| `glb_chunks` | error | yes | Missing, misordered or overlong chunks |
| `glb_trailing_data` | error | new | Bytes after the last chunk |
| `glb_padding` | warning | yes | A chunk is not padded to 4 bytes |
| `json_size` | error | yes | JSON chunk too large or past the end of the file |
| `invalid_json` | error | yes | Not strict UTF-8 JSON, duplicate keys, NaN, too deep, not an object |
| `gltf_version` | error | yes | `asset.version` is not "2.0" or `minVersion` is newer |
| `invalid_structure` | error | new | A top-level property that must be an array is not |
| `too_complex` | error | yes | A complexity limit is exceeded, or too many mesh instances to measure bounds |
| `needs_decoder` | error | yes | Draco, meshopt or BasisU |
| `unsupported_extension` | error | yes | A required extension the game does not support |
| `unknown_extension` | warning | yes | A used extension the game ignores |
| `invalid_buffer` | error | yes | Malformed buffer, bad media type or base64 |
| `missing_buffer` | error | yes | A buffer with no data |
| `buffer_bounds` | error | yes | A buffer, view, accessor or sparse range runs past its container |
| `bin_chunk_unused` | warning | new | BIN chunk much longer than buffer 0 |
| `external_resource` | error | yes | A buffer or image refers to anything other than embedded data |
| `invalid_buffer_view` | error | yes | Missing buffer, bad range, stride or target |
| `invalid_accessor` | error | yes | Bad count, type, component, offset, alignment, min/max, sparse |
| `invalid_sampler` | error | new | Unknown filter or wrap mode |
| `invalid_image` | error | yes | Malformed image or missing buffer view |
| `image_type` | error | yes | Not PNG/JPEG, or bytes that do not match the claimed type |
| `image_dimensions_unknown` | warning | new | A texture header could not be read |
| `texture_too_large` | error | new | Texture side over `max_texture_dimension` |
| `invalid_texture` | error | new | Missing image or sampler |
| `invalid_material` | error | new | Malformed material or missing texture |
| `invalid_mesh` | error | new | Primitive, attribute, POSITION, index, mode, material or target problems |
| `invalid_node` | error | yes | Missing node, mesh, skin, camera or child; bad transform; non-finite bounds |
| `node_cycle` | error | yes | Cycle, two parents, repeated scene node, parented scene root |
| `invalid_scene` | error | new | A malformed scene |
| `no_scene` | error | yes | No default scene |
| `no_geometry` | error | yes | The default scene has no geometry with known bounds |
| `missing_bounds` | warning | yes | Some primitives lack POSITION min/max |
| `invalid_skin` | error | new | Joints, skeleton or inverse bind matrices |
| `invalid_animation` | error | new | Samplers, keyframes, channels or targets |
| `unnamed_clip` | warning | yes | An animation has no name |
| `clip_name` | error | yes | Name longer than 64 characters |
| `duplicate_clip` | error | yes | Two animations share a name |
| `unknown_clip` | warning | yes | Name outside the clip vocabulary |
| `generic_clip_name` | warning | yes | An exporter default take name |
| `animations_required` | error | new | `require_animations` and no animation |
| `too_many_findings` | error or warning | new | More findings than one report lists |

Run warnings (`ProcessingWarning`, about the report rather than the file):
`metadata_text_truncated`, `metadata_list_truncated`, `metadata_truncated`.

Django-only codes not produced here: `wrong_file_family`, `too_large` (the engine's
`max_input_bytes` refuses the job instead), `asset_id`, `asset_retired`, `missing_clip` and
`no_clips` (they need the asset definition, which stays a Django concern).

## 5. Metadata

Deterministic (same bytes and options, same object; sorted keys in the canonical encoding), no
timestamps, paths, ids or staff-supplied file names. The full schema is in
`docs/processing/CONTRACTS.md`, "GLB validation metadata". Example (the skinned test model with
a Mixamo take):

```json
{
  "animations": [
    {"channel_count": 1, "duration_seconds": 1.25, "name": "Armature|mixamo.com|Layer0",
     "sampler_count": 1},
    {"channel_count": 1, "duration_seconds": 2.5, "name": "Idle", "sampler_count": 1}
  ],
  "bin_chunk_bytes": 332,
  "bounds": {"max": [0.5, 0.0, 0.5], "min": [-0.5, 0.0, -0.5]},
  "clip_vocabulary_matches": ["Idle"],
  "counts": {"accessors": 9, "animations": 2, "buffer_views": 9, "buffers": 1, "channels": 2,
             "images": 0, "joints": 2, "materials": 0, "meshes": 1, "nodes": 3,
             "primitives": 1, "samplers": 0, "scenes": 1, "skins": 1, "textures": 0},
  "document_read": true,
  "extensions_required": [],
  "extensions_used": [],
  "file_size_bytes": 2412,
  "format": "glb",
  "generator": "lai-glb-builder",
  "gltf_version": "2.0",
  "images": [],
  "json_chunk_bytes": 2052,
  "lists_truncated": false,
  "material_names": [],
  "metadata_version": 1,
  "min_version": null,
  "skins": [{"joint_count": 2, "name": "Armature"}],
  "triangle_count": 2,
  "unsupported_extensions": [],
  "vertex_count": 4
}
```

Strings copied from the file (`generator`, material, skin and clip names, extension names) are
stripped of control, format (for example bidirectional overrides), surrogate and private-use
characters and cut to 200 characters, with the `metadata_text_truncated` warning; a non-string
becomes `null`. Apart from that, clip names are exact. `clip_vocabulary_matches` is exact,
case-sensitive membership in the clip vocabulary; clips are never classified.

## 6. What is not validated

Honest limits of this validator (it does not claim Khronos conformance):

- Vertex, index and keyframe *values* are not read: index values are not checked against the
  vertex count, keyframe times are not checked to be increasing (only `min`/`max`), `min`/`max`
  are trusted rather than recomputed, normals and tangents are not checked for unit length,
  weights are not checked to sum to 1, quaternions are not checked for unit length.
- Images are not decoded: only the header signature and dimensions are read. PNG CRCs and JPEG
  structure beyond the frame header are not checked (Django's standalone image validation does
  that for image assets, not for embedded textures).
- Extension *contents* (`extensions` objects) and `extras` are not interpreted; they are data
  and never reach players.
- Cameras, lights, morph target accessor types, `KHR_materials_variants` mappings and
  `KHR_texture_transform` values are only reference-checked or not at all.
- `.gltf` JSON files with embedded buffers are not validated here (Django still validates them
  synchronously).
- Animation channel target uniqueness, joint hierarchy shape and skeleton root consistency are
  not checked.

## 7. Parity with Django (`lai/apps/assets/validation.py`)

Django's validator is unchanged apart from one fix (`_finite` treats an integer too large for a
float as not finite instead of raising `OverflowError`). The native release and the Django image
now ship `processing/lai_processing` beside `lai/`, so switching Django's synchronous checks to
the shared parser is possible; it remains a separate follow-up. The policy constants
(`CLIP_VOCABULARY`, `GENERIC_TAKE_NAME`, `SUPPORTED_EXTENSIONS`, `NEEDS_DECODER`, the count
limits) are copied and a test (`test_processing_glb_parity.py`, no Django needed) reads them from
`validation.py` with `ast` and requires equality, so they cannot drift silently.

The shared corpus `glb_builder.PARITY_CORPUS` runs through both validators
(`lai/apps/assets/tests/test_glb_processing_parity.py`). Every case gives the same verdict and
the same set of error codes, except these intentional differences, where the processor is
stricter (by design it does not pass a file Django refuses; the corpus test enforces that for
every case):

| Case | Django | Processor | Why |
|---|---|---|---|
| Bytes after the BIN chunk | pass | `glb_trailing_data` | A structure must end where the file ends |
| Duplicate JSON keys | last value wins | `invalid_json` | Ambiguous documents are refused |
| `NaN` / `Infinity` in JSON | accepted | `invalid_json` | Not JSON; non-finite numbers |
| JSON nested deeper than 64 | accepted up to Python's limit | `invalid_json` | Bounded work |
| `byteStride` outside 4..252 or not a multiple of 4 | not checked | `invalid_buffer_view` | glTF rule |
| Texture over `max_texture_dimension` | not checked | `texture_too_large` | Bounded GPU memory |
| Animation samplers and channels | names only | `invalid_animation` | Broken clips would fail at load |
| Skins | not checked | `invalid_skin` | Broken skins would fail at load |
| Primitive without `POSITION` | `no_geometry` only | also `invalid_mesh` | Every primitive needs positions |
| `.gltf` JSON input | validated | `gltf_not_supported` | GLB only |

Processor-only checks added at the 2026-11-17 review (not in Django, so Django may answer
differently): an integer too large for a float is `invalid_json` (Django passes the file or
reports `no_geometry`); more than `MAX_BOUNDS_PAIRS` node-primitive pairs to measure is
`too_complex`; non-finite (NaN or infinite) world bounds are `invalid_node`; textures inside a
data-URI buffer are sniffed and measured.

Further stricter checks without a corpus case (each covered by the unit tests): accessor offset
alignment, `normalized` rules, `min`/`max` shapes, sparse accessors, stride versus element size,
matrix column padding in bounds checks, buffer-view `target`, sampler enums, texture and
material references, mesh attribute counts and index types, primitive modes, node transform
shapes, nodes with two parents or unreachable cycles outside the default scene, a parented
scene root, `asset.minVersion`, non-string extension entries, and a top-level property that is
not an array (Django treats it as empty).
