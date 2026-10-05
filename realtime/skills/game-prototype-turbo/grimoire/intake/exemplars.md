# Gameplay exemplar index

Read only the closest one or two briefs from `assets/game-briefs/`. Names below are filename stems
(`name.brief.json`). All 24 are examples of intent and format, not mandatory control pairings or rules.
For implementation use [capabilities](../review/capability-matrix.md), independent of these groups.

| Gameplay signal | Exemplar stems |
| --- | --- |
| Free movement and platforms | `3d-platformer`, `party-obstacle` |
| Automatic movement with timing/steering | `endless-runner` |
| Driving or car-ball contact | `arcade-racing`, `vehicle-soccer` |
| Aimed shots | `fps-arena`, `third-person-shooter`, `flight-combat` |
| Scrolling fire with polarity | `scrolling-shoot-em-up` |
| Melee, duels or ring-out | `third-person-melee`, `traditional-fighter`, `platform-fighter`, `beat-em-up` |
| Combat plus traversal, detection or survival | `action-adventure-dungeon`, `stealth-action`, `survivors` |
| Continuous snake or maze movement | `io-snake`, `maze-chase` |
| Cell operations and spatial rules | `push-box-puzzle`, `bomb-maze` |
| Placement with automation | `tower-defense` |
| Carry, process and serve | `cooking-time` |
| Menu decisions and turn resolution | `creature-battle` |
| Fixed feeds and defensive toggles | `surveillance-survival` |

Similar geometry does not imply shared rules: maze tokens can reverse, snakes may prohibit it,
push-box actors wait for a move, and falling pieces have occupancy/rotation/lock rules. Infer those
from the requested behavior. For an unfamiliar in-scope idea: verbs -> state changes -> capabilities
-> fitting assets -> minimal missing code -> one useful success and failure check per capability.
