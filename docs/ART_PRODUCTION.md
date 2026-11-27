# Hex World art production: parallel agent handoff

The ten creator references define painterly fantasy quality, not reusable source art. They show frost-covered conifers, luminous crystal gardens, mossy ruins, warm autumn forest, wetlands, giant mushrooms, rocky trails, bright streams, evergreen woodland and flowering magical trees. Do not copy or upload reference images without separate permission. Generate original art with comparable richness; use CC0-1.0 where rights permit. No baked complete hex dioramas.

## Shared standards
- Geometry: 5 ft nearest-neighbor spacing; 5 ft cell height; 2.5 ft vertex snapping; six 60° yaw views; fixed orthographic 35.264° elevation. Do not bake hex borders, grid lines or fixed terrain silhouettes.
- Ground/cliff textures: unprojected square 512 or 1024 px repeatable texture, opaque, no background, no perspective, no cast shadows. Deliver neutral grayscale detail first; optionally RGB detail modulation, NOT full-color albedo. Tile-check 3×3. Physical repeat is selected by host, default 5 ft.
- Upright artwork: transparent straight-alpha PNG, full silhouette, no square tile or baked ground/shadow, clear root/feet anchor. Orthographic view at 35.264° elevation. Small assets 256–512 logical px high, large trees 512–1024; these are proposed source sizes, not world scale. Preserve matched pivots and logical sizes between states. Billboard/symmetric sprites are usable today; six-direction sets are supported when qualified. See DIRECTIONAL_ART.md for the new +30° camera alignment and unresolved authored angle convention.
- Masks: periodic grayscale, opaque, black-to-white distribution, no baked color/hex border. Animation: original Atlas sequence with real measured frames, consistent logical canvas/pivot, timing, seamless loop.
- Visual consistency: painterly texture, clear silhouettes, rich local value variation, warm highlights/cool shadows without strongly baked directional cast shadows, consistent world scale. Never add unrelated crystals/glow to every natural asset.
- Every agent works in a separate pack/branch, unique pack and asset IDs under smi.hex.fantasy.<family>.*, version 0.1.0 pilot. Atlas owns all visual regions/sequences/states and packaging. Hex World owns role mapping and physical properties. No duplicate asset formats, no overwriting another agent's assets.

## Assignments (72 pilot assets/sequences)
| Family | Count | Deliverables | Runtime |
|---|---:|---|---|
| ground | 8 | meadow fine/coarse, soil, mud, stone, sand, snow, paving | top detail; one active texture per style |
| cliff | 4 | soil roots, layered earth, rock, mossy rock | side detail; one active texture per style |
| grass | 12 | short/medium/tall, each green/dry/frosted/charred | static regions; choose three green variants for meadow-01/02/03 first |
| foliage | 12 | 3 ferns, 3 flower clusters, 2 bushes, 2 reeds, 2 trailing vines | static sprite objects; decorative scatter supported |
| trees | 6 | pine, snowy pine, leafy, autumn, flowering, magical | static sprite objects; 12–30 ft suggested height |
| props | 12 | 3 rocks, 3 mushroom clusters, 2 logs, 4 crystals | static sprite objects; scale per item |
| transitions | 6 | irregular snow, moss, leaf litter, mud, scorch, breakup | current single grayscale mask; multi-overlay bindings deferred |
| structures | 8 | pillar, broken pillar, arch, pedestal, masonry swatch, paving swatch, rubble, carved marker | detail textures or static props; geometry separately authored |
| effects | 4 | flowing water, waterfall, fire, magic glow | Atlas sequences; manual sprite placement supported, fluid/emission engine deferred |

## Agent delivery
Read Atlas AGENTS.md, docs/ai/START-HERE.md, docs/ai/FORMAT-API.md and the matching recipe. First make 1–3 original candidate assets, review against creator references at native scale, then complete the pilot only after review. Measure actual crops; do not assume image-generator grid alignment. Deliver canonical self-contained Atlas ZIP, manifest/texture paths, IDs, original/license notices, contact sheet, proposed physical dimensions in feet, and truthful QA receipts. Use existing Atlas tools (qualify_asset_zip.py, validate_visual_pack.py, ai_acceptance.py). Publish only after creator/visual QA and normal Atlas release process. Provide a version-pinned HTTPS manifest URL with CORS-compatible images, not a GitHub HTML page. Do not create a second asset catalog or renderer.

## Integrator
Copy the example style, map the required three vegetation IDs and top/side texture to the actual published Atlas IDs. Each binding is either a legacy string using the profile manifest or {"manifest":"https://.../manifest.json","asset":"actual.id"}. Relative paths resolve from the hosted profile document, not the Hex World page. Host the JSON with CORS and load its URL in the laboratory. It may reference many separate packs. A failed load keeps the previous style. Use grayscale or rgb_detail (RGB modulation, not albedo), strength 0–1. A separate object may use the existing manifest/asset input. Seasonal overrides, six-view bindings, decorative scatter, local lights, fixed/simulated water and per-material texture blending now exist. Static same-pack grayscale emissive masks and opt-in coarse terrain light occlusion are technically qualified; animated/directional masks, generalized effect-art bindings and production-art qualification remain open. Do not claim that a specific asset supports these features without testing its actual archive. Test every claimed state with the actual published art. Keep world data unchanged by style swaps.

For responsive brush, foliage, switches, doors and effects, read [interaction asset handoff](INTERACTIONS.md). Do not bake physical or game behavior into art.

For wind-responsive static or animated sheets, follow [environment artwork bindings](ENVIRONMENT_ART.md). Use canonical Atlas regions, sequences and state sets; capabilities are mapped in Hex World.

Per-material full-color albedo is now supported through style bindings; seasonal vegetation variants can also be supplied using the [environment artwork contract](ENVIRONMENT_ART.md). Ground texture artwork remains unprojected and seamless.

For directional sprites use [Hex World directional binding](DIRECTIONAL_ART.md). The six-view contract is host-specific; the canonical Atlas visual manifest remains unchanged.

## Current production gate
Seven fantasy collections were approved as CC0 previews and published in Atlas PR #45. Their actual pixels and metadata are the pilot inputs, not an automatically qualified production style. Resolve stable IDs through the public catalog, verify archive SHA-256 and host-supported role, then author a Hex World style binding and inspect its actual render. For progress and the remaining gates see [ROADMAP.md](ROADMAP.md).
