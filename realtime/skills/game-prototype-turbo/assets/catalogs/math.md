# Math assets

Read only selected APIs; entries are candidates, not required mechanics.

### `assets/math/RandomUtils.js`
- Functionality: Provides a deterministic pseudo-random generator with uniform, integer range, step range, and choice helpers.

### `assets/math/ScalarUtils.js`
- Functionality: Provides shared scalar operations for stable numeric motion and value normalization.

### `assets/math/TimeUtils.js`
- Functionality: `Clock` provides system/manual timestamps. `FrameStepper` offers bounded fixed substeps or discrete render-only accounting; `advance()`/`read()` expose raw, simulated, paused, backlog and dropped time. The game owns pause and timer rules; see [runtime timing](../../grimoire/review/input-contract.md#runtime-preflight-and-clock).

### `assets/math/Vector3Utils.js`
- Functionality: Normalizes vector inputs into safe Three.js vectors and basis-aware planar directions.

### `assets/math/WorldBasis.js`
- Functionality: Defines how gameplay directions map onto world axes and keeps basis-aware movement, height, compass, and frame math consistent.
