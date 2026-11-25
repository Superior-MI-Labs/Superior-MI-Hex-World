# Superior MI Hex World

Independent, game-neutral sparse hex world engine. [Live laboratory](https://superior-mi-labs.github.io/Superior-MI-Hex-World/).

First foundation: signed axial Q/R plus vertical Z, configurable physical scale and chunk dimensions, sparse known chunks, seven-vertex triangulated volume geometry with fixed half-cell snapping, independent simulation and animation clocks, configurable effect lifetimes, provider boundary. The WebGL2 browser laboratory supports 19-cell terrain sculpting, face-selected upper/lower/side handles with connected or independent dragging, clipped cliff faces and sparse terrain import/export; depth-tested geometry and real Atlas tutorial sprites are implemented; state-driven materials, transparent grass, snow/leaves and simulation-driven reactive fire are available; terrain artwork remains procedural placeholders, not production Atlas rendering.

Run `node --test tests/*.test.mjs` (Node 20+). Serve the root with `python3 -m http.server 8000` and open localhost:8000. See [architecture](docs/ARCHITECTURE.md).

v0.7: neighbor-aware material/coverage transitions, optional Atlas transition mask, cliff-rim bleed, derived mesh cache and camera pan/zoom. Transition previews and coverage debug are in the material controls.


v0.8: Atlas terrain style fixture, repeating detail, directional terrain lighting, deterministic vegetation samples, viewport culling and vegetation detail scaling. See [art direction](docs/ART_DIRECTION.md).


v0.9: opt-in exploration meadow, deterministic chunk generation, viewport-driven active domain, bounded mesh cache, and offscreen reactive-fire progression. Export saves before switching world modes.
