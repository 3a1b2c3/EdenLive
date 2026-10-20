# Route implementation and review by capability

Choose only what the brief requires. Combine rows; these are capabilities, not mutually exclusive
genres. Record IDs in the run card's `capabilities`, with controllers/camera/input in
`implementation`. When `continuous_motion`, `aiming`, `resources` or `autonomous_agents` is
declared, import one matching catalog module from the run page or record it in
`implementation.catalog_skips`. The card `modules` list is provenance, not an import.
`control_scheme` and `player_modality` remain discovery hints; `controls` is
display text. Checkers never infer behavior from those labels or parse prose key bindings.

Behavior implements each row and closes the loop around it: progression, win/loss, terminal stop and
restart belong to that stage, verified by its `closure` playthrough. The third column is what the
final presentation must then show and what acceptance replays in full.

| ID / when present | Behavior check | Presentation and acceptance check | Omit when absent |
| --- | --- | --- | --- |
| `continuous_motion` / player steers an actor | Input frame, acceleration and release response | Clearance, viewpoint, boundary and restart velocity | Stopping/steering probes |
| `automatic_motion` / motion continues without input | Accepted steering/action changes ongoing motion | Upcoming decisions visible in time; reset speed/queues | A demand that releasing input stops motion |
| `indirect_control` / tilt, paddle or a proxy affects another object | Control -> physical consequence, with limits | Contact, reflection/support and visible cause/effect | Character-controller assumptions |
| `discrete_state` / cells, pieces, choices, feeds, stations or turns | Legal transition plus relevant rejection/edge; repeat policy | Occupancy/focus/mode and prerequisites; reset selections/queues | Continuous movement probes |
| `placement` / preview and commit | Valid and invalid site; commit/cancel if offered | Cost, occupancy, downstream effect and reset | Invented undo/cancel |
| `timing` / a window, deadline or timed phase matters | Relevant window/deadline/phase boundary; edge vs held semantics when input is timed | Cue/countdown matches the effective boundary; actual input timing when relevant | Forced timers or reaction tests |
| `aiming` / direction or target selection determines an action | Preview and resolved target agree; range/blocking as designed | Usable view, moving targets if present; hit/miss feedback | Manual aim for automatic targeting |
| `solid_space` / support, collisions or occlusion affect rules | Block/support/contact response | Actor footprint, thin boundaries, trigger/visual agreement | Avatar reachability on abstract interfaces |
| `navigation` / an agent must find a route | Reachable route and safe no-route behavior | Actual detour with collision; dynamic obstacle updates if present | AI/pathfinding for stationary or scripted actors |
| `resources` / count, capacity or progress constrains actions | Gain/spend/deplete boundaries actually used | Visible amount/availability, terminal precedence and reset | A score, health bar or economy added for its own sake |
| `autonomous_agents` / opponents, waves or automation | Real event production with bounded lifecycle | Agent acts and affects the round; peak counts when relevant | Enemies, waves or live threats invented for a puzzle |
| `mixed_modes` / core loop crosses interaction modes | Each mode plus transition and input ownership | Complete sequence and reset across phases | Forcing a hybrid into one controller |

Read [continuous controls](../build/continuous-controls.md) for the first three rows and
[discrete interactions](../build/discrete-interactions.md) for cell/menu/placement systems.
Use the [pattern router](../patterns/_index.md) for applicable timing, aiming, collision or navigation
detail, and [mixed modes](../patterns/mixed-modes.md) for transitions and ownership.
Prefer a success and relevant failure/boundary per capability over a universal checklist.

## Unmatched or new games

Start with the player's verb -> state transition -> feedback -> round outcome. Use matching rows
and, when necessary, a `custom:<name>` capability with its input, legal/illegal transition,
presentation and integrated evidence written in implementation notes. No match in a catalog means implement
the missing behavior, not silently substitute a nearby genre or skip its verification.

A falling-piece board uses discrete state and timing; tower defense combines placement, resources
and autonomous agents; a route followed by a battle uses mixed modes. Snake reversal/queues, maze
direction changes and push-box occupancy follow their own rules, despite all using a grid. Promote
specialized guidance here only when it changes decisions for several games; otherwise derive it
from the brief during implementation.

Every build assembles the complete static scene, builds the complete playable loop, then finishes
presentation and verifies the whole game through real input. An interface is a scene; it needs no
invented avatar or physics. Local turns, occupancy and encounter state belong with behavior, and so
do the global win/loss, terminal stop and restart that close the loop around them. Acceptance binds
the final presentation to those existing owners and replays the full sequence; it does not
reimplement them.
[Scope](../intake/scope.md) remains a separate decision.

## Reference brief coverage

These are compact routing prompts for all 24 shipped briefs, not exhaustive capability manifests or
generated-game acceptance results. Read the chosen brief for exact values, signature actions and
every applicable capability. A row must never add a rule absent from the brief; behavior examples
below select capabilities rather than prescribe a genre-specific engine. Derive the run card from
the brief and expand the row whenever a resource, agent, phase transition, timing boundary or
custom rule affects the round.

| Brief | Static scene | Applicable behavior | Acceptance |
| --- | --- | --- | --- |
| `3d-platformer` | Platforms, hero, pickups, hazards, goal | Movement, jump, support/collision, star/health resources, goal prerequisite | Goal after collection, fall/life loss, restart |
| `action-adventure-dungeon` | Rooms, hero, enemies, keys, gate | Movement, attack, inventory, doors | Dungeon clear, defeat, reset keys/gates |
| `arcade-racing` | Point-to-point track, vehicle, checkpoints, boosts, hazards | Steering, speed, collision, boost resource, finish progress | Finish/loss, vehicle reset, checkpoint progress when present |
| `beat-em-up` | Street, fighters, props | Movement, attacks, hit windows, agents | Clear waves, defeat, restart |
| `bomb-maze` | Maze, actors, bombs, exits | Grid movement, timed blasts, obstruction | Clear/exit, blast loss, reset timers |
| `cooking-time` | Kitchen, chef, stations, order view | Movement, station actions, local preparation | Orders/deadline, failure, reset resources |
| `creature-battle` | Trainers, creatures, command view; route if retained | Turns, target/move/item choices; route movement if retained | Battle win/loss, party/item/phase reset |
| `endless-runner` | Route, runner, hazards, pickups | Automatic motion, lane/jump/duck, collision | Distance goal, crash, speed/queue reset |
| `flight-combat` | Sky, aircraft, targets, markers | Flight, aiming, weapons, agents | Mission success, defeat, reset flight/resources |
| `fps-arena` | Arena, weapon, enemies, cover | First-person control, aim/fire, collision | Clear arena, defeat, restart |
| `io-snake` | Arena, snakes, food | Continuous steering, growth, contact | Size/progress, collision loss, reset bodies |
| `maze-chase` | Maze, player, pursuers, collectibles | Grid turns, occupancy, pursuit | Collection goal, capture, restart |
| `party-obstacle` | Course, contestants, mechanisms | Movement, timed hazards, support | Finish, elimination, reset mechanisms |
| `platform-fighter` | Platforms, fighters, effects | Movement, attack, knockback, recovery | Ring-out objective, loss, reset stocks |
| `push-box-puzzle` | Board, boxes, targets, walls | Discrete push, occupancy, allowed recovery | All targets, brief-defined loss/retry, reset board |
| `scrolling-shoot-em-up` | Scrolling field, ship, enemies, shots | Steering, fire, waves, collisions | Boss/wave clear, defeat, restart |
| `stealth-action` | Compound, guards, disguise, exit | Movement, detection, agents, disguise | Target then exit, defeat, reset suspicion |
| `surveillance-survival` | Office/feed interface, doors, clock/power view | Feed/door choices, timing, power resource, agents | Survive shift, breach, reset feeds/power |
| `survivors` | Field, hero, enemy samples, gems, beacon | Movement, auto-targeting, waves/agents, resources, survival timing, extraction phase | Survival then extraction, defeat, restart |
| `third-person-melee` | Arena, hero, boss, flask, cover geometry | Movement, camera, attack/dodge timing, boss agent, health/flask resources, collision/occlusion when rule-bearing | Boss defeat, player defeat, reset combat/resources |
| `third-person-shooter` | Village, agent, enemies, cover, exit | Movement, camera/aim, fire, ammo resources, enemy agents, cover/collision, extraction phase | Clear then extract, defeat, restart |
| `tower-defense` | Path, pads, tower/enemy samples, economy view | Placement, resources, path-following agents | Clear rounds, lives exhausted, reset placements |
| `traditional-fighter` | Strip, fighters, health/time view | Spacing, strikes, declared defense/timing only when present | Match verdict, defeat, restart |
| `vehicle-soccer` | Pitch, cars, ball, goals, boost pads | Driving, indirect ball contact, resource use | Score verdict, reset kickoff/round |

The creature-battle brief records a route-versus-fixed-encounter question in `open_questions`;
resolve it during intake before committing its inventory. Do not silently discard the route.
A tactical board follows the same flow: board/terrain/units/command surfaces, then selection,
grid routing, turn ownership and targeting, then battle outcomes, turn UI and restart. Grid
occupancy can handle blocking without real-time physics. Hybrid games combine rows and verify
phase transitions without duplicating scene assets or state ownership.
