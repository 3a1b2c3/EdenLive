# Semantic interactions

Outcome: rules consume identifiable real interactions independently of their visual styling.
Use named tags when rules need identifiable hazards, resources, goals, stations, switches or
other events. A tag describes meaning; it does not require a collider, color, mesh or actor.
An empty `interaction_tags` list is valid when named tags do not help the game.

## Workflow

Inspect the brief's intended interactions and their actual event sources.
Each brief tag has an `id`, a `meaning` and a semantic `role` such as `hazard`, `resource`, `goal`
or another snake_case role.
Do not drive rules by comparing material colors.

Route the real event source to the same round rules: overlap/contact in space, a committed cell
operation, resolved menu choice, served order or completed phase. Use stable IDs and distinguish
preview from commitment. A tag's appearance alone cannot satisfy an objective.

For collision interactions, use the intended footprint/volume and entry/stay/exit policy; fast
motion may require a swept test. For discrete interactions, use occupancy, selection or state
transitions instead of inventing a distance trigger. Reject invalid actions with feedback when
needed to explain what the player can do next.

Process a one-shot pickup/serve/goal once; repeated damage or held actions follow the game's
explicit cadence. Reset consumed flags and event deduplication with the round. Use shape, text or
pose with color so meaning remains legible when palettes change.

## Verify and record

Verify one actual accepted event and an applicable repeat/rejection case. Record the semantic ID,
real source and resulting rule change with the current artifact; appearance alone is not evidence.

For example, a single-use boost pickup can expose its consumed state, the speed/acceleration effect
actually applied and its own application count. Repeat contact before any rules-defined respawn
and confirm that count stays at one. A second pickup may legitimately increase the total count;
an aggregate lower bound alone does not rule out duplicate application. Retain evidence of a brief
effect when it expires before sampling, and verify scoring only if the game awards it.
