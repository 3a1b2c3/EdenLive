# Game Feel assets

Read only selected APIs; entries are candidates, not required mechanics.

### `assets/game-feel/CoyoteTime.js`
- Functionality: Keeps a jump legal for a short grace window after a character walks off a ledge, armed only by a real grounded-to-airborne transition and limited to one jump per airborne period.

### `assets/game-feel/JumpBuffer.js`
- Functionality: Remembers a jump pressed shortly before landing and fires it once on touchdown, discarding presses older than the buffer window.

### `assets/game-feel/HitStop.js`
- Functionality: Freezes gameplay time briefly on a landed hit through a reported time scale, leaving the render loop running; overlapping hits take the longer window instead of summing.

### `assets/game-feel/DoubleJump.js`
- Functionality: The air-jump budget of a double/triple jump: re-armed only on the grounded edge, spent exactly once per airborne period. Composes with `CoyoteTime`/`JumpBuffer` (which own the first jump).


### `assets/game-feel/PlanarRecoil.js`
- Functionality: Bounded planar KnockbackModel adapter; caller supplies collision commit and game-specific hit response.
