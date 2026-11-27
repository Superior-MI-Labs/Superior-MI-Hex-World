# Superior MI Hex World — agreed product direction
Updated 2026-11-27. Design agreement only for Phases 6–9; no expansion beyond the Phase 5 review gate.

## Product
A reusable isometric world creation and game runtime engine. A creator may construct a scene manually, collaborate with AI, or combine both. The same persistent world may be used by a tabletop campaign, a single-player adventure, or another game. Visual Atlas remains the authority for published artwork and GUI components. Hex World owns spatial state, terrain, entities, placement, environment, movement, collisions, rendering and validated edits. Applications own game rules, inventories, character statistics, turns, progression and HUD layout/data bindings.

## Shared commands, not two editors
Manual controls and AI clients invoke one typed command interface built around the existing pure builders, prefab planner, validated edit plans and history. Classify commands by intent:
- Read/query: search published Atlas assets, inspect selected terrain/objects, list supported placement options.
- Presentation: open/focus catalog with query and filters, select/highlight results, adjust camera or a transient placement preview. These do not mutate world state.
- Proposal: create a bounded validated world edit plan with expected cell/entity values, report conflicts and required terrain edits.
- Apply/undo: authorized host executes the reviewed plan atomically and records history.
Example: “pull up fantasy wooden tavern assets” opens the current catalog with grounded search filters, not a fabricated construction plan. Selecting an asset enters a placement session. “Build a tavern here” proposes a valid construction plan and awaits approval appropriate to host policy. AI is not granted arbitrary code execution or more capabilities than its delegating user.

## Intelligent placement
Evolve smi-hex-prefab/1 rather than creating a parallel house format. Separate Atlas visual bindings (appearance, scale, view, states) from host construction requirements (relative cell footprint, foundation support, clear volume, entrances, stairs, object anchors, colliders and interaction state). Existing prefabs currently reject occupied cells; do not silently change that default. A future explicit excavation/foundation policy must produce one mixed edit plan with known-cell requirements, exact expected values and all affected entities. Protect existing structures, nonreplaceable terrain, occupied cells, water and unknown space by default. Show conflict, proposed earthwork and valid placement separately; permit intentional destructive work only under a clear policy and permission. Preview and apply must share the exact plan. Negative levels and future smaller vertical steps remain host grid concerns.

Proposed controls: move mouse to position ghost; left click to confirm; right click/Escape to cancel; middle-button vertical drag adjusts depth while placing; wheel zooms; R/Shift+R rotates; optional repeated placement. This is a placement-session interaction state, not a camera rewrite. Snap to supported surface, explicit layer or authored anchor. Do not claim support for arbitrary free-height foundations until the underlying geometry and navigation contracts support it.

## Editor, gameplay and host authority
Use the same world model and renderer, different controller/HUD configurations. Editor includes catalog, selection, inspector, preview, history and optional AI. Gameplay presents a controllable character, game camera, abilities, interactions and application-defined HUD. Capability checks are enforced at the authoritative command boundary, not CSS. Builder, DM, player and spectator are example profiles, not hardcoded game roles. An application may grant a player constrained construction permissions. Scope by world/entity/region and operation. Multiplayer servers validate client commands; single-player can run the same command boundary locally without a required server. No client-side visibility controls may substitute for authoritative permissions or hidden-state filtering.

## HUD and applications
Use Atlas UI artwork, state sets and compositions where appropriate. A runtime HUD binds application-owned typed state to UI components. D&D may bind AC, HP, spell slots and action economy; a survival game may bind hunger/stamina; neither changes Hex World core rules. Avoid building a general game rule engine before a concrete second game validates the boundary.

## Review and acceptance
Stop after Phase 5 for an engine review and confirm these contracts before Phase 6 implementation. The next vertical slices should be manual tavern placement (foundation/basement and undo), one local playable scenario with no privileged editor controls, AI catalog search and reviewed placement using the same tools, then a Tabletop encounter plus a distinct single-player example. Avoid parallel renderers, save formats, duplicate taxonomies, or AI-specific construction pipelines.
