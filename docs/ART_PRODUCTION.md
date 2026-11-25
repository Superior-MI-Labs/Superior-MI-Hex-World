# Hex World art production: parallel agent handoff

Use the creator's fantasy references as an artistic quality benchmark: richly painted materials, organic silhouettes, warm highlights and cool shadows. Create original reusable source art and use CC0-1.0 where rights permit. Reference images are not themselves publication sources.

## Workflow

Atlas owns the shared [authoring workflow](https://github.com/Superior-MI-Labs/Superior-MI-Icon-Atlas/blob/main/docs/ai/START-HERE.md) and [visual-only image brief](https://github.com/Superior-MI-Labs/Superior-MI-Icon-Atlas/blob/main/docs/ai/IMAGE-ENGINE-WORKFLOW.md). This document supplies host-specific art requirements to the production agent, not a prompt to forward wholesale to the image engine. Generate a small group of isolated subjects first, inspect the source art, then batch approved families and process their actual pixels. Use the existing Atlas workflow for packaging and release.

## Shared visual requirements

- Ground/cliff: unprojected seamless opaque square swatches, 512 or 1024 px; neutral grayscale or RGB detail modulation, or full-color albedo as selected by the style. Inspect a 3×3 repeat.
- Upright sprites: isolated complete silhouettes on transparent straight-alpha PNG; orthographic 35.264° elevation; clear root or attachment point. Suggested logical height 256–512 px for small plants, 512–1024 px for large trees. Render ground and contact shadows separately in the host.
- Directional artwork: billboard by default for symmetric plants; six ordered 60° yaw views where required for asymmetric objects. Match canvas, pivot, scale and state names across views.
- Masks: periodic opaque grayscale coverage; animation: measured frames, stable anchors, natural motion and seamless loop where applicable.
- Match the approved style and subject of the current family; reserve magical features for appropriate subjects.

## Pilot assignments (72 assets/sequences)

| Family | Count | Deliverables |
|---|---:|---|
| ground | 8 | meadow fine/coarse, soil, mud, stone, sand, snow, paving |
| cliff | 4 | soil roots, layered earth, rock, mossy rock |
| grass | 12 | short/medium/tall, each green/dry/frosted/charred |
| foliage | 12 | 3 ferns, 3 flower clusters, 2 bushes, 2 reeds, 2 trailing vines |
| trees | 6 | pine, snowy pine, leafy, autumn, flowering, magical |
| props | 12 | 3 rocks, 3 mushroom clusters, 2 logs, 4 crystals |
| transitions | 6 | irregular snow, moss, leaf litter, mud, scorch, breakup |
| structures | 8 | pillar, broken pillar, arch, pedestal, masonry swatch, paving swatch, rubble, carved marker |
| effects | 4 | flowing water, waterfall, fire, magic glow |

These are production targets, not subjects to combine into one image. Preserve existing asset IDs. New general-purpose Atlas artwork uses unique `smi.world.fantasy.<family>.*` IDs and independent packs/branches.

## Host integration (after source generation)

World geometry uses 5 ft nearest-neighbor spacing and cell height, with 2.5 ft vertex subdivisions. World geometry and physical properties remain host-owned.

Use canonical Atlas regions, sequences, state sets and supported compositions. The optional Atlas spatial profile carries suggested visual height, directional views and wind; host style roles and physical interaction remain separate. See [environment bindings](ENVIRONMENT_ART.md), [directional bindings](DIRECTIONAL_ART.md), [interaction handoff](INTERACTIONS.md) and the current [architecture](ARCHITECTURE.md). For production scatter, use the existing style families and seasonal variant mappings, with spacing and wind where appropriate.

Deliver the canonical self-contained Atlas ZIP, source manifest and textures, IDs, rights notice, measured pivots, proposed dimensions in feet, previews and QA receipt through the Atlas acceptance and publication workflow. Resolve the published ZIP through the Atlas public catalog and pin its SHA-256 where supported. Validate actual assets in Hex World; a fixture or catalog entry is not proof of production compatibility. Style failures retain the previous style; style swaps and rendering leave authoritative world data unchanged.
