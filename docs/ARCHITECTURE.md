# Foundation contract (v0.1)
This independent repository supersedes the height-only Tabletop prototype direction, not its existing implementation. Reference: https://github.com/Superior-MI-Labs/Interactive-Tabletop/blob/agent/hex-world-terrain-elevation-and-world-contract-20261125/HEX_WORLD_CONTRACT.md . Retain axial math and fixed 35.264 degree isometric projection with six yaw directions. Unlike the prototype, all ordinary interiors, caves and buildings share Q/R/Z; portals only for intentionally separate spaces.

## Authority
World configuration: smi-hex-world/1. Horizontal nearest-neighbor distance defaults to 5 ft, vertical step defaults to 5 ft, chunk defaults to 16 per axis. Signed integer addresses use floor division. Physical positions are derived, never camera pixels. Immutable grid per world; migration is explicit. A sparse known chunk has a default material and explicit overrides; absence of a chunk means unknown, not air. The demo is in-memory; durable indexed storage, streaming and uniform compression beyond default cells are later. No gameplay bounds, but JS safe-integer arithmetic constrains representable addresses.

Shapes are cell-local normalized occupancy: full, slab with fractional height, ramp with direction and fractional low/high heights. Partial geometry is not a second grid. A cell may contain air plus effects; surface decoration and entity placement will be independent components. Future mesh generation, collision, face visibility, overlapping surfaces and navigation must consume the same geometry definition. Debug rendering is not collision proof.

## Time
Host advances simulation explicitly (manual, turn-based, real-time or scaled); frozen ignores advances. Visual animation uses an independent clock, optionally paused by host. Effects: persistent, decorative, timed, reactive. Reactive effects need registered material response rules; no generic automatic fuel/spread in v0.1. Timed effects expire in simulation time, never animation time. Explicit editing remains possible during frozen time. No implicit wall-clock mutation.

## Assets
Atlas owns artwork, pivots, region/sequence/state_set/composition definitions in smi-visual-pack/1. Hex World owns physical placement and state. Providers return validated native pack metadata through a shared resolver, not executable code. v0.1 checks provider identity and pack schema only; full Atlas validation, dependency resolution, textures, CORS, licenses, hashes, caching and animation rendering remain open. Do not claim arbitrary third-party compatibility. A world-specific binding references stable pack/asset IDs and may map physical states to visuals. Prefer world-space surface textures and transparent overlays, anchored vertical sprites, and depth-aware geometry. Use Atlas animation timing rather than a competing format.

## Next gates
1. Add versioned world/chunk serialization with unknown-vs-air and edit roundtrip tests.
2. Port proven camera and viewport interaction from Tabletop, implement proper 3D depth and picking, all ramp orientations, exposed faces across boundaries.
3. Validate and render real Atlas pack (region, sequence, state_set, composition); missing assets produce placeholders.
4. Streaming, LOD, prefabs and material responses; test excavation, fire, slopes, houses/caves and multi-floor surfaces.
5. Host integration via public contracts; Tabletop owns character stats and gameplay. No duplication.
