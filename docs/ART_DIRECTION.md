# Fantasy terrain art direction and qualification

## Target
The user's reference shows dense, varied hand-painted grass tufts, broad leaf shapes, yellow-green highlights, dark inner foliage, scattered earth/stone, and a chunky exposed soil edge. Aim for that richness, not its square footprint. Do not publish or trace the reference image; its rights are unknown. Use original or licensed art.

## Runtime artwork contract
Atlas smi-visual-pack/1 owns texture regions, pivots, animation sequences and attribution. Hex World style profiles (smi-hex-style/1) bind asset IDs to visual roles and configure physical texture repeat, vegetation scale and lighting. The world owns geometry, material and surface state. Styles do not change navigation or simulation. No pre-rendered shape atlas is required for the 2,187 upper profiles.

| Role | Initial production target | Authoring constraints |
|---|---|---|
| Ground detail | 6 seamless meadow/soil/stone/sand swatches | 512 or 1024 px square, neutral detail for tinting, no baked directional shadow, seamless edges |
| Exposed earth/rock | 6 cliff/soil detail swatches | seamless both axes, stratification, neutral detail, no fixed silhouette |
| Grass | 12 tufts (short/medium/tall, dense/sparse) | transparent PNG, bottom-center pivot, tight alpha crop, consistent 35-degree viewing direction, no ground tile |
| Dry/charred vegetation | 6 matched alternatives | same silhouette families and anchor conventions |
| Flowers, rocks, leaf litter | 12 small props | transparent, physical footprint and anchor, no rectangular background |
| Snow/leaves/scorch | 6 reusable coverage masks | grayscale, periodic, no baked hex border |
| Wind/fire/water | 3 short loops initially | Atlas sequences, stable pivots and timing, transparent where appropriate |

Initial renderer supports one repeating grayscale detail for top and side per style, weighted grass variants, alpha-cutout sprites, surface coverage masks and simple directional terrain lighting. Full-color per-material texture blending, overlay artwork, directional sprite variants, actual shadows/AO, transparent blending and animation bindings for vegetation remain explicit gates. Do not author production art around unsupported behavior.

## Qualification
Publish a small pilot pack first: no bulk generation until it passes a visual scene review. At close zoom inspect dense grass, varied silhouettes, readable ground gaps, no alpha fringe, consistent scale and lighting. Inspect six camera directions, slopes, cliffs, caves, excavation, snow edges, charred regions and seams across chunk boundaries. At farther zoom check mipmap stability and graceful vegetation density reduction. Test unchanged world coordinates and save state with style swaps. Record licensed sources, pack version and content hashes. Check atlas crops, pivots and alpha before publishing via existing Atlas pipeline. Review against the reference by eye; automated GPU tests cannot certify art quality.

The bundled meadow fixture is original procedurally generated development artwork only, CC0-1.0. It exercises the contract, not the final quality bar. Next art production should occur in Superior MI Atlas; Hex World should consume its manifests.
