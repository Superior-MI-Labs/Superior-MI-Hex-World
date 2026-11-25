# Environmental interactions and asset handoff

## Pattern
Host command → validate physical movement → derive ordered spatial events → commit world state → return signals to host. Rendering independently samples the movement presentation and contact parameters. Never attach a gameplay trigger to an animation frame or a visible sprite.

The example profile examples/interactions.json demonstrates tags, surface conditions and signal names. Use existing cell components.interaction_tags and entity interaction_tags. Enter/leave use the support-cell route; use targets one reachable cell or entity. The profile is trusted host data, not embedded executable artwork. A host may interpret a signal as a sound, animation, trap, dialogue, door action, resource harvest or other behavior. No such game-specific behavior is built into Hex World. Future state mutation must be explicit, validated host commands, not a second hidden state machine.

## Art agents
For flexible grass, reeds, fern or brush: transparent complete silhouette, stable root/feet pivot [0.5,1], no ground/shadow baked in. The existing static art bends at runtime, no separate image necessary for the pilot. Keep a matched neutral and disturbed pose as optional future Atlas states if useful, but don't bulk animate until runtime binding is approved.
For doors, switches, chests, etc: matched closed/open or inactive/active regions and canonical Atlas state_sets; same logical canvas and hinge/anchor alignment. Deliver actual measured crops and state QA. Hex World does not yet connect those states to geometry/collision automatically.
For water, snow, leaves: optional ripple, splash, footprints or rustle sequences using existing Atlas frame/timing contracts. Keep them separable from base material; no baked actor. Runtime event-to-effect mapping is a future gate.

## Acceptance
Preview must not trigger events; a failed move must not alter state or emit signals; a committed multi-cell move must report intermediate contacts exactly once per visit; changing view/cutaway/LOD must not change signals. The visual bend must hold root fixed, reject different-floor contacts and relax at distance. Save/load preserves tags, not transient presentation or signals. Do not confuse the pilot with continuous collision or a game rules engine.

The laboratory can import a local interaction profile JSON and restore defaults. This is session configuration; host applications should version/pin their chosen profile outside world saves. Use the existing profile schema and do not ship executable behavior in artwork.
