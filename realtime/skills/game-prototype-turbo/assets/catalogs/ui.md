# User Interface assets

Read only selected APIs; entries are candidates, not required mechanics.

Route by what the UI is for, not by the directory it lives in. Read only the section your current
stage owns:

| Purpose | Stage that owns it | Section |
| --- | --- | --- |
| Infrastructure: renderer, resize, input primitives | Stage 1, as the scene needs it | [Infrastructure](#infrastructure) |
| Core play surface: board, battle commands, monitoring view, placement area | Stage 1 lays out and binds it; Stage 2 makes it operable | [Core play surface](#core-play-surface) |
| Decision feedback: health, resources, objective, turn, timing and situational cues | Stage 2, at whatever fidelity play requires | [Decision feedback](#decision-feedback) |
| Delivery presentation: result cards, decorative titles, pause/settings menus | Stage 3 | [Delivery presentation](#delivery-presentation) |

A game that needs none of these still needs observable outcomes and an operable restart.
Do not open the full factory API for a stage that only needs a layout anchor: `GameUiFactory.js`
spans all three stages by component type, so read the component you need, not the whole surface.

## Infrastructure

### `assets/user-interface/PrototypeShell.js`
- Functionality: Renderer/resize helpers; `createRenderer` defaults `pixelRatio` to `min(devicePixelRatio, 2)` and `installResize` sizes the drawing buffer with `setSize(width, height, false)` while observing both window resize and the container (`ResizeObserver`). CSS owns display size (`#app canvas { width:100%; height:100% }`). `KeyState` with held axes, queued `consumePress()` edges or immediate `onPress()` ownership, repeat suppression and blur/visibility cleanup; pointer hooks and `MouseLookDelta` (click-to-lock relative mouse look, explicit free-cursor opt-out; [integration](../../grimoire/patterns/player-controller.md#mouse-look-only-when-selected)); HUD, meter and round-status writers. Use one edge consumer per action and clear input on round transitions; see [input ownership](../../grimoire/review/input-contract.md#runtime-preflight-and-clock).
- Stage note: this is scene/input infrastructure, not interface design. Needing it never implies composing a HUD.

## Core play surface

### `assets/user-interface/GameUiFactory.js`
- Functionality: `panel`, `slot` and `controls` compose the static play surface and its layout anchors. Load `game-ui.css`; state and actions remain game-owned. Read the [shared API](../../docs/api/game-ui-factory.md#shared-api) and [core components](../../docs/api/game-ui-factory.md#core-play-surface).
- Stage note: Stage 1 lays out existing play areas; Stage 2 binds the controls. The remaining factory uses are routed in the later sections below.

### `assets/user-interface/GameUiAdapter.js`
- Functionality: Preserve existing DOM nodes/listeners when applying roles to a core play surface. Imports GameUiFactory; copy with `game-ui.css`. Creation/adaptation and isolated preview generation use `forge/ui.py`.

### `assets/user-interface/DomHudRenderer.js`
- Functionality: Renders shared UI state into DOM HUD elements.

## Decision feedback

Supply what the mechanic needs to be playable. A number, bar or highlighted cell is enough; styling
and hierarchy are Stage 3 concerns.

Use `GameUiFactory`'s `metric`, `meter`, `tracker` or `notice` for the selected feedback and `actions`
for existing game commands or restart. Read the [shared API](../../docs/api/game-ui-factory.md#shared-api)
and [feedback components](../../docs/api/game-ui-factory.md#decision-feedback).

### `assets/user-interface/SegmentedResourceView.js`
- Functionality: Bounded ResourcePool amount/capacity and use threshold; pair with `assets/user-interface/segmented-resource.css`. Infinite counters need another view.

### `assets/user-interface/UiStateModel.js`
- Functionality: Provides observable UI state updates with stable snapshots.

### `assets/user-interface/NotificationQueue.js`
- Functionality: Maintains visible and pending notification state over time.

### `assets/user-interface/WorldAnchorLabel.js`
- Functionality: CSS-space world projection with clipping; caller supplies occlusion.

### `assets/user-interface/MinimapProjector2D.js`
- Functionality: Maps world-space positions and headings into minimap-space coordinates.

### `assets/user-interface/HeadingRelativeRadar.js`
- Functionality: Renders nearby contacts in heading-relative radar space.

### `assets/user-interface/FlightHud.js`
- Functionality: Renders flight, weapon, navigation, scoring, and warning state as a cockpit-style HUD.

### `assets/user-interface/RaceMinimap.js`
- Functionality: Renders race progress and competitors into a track-aware minimap.

## Delivery presentation

Use `GameUiFactory` for final composition: configurable colors and fonts, centered `banner` titles,
and `dialog` result/pause cards with state variants, icons, statistics and button hierarchy. Use
`GameUiAdapter` for purposeful existing markup; recompose temporary state dumps first. Compose for
a desktop play view. A pause or result card is not a
level-select of independent stages. See the [presentation reference](../../docs/api/game-ui-factory.md#delivery-presentation)
and [result-card migration](../../docs/api/game-ui-factory.md#reusable-result-and-pause-cards).

### `assets/user-interface/RoundOutcomeOverlay.js`
- Functionality: The verdict screen a resolved round shows, plus the hard stop that belongs with it: announces won/lost with the director's reason and how to replay, and freezes the simulation by returning 0 from `scaleDelta(delta)` so the scene keeps rendering (the final frame is the evidence) while nothing advances. Wrap the frame delta at its source, keeping `clock.getDelta()` inside the wrap so time is still consumed each frame; the only precondition is that nothing divides by delta. `showOnTerminalEvent(overlay, event)` shows it from a `round.won`/`round.lost` event so callers do not re-derive which events are terminal.
- Acceptance: Preserve those behavior paths when using the factory's result-card view or custom design. Keep one visible overlay and one action owner; the [migration note](../../docs/api/game-ui-factory.md#reusable-result-and-pause-cards) explains the boundary. Stage 2 already owns the terminal stop and restart; replacing this view must not add a second owner for either.

### `assets/user-interface/StorageSettingsStore.js`
- Functionality: Persists user settings safely through localStorage. Only for requested settings/options surfaces.
