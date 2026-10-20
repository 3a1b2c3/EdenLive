# Interaction assets

Read only selected APIs; entries are candidates, not required mechanics.

### `assets/interaction/CursorPlacementController.js`
- Functionality: Casts a cursor ray onto a placement plane, snaps to a cell grid, validates against bounds, occupancy and cost, and emits a preview with commit and cancel.

### `assets/interaction/MenuSelectionController.js`
- Functionality: Runs a selection state machine over N menu options with wrap on/off, disabled-option skipping, and a named transition returned for every input; no state is terminal.

### `assets/interaction/FallingPieceController.js`
- Functionality: Shift, rotate (with wall kicks), soft/hard drop and lock control for a falling grid piece, including the seven tetrominoes, gravity catch-up over long frames, and an optional lock delay. Collision is delegated to a caller predicate; the caller settles the locked cells.

### `assets/interaction/CarryStationController.js`
- Functionality: Single-item carrying plus timed processing stations that transform an accepted item into a product and run unattended, with range checks and an explicit result for every refusal.

### `assets/interaction/FeedToggleController.js`
- Functionality: Switches the active view/feed index and drives a debounced door or power toggle that queues presses arriving during the cooldown instead of dropping them.

