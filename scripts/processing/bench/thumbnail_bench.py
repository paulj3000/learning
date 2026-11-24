"""Offline GLB thumbnail renderer benchmark harness for LAI-LAMBDA-013 (feasibility only).

Nothing here is product code, nothing is deployed, and nothing calls AWS. The design is in
`docs/processing/feasibility/LAI-LAMBDA-013-image-and-thumbnails.md` section 6.

    python3 scripts/processing/bench/thumbnail_bench.py
        Plan only: the candidate renderers, what each needs, and the metrics. Runs nothing.

    python3 scripts/processing/bench/thumbnail_bench.py --run --chromium <chrome-headless-shell>
        Measures headless Chromium with SwiftShader (software WebGL, no GPU), the renderer a
        Lambda or a Fargate task would have to use. A synthetic, self-contained page draws a
        procedural mesh with raw WebGL at 512 x 512 for several triangle counts; per case it
        records wall-clock time of the whole browser run (launch, context, draw, read back),
        the in-page context and draw times, whether the canvas has non-background pixels, and
        the peak RSS of the largest child process.

The synthetic page is a proxy for "three.js plus GLTFLoader": it measures browser launch, software
rasterisation and read-back, which dominate, without needing `react/node_modules`. The three.js
adapter (`THREE_ADAPTER` below) is the next step once the owner approves the spike: it would load
a real GLB from the Asset Library fixtures with the same framing code as the Admin viewer
(`react/src/features/assets/preview/modelPreviewViewer.ts`).

Browser hardening used even for the benchmark: a fresh temporary profile, no extensions, every
host name resolved to nothing (`--host-resolver-rules`), the page loaded from a temporary
directory, and the Chromium sandbox left on. Temporary files are removed afterwards. Where the
host has no usable sandbox (Ubuntu 23.10+ restricts unprivileged user namespaces with AppArmor;
AWS Lambda has none either), `--allow-no-sandbox` must be passed explicitly. That is acceptable for
the synthetic page, which has no external input; it is a finding for production (report section 6).
"""

from __future__ import annotations

import argparse
import json
import platform
import re
import resource
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

SIDE = 512
TRIANGLE_CASES = (10_000, 100_000, 500_000)

CANDIDATES = {
    "chromium-swiftshader": {
        "status": "measurable here with --chromium",
        "needs": "chrome-headless-shell (Chrome for Testing) or a Lambda-packaged Chromium",
        "gpu": "none; SwiftShader (Vulkan/GL ES in software via ANGLE)",
        "same_renderer_as_admin": "yes, with the three.js adapter",
    },
    "three-headless-chromium": {
        "status": "adapter not implemented (needs three and the GLTFLoader served locally)",
        "needs": "the chromium-swiftshader case plus a page bundling three@0.185",
        "gpu": "none",
        "same_renderer_as_admin": "yes",
    },
    "egl-osmesa-headless-gl": {
        "status": "not measured",
        "needs": "Mesa llvmpipe/OSMesa libraries; for Node, headless-gl (WebGL 1 only)",
        "gpu": "none",
        "same_renderer_as_admin": "no (WebGL 1 or a different GL stack)",
    },
    "pyrender-osmesa": {
        "status": "not measured",
        "needs": "pyrender, trimesh, PyOpenGL, OSMesa; native libraries",
        "gpu": "none",
        "same_renderer_as_admin": "no (different PBR shading)",
    },
    "blender-cycles-eevee": {
        "status": "not measured",
        "needs": "Blender (several hundred MB), run as `blender -b -P script.py`",
        "gpu": "none; Cycles CPU or EEVEE needs a GL context",
        "same_renderer_as_admin": "no",
    },
    "filament-gltf-viewer": {
        "status": "not measured",
        "needs": "Filament `gltf_viewer --headless` built for arm64",
        "gpu": "none; needs a software Vulkan/GL",
        "same_renderer_as_admin": "no",
    },
}
METRICS = (
    "wall_ms (launch to exit, cold and warm)",
    "context_ms (WebGL context creation in the page)",
    "draw_ms (draw plus gl.finish plus readPixels)",
    "non_background_pixels (the image is not blank)",
    "peak_child_rss_mib (largest child process)",
    "install_bytes (renderer on disk; Lambda limit 250 MiB unzipped)",
)

PAGE = """<!doctype html><meta charset="utf-8"><title>bench</title>
<body style="margin:0;background:#fff"><canvas id="c" width="{side}" height="{side}"></canvas>
<pre id="out">pending</pre><script>
const t0 = performance.now();
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', {{preserveDrawingBuffer: true, antialias: true}});
const out = document.getElementById('out');
if (!gl) {{ out.textContent = JSON.stringify({{error: 'no_webgl2'}}); }} else {{
const t1 = performance.now();
const vs = `#version 300 es
in vec3 p; in vec3 n; out vec3 vn; uniform float a;
void main() {{ float c = cos(a), s = sin(a);
  vec3 q = vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); vn = vec3(c*n.x + s*n.z, n.y, -s*n.x + c*n.z);
  gl_Position = vec4(q.xy * 0.8, q.z * 0.5, 1.0); }}`;
const fs = `#version 300 es
precision highp float; in vec3 vn; out vec4 o;
void main() {{ float l = max(dot(normalize(vn), normalize(vec3(0.4,0.7,0.6))), 0.0);
  o = vec4(vec3(0.2,0.5,0.8) * (0.25 + 0.75*l), 1.0); }}`;
function sh(t, src) {{
  const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); return s; }}
const prog = gl.createProgram();
gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
gl.linkProgram(prog); gl.useProgram(prog);
// A UV sphere with about {triangles} triangles.
const rings = Math.max(4, Math.round(Math.sqrt({triangles} / 2)));
const segs = rings; const pos = [], nor = [];
function v(i, j) {{ const th = Math.PI * i / rings, ph = 2 * Math.PI * j / segs;
  return [Math.sin(th)*Math.cos(ph), Math.cos(th), Math.sin(th)*Math.sin(ph)]; }}
for (let i = 0; i < rings; i++) for (let j = 0; j < segs; j++) {{
  const a = v(i,j), b = v(i+1,j), c = v(i+1,j+1), d = v(i,j+1);
  for (const q of [a,b,c,a,c,d]) {{ pos.push(...q); nor.push(...q); }} }}
function buf(name, data) {{ const b = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, name); gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 3, gl.FLOAT, false, 0, 0); }}
buf('p', pos); buf('n', nor);
gl.uniform1f(gl.getUniformLocation(prog, 'a'), 0.6);
gl.enable(gl.DEPTH_TEST); gl.clearColor(1, 1, 1, 1);
const t2 = performance.now();
gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
gl.drawArrays(gl.TRIANGLES, 0, pos.length / 3);
const px = new Uint8Array({side} * {side} * 4);
gl.readPixels(0, 0, {side}, {side}, gl.RGBA, gl.UNSIGNED_BYTE, px);
const t3 = performance.now();
let lit = 0;
for (let k = 0; k < px.length; k += 4) if (px[k] < 255 || px[k+1] < 255 || px[k+2] < 255) lit++;
const dbg = gl.getExtension('WEBGL_debug_renderer_info');
out.textContent = JSON.stringify({{
  context_ms: +(t1 - t0).toFixed(1), setup_ms: +(t2 - t1).toFixed(1),
  draw_ms: +(t3 - t2).toFixed(1),
  triangles: pos.length / 9, non_background_pixels: lit,
  renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown' }});
}}
</script>"""


def chromium_args(binary: Path, profile: Path, page: Path, *, no_sandbox: bool) -> list[str]:
    return [
        str(binary),
        "--headless",
        *(["--no-sandbox"] if no_sandbox else []),
        "--use-angle=swiftshader",
        "--enable-unsafe-swiftshader",
        "--ignore-gpu-blocklist",
        "--disable-extensions",
        "--no-first-run",
        "--disable-background-networking",
        "--host-resolver-rules=MAP * ~NOTFOUND",
        f"--user-data-dir={profile}",
        f"--window-size={SIDE},{SIDE}",
        "--virtual-time-budget=60000",
        "--dump-dom",
        page.as_uri(),
    ]


def run_chromium_case(binary: Path, triangles: int, *, no_sandbox: bool) -> dict:
    work = Path(tempfile.mkdtemp(prefix="lai-thumb-bench-"))
    try:
        page = work / "page.html"
        page.write_text(PAGE.format(side=SIDE, triangles=triangles), encoding="utf-8")
        before = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
        start = time.perf_counter()
        completed = subprocess.run(  # noqa: S603 - fixed argv, no shell, local file only
            chromium_args(binary, work / "profile", page, no_sandbox=no_sandbox),
            capture_output=True,
            text=True,
            timeout=300,
            check=False,
        )
        wall = (time.perf_counter() - start) * 1000
        after = resource.getrusage(resource.RUSAGE_CHILDREN).ru_maxrss
        match = re.search(r'<pre id="out">(.*?)</pre>', completed.stdout, re.S)
        measured = json.loads(match.group(1)) if match and match.group(1) != "pending" else {}
        return {
            "triangles_requested": triangles,
            "exit_code": completed.returncode,
            "wall_ms": round(wall, 1),
            # ru_maxrss of children is the largest single descendant; it only grows, so a later
            # case reports max(previous, this one).
            "peak_child_rss_mib": round(max(before, after) / 1024, 1),
            **measured,
            **({} if completed.returncode == 0 else {"stderr_tail": completed.stderr[-400:]}),
        }
    finally:
        shutil.rmtree(work, ignore_errors=True)


def install_bytes(binary: Path) -> int:
    return sum(p.stat().st_size for p in binary.parent.rglob("*") if p.is_file())


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--chromium", type=Path, help="chrome-headless-shell binary")
    parser.add_argument("--run", action="store_true", help="run the measurement (default: plan)")
    parser.add_argument("--repeat", type=int, default=2, help="runs per case (first is cold)")
    parser.add_argument(
        "--allow-no-sandbox",
        action="store_true",
        help="pass --no-sandbox (only where the host has no usable sandbox; synthetic page only)",
    )
    args = parser.parse_args(argv)
    if not (args.run and args.chromium):
        print(
            json.dumps(
                {
                    "plan": {"side": SIDE, "triangle_cases": TRIANGLE_CASES, "metrics": METRICS},
                    "candidates": CANDIDATES,
                },
                indent=2,
            )
        )
        return 0
    binary = args.chromium.expanduser().resolve()
    if not binary.is_file():
        parser.error(f"{binary} is not a file")
    results = []
    for triangles in TRIANGLE_CASES:
        for attempt in range(args.repeat):
            result = run_chromium_case(binary, triangles, no_sandbox=args.allow_no_sandbox)
            result["run"] = "cold" if attempt == 0 else "warm"
            results.append(result)
    print(
        json.dumps(
            {
                "host": {"machine": platform.machine(), "python": platform.python_version()},
                "renderer": "chromium-swiftshader (synthetic WebGL2 page)",
                "install_bytes": install_bytes(binary),
                "sandbox": not args.allow_no_sandbox,
                "results": results,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
