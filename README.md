# Superior MI Hex World

Independent, game-neutral sparse hex world engine. [Live laboratory](https://superior-mi-labs.github.io/Superior-MI-Hex-World/).

First foundation: signed axial Q/R plus vertical Z, configurable physical scale and chunk dimensions, sparse known chunks, seven-vertex triangulated volume geometry with fixed half-cell snapping, independent simulation and animation clocks, configurable effect lifetimes, provider boundary. The WebGL2 browser laboratory supports 19-cell terrain sculpting, face-selected upper/lower/side handles with connected or independent dragging, clipped cliff faces and sparse terrain import/export; depth-tested geometry and real Atlas tutorial sprites are implemented; state-driven materials, transparent grass, snow/leaves and simulation-driven reactive fire are available; terrain artwork remains procedural placeholders, not production Atlas rendering.

Run `node --test tests/*.test.mjs` (Node 20+). Serve the root with `python3 -m http.server 8000` and open localhost:8000. See [architecture](docs/ARCHITECTURE.md).

v0.7: neighbor-aware material/coverage transitions, optional Atlas transition mask, cliff-rim bleed, derived mesh cache and camera pan/zoom. Transition previews and coverage debug are in the material controls.


v0.8: Atlas terrain style fixture, repeating detail, directional terrain lighting, deterministic vegetation samples, viewport culling and vegetation detail scaling. See [art direction](docs/ART_DIRECTION.md).


v0.9: opt-in exploration meadow, deterministic chunk generation, viewport-driven active domain, bounded mesh cache, and offscreen reactive-fire progression. Export saves before switching world modes.


v0.10: atomic rotated prefab placement, persistent Atlas-bound world objects and surface anchors. Existing terrain saves remain compatible.


v0.11: explicit prefab capture/export/import, persistent standalone fire and simulation clock saves, optional GPU soft sprite alpha.


v0.12: profile-driven centerline walking, bounded route search, ceiling clearance, persistent relocation and depth-tested terrain contact shadows.


v0.13: settlement test scene, non-destructive interior cutaway, geometry-based line-of-sight, route animation and optional Atlas walking state.


v0.14: externally hosted multi-pack art profiles and optional RGB detail modulation; [parallel art production handoff](docs/ART_PRODUCTION.md).


v0.15: committed spatial enter/leave/use signals, persistent interaction tags, and visual foliage contact bending. See [interaction handoff](docs/INTERACTIONS.md).


v0.16: persistent spatial wind, local shelter zones, authored Atlas animation states and combined wind/contact deformation. [Environment art handoff](docs/ENVIRONMENT_ART.md).


v0.17: per-material Atlas texture blending, full-color albedo, persistent climate fields and seasonal foliage bindings.


v0.18: persistent object orientation and six-view Atlas bindings; seasonal default-manifest inheritance correction.


v0.19: direct Atlas ZIP runtime loading, optional archive hash verification, fixed-canvas compositions with persistent visual input/slot/preset selections and a technical chest fixture.


v0.20: published Atlas discovery, generated composition controls and reach-checked authored visual use.


v0.21: canonical self-describing Atlas spatial profiles automatically resolve visual height, compatible directional views and wind response.


v0.22: deterministic multi-family decorative scatter, canonical spatial asset adoption, seasonal variants and hash-pinned style archives.


v0.23: stable same-level scatter spacing and explicit persistent object promotion with saved suppression.


v0.24: explicit persistent cylindrical object colliders, swept walking queries and collider editor diagnostics.


v0.25: indexed object collision queries and explicit host conditions bound to canonical Atlas inputs.


v0.26: persistent world lighting override, terrain ambient occlusion, approximate directional object shadows and consistent material/sprite shading.


v0.27: persistent attached colored lights, derived fire illumination, world-space fragment lighting and whole-sprite self-lighting.
