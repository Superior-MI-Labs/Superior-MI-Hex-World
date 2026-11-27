# Phase 4/5 performance acceptance
PR #4 exact head 948a0c6 passed 161/161 tests, GPU browser regression and actual Atlas 53-record/six-view fresh-session restoration (46062926156). Codex review had no findings. Baseline 465883d deployed (46062723866). CI uses SwiftShader, not the user's GPU; settled meadow samples varied from 3 to 9 FPS. No target-device performance claim.

## Target hardware protocol
Open the live laboratory in a hardware-accelerated desktop browser. Keep the tab visible, reset view, let art settle, choose the scenario under Performance capture, then record 10 seconds (1.5-second warmup). Export JSON. Repeat three times per useful reference at the same window size:
- Island, fixture art, settled idle.
- Exploration Meadow, fixture art, settled idle and pan/zoom.
- Published woodland style, clearing built using the reviewed plan, settled idle and rotation.
- Same woodland, weather, fixed water, torch/local occlusion enabled and disabled as separate comparable captures.
- One terrain edit and recovery; note which edit was performed. Labels do not execute actions automatically.
Save before editing or switching scenes. Do not compare different quality or art settings as equivalent workloads.

Reports record start/end camera, environment, quality/toggles, geometry revision, scene counts, browser/viewport, CPU stage timing, actual frame intervals, upload totals and cache hit fraction. Optional asynchronous GPU timer queries are bounded to four outstanding queries; disjoint results are discarded; unsupported timing is null. CPU frame time excludes final status serialization; GPU timing is not total display latency. Target sustained 30 FPS and p95 near 33.3 ms on agreed hardware/workload; no hardware-specific CI gate.

## Consolidation
Persistent terrain batches upload once directly to static GPU buffers on cache misses, releasing duplicate JS arrays; unkeyed diagnostics retain immediate drawing. Texture lookups are shared within frames and soft-alpha sorting reuses the original texture pair. No changed geometry or quality. Buffer bytes are estimated storage, not total GPU memory. Qualification and actual hardware measurements remain required.

## Review boundary
No Phase 6 work before review. Static emissive masks and coarse terrain light occlusion are technically qualified within documented constraints. Production terrain/directional art, immutable archives, complete manual authoring and target-device evidence remain open.
