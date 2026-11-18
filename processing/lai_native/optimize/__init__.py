"""GLB optimization with native tools (LAI-LAMBDA-010, ADR-070): Meshopt first, then KTX2.

- `profiles`: pinned, versioned tool configurations and command construction.
- `signature`: what an optimization must not change, read with the stdlib `lai_processing`
  inspectors, and the comparison that fails a job when anything game-relevant changed.
- `meshopt`: `optimize_meshopt(source, tools=..., workspace=...)` (gltfpack).
- `textures`: calculated GPU memory estimates.
- `ktx2`: `optimize_ktx2(source, tools=..., workspace=..., prepare=...)` (toktx).
- `glbwrite`, `texture_prep`: GLB rewriting and the Workstream D texture preparation seam.

Every tool runs through `lai_native.runtime.run_tool` (Workstream C's adapter: fixed executable
path, scrubbed environment, rlimits, bounded output, deadline and cancellation).

See `docs/processing/GLB_OPTIMIZATION.md`.
"""

from .meshopt import OptimizeError, OptimizeResult, ToolPaths, optimize_meshopt
from .profiles import MESHOPT_CONSERVATIVE, OptimizeProfile, gltfpack_argv

__all__ = [
    "MESHOPT_CONSERVATIVE",
    "OptimizeError",
    "OptimizeProfile",
    "OptimizeResult",
    "ToolPaths",
    "gltfpack_argv",
    "optimize_meshopt",
]
