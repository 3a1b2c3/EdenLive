# GameUiFactory

Outcome: compose interface components from caller-owned values and actions without implying
gameplay mechanics. Read the shared API and the purpose section selected by the current stage.
Game-specific art direction can replace this view.

## Component types by stage

Types are candidates, never requirements. Reuse the components already present as the game advances.

| Stage | Read with the shared API | Purpose |
| --- | --- | --- |
| 1 / scene | [Core play surface](#core-play-surface) | Static layout and interface anchors |
| 2 / behavior | [Decision feedback](#decision-feedback), retained play surface as needed | Existing actions, values, outcome notice and restart |
| 3 / acceptance | [Delivery presentation](#delivery-presentation), retained components as needed | Final composition and state screens |

## Shared API

Copy `assets/user-interface/GameUiFactory.js` and `game-ui.css`; load the stylesheet once. No
Three.js, remote font, image or npm dependency is needed. The optional `GameUiAdapter.js` imports
the factory and styles existing nodes. `forge/ui.py` copies this small closure and makes a preview.

`createGameUI({document?, mount?, theme?, components?, actions?, state?})` returns frozen
`{root, elements, config, update(state), dispose()}`. `elements[id]` is the stable component node;
`config` contains deeply frozen resolved options. `dispose()` removes owned DOM/listeners and is
idempotent. Updates after disposal do nothing. Unknown config keys/types and duplicate IDs fail.
Text is assigned with `textContent`; state values with the same content avoid DOM writes even when
the caller mutates an existing object. An omitted component has no DOM or update work.

Each component has a unique lowercase slug `id`, `type`, optional `label`, and `dock` in
`top-left`, `top-right`, `bottom-left`, `bottom-right`, `top-center`, `center` or `bottom-center`
(default `top-left` unless the selected type says otherwise). State is keyed by id;
`{label, value, displayValue, text, visible}` writes its text/visibility. Optional `displayValue`
formats a readout independently of its numeric `value`, e.g. `{value:82, max:100, displayValue:'82 / 100'}`
for a meter. Omitted fields use empty text/config label.
Omitted component IDs retain their previous view. Supply a complete display value for each updated
component, not partial nested patches.

Compose for a desktop browser window. Do not add a phone layout, a touch overlay, a gamepad
mapping or a narrow-viewport breakpoint; keyboard and mouse/pointer remain the mapping. The
factory CSS has no phone media query, and isolated previews check 960x640.

## Core play surface

Lay out the game's interface areas in Stage 1, then bind their existing controls in Stage 2.
For a requested title screen, a static `brand` title can be part of this surface. A title or
pause card is not a level-select of independent stages.

| Type | Presentation | Applicability / skip |
| --- | --- | --- |
| `panel` | Title/body card | Existing instructions, objective or status; not a new mission system |
| `controls` | Low-emphasis control hint | Actual input mapping; never invent WASD or touch controls |
| `slot` | Styled empty container | Mount an existing minimap, chart or custom view in `elements[id]`; caller owns rendering/disposal |

## Decision feedback

Supply the information play requires and connect controls to game-owned actions. A `notice` plus an
`actions` button can expose a terminal outcome and restart; preserve that action owner through UI changes.

| Type | Presentation | Applicability / skip |
| --- | --- | --- |
| `metric` | Numeric/text readout | Existing moves, score, turns, time or any displayed value; no assumed metric |
| `meter` | Label, readout, bounded progress | State adds numeric `value` and positive `max`; omit for unbounded/discrete values |
| `notice` | Compact polite live text | Existing event messages; scheduling/expiry stay caller-owned |
| `actions` | Button group | Discrete existing actions only; callbacks receive `{component,event}` |
| `tracker` | Discrete marks plus a readout | Existing counted goals such as wards, stars or stages; construction `count` is 1..12 (default 2); `value` is how many marks are filled; skip unbounded scores |

```js
import { createGameUI } from '/assets/user-interface/GameUiFactory.js';
const ui = createGameUI({
  components: [
    { id: 'progress', type: 'metric', label: 'Moves', dock: 'top-right' }
  ],
  state: { progress: { value: 0 } }
});
// Call from the existing state writer/event path; no new timer or RAF loop.
ui.update({ progress: { value: moves } });
```

Action `buttons: [{id, label, kind?}]` dispatch existing `actions[id]`; missing callbacks disable
buttons. Passive panels pass pointer input through, and buttons stop bubbling pointer/key events.
Games using capture listeners must guard UI targets themselves. The factory does not pause
simulation, clear held keys or manage pointer lock; these remain game-owned.
Continuous touch/hold input uses the existing controller and adaptation/slots, not click buttons.
Use existing WorldAnchorLabel/MinimapProjector2D when needed; projection is not reimplemented.

## Delivery presentation

Compose final hierarchy and styling around the retained state and action owners. Use create/custom
composition for temporary state dumps, or recompose their markup before adapting. Adapt suits
markup that already separates information by purpose.

| Type | Presentation | Applicability / skip |
| --- | --- | --- |
| `brand` | Title, eyebrow, subtitle | Optional identity; omit if screen space is needed for play |
| `dialog` | Result/pause/choice card with optional icon and stats | Existing transitions only; variants and buttons described below. Skip a campaign or stage picker |
| `banner` | Centered live title over the play view | Existing phase/intro/alert copy; skip if a corner `notice` is enough |

Dialogs and banners start hidden and require `visible: true`; banners default to the `center` dock.
Reuse dark teal panels, cream text and gold accents when that style fits; override the theme for
another requested direction.

Theme keys: `panel`, `raised`, `border`, `text`, `muted`, `accent`, `danger`, `radius`, `font`,
`displayFont`, `numericFont` (CSS strings). `font` covers general text/buttons; `displayFont` covers
brand titles; `numericFont` covers metrics, meters and result statistics. Labels and hints have lower
emphasis. Override scoped CSS for another hierarchy or placements such as a centered timer;
the built-in docks are conveniences, not limits on the information design.
Center docks size to their content so a phase banner does not cover the corner HUD.
`DEFAULT_UI_THEME` and `GAME_UI_TYPES` are immutable exports. Components can repeat a type with
independent IDs. No fixed list of components is required, including for unfamiliar/hybrid games.

One visible dialog traps Tab and restores prior focus when hidden/disposed. Show one modal at a
time. Preserve the existing game's input, pause, restart and pointer-lock behavior; the factory
does not bind Escape or install document input handlers. Test changed integration.

### Reusable result and pause cards

The `dialog` is a reusable result-card composition: a dimmed, blurred scene, centered card with a
top accent, small kicker, status icon, large title, reason, optional statistics and clear action
hierarchy. It uses CSS and text; no game-specific screenshot or image is required. Populate the
statistics and wording only from the current game's verified state; omit fields that do not apply.

- Component `variant` accepts `neutral` (default), `success`, `failure` or `paused`. A display-state
  `variant` overrides it for that update; omission restores the component default. Success uses the
  theme accent, failure uses `danger`, and pause uses `muted`; titles/reasons distinguish states as well.
- Display `label` is the kicker, `value` the title, and `text` the reason/instruction. Defaults for
  `icon` are empty, `↗`, `×`, `Ⅱ` respectively. Supply another text symbol or `icon: ''` to omit it;
  icons are decorative and hidden from assistive technology.
- Display `stats: [{label, value}]` renders a responsive statistics strip; values stay caller-owned.
  Omitting it or passing `[]` removes prior stats. Text is escaped as text, not inserted as HTML.
- Dialog/action `buttons: [{id, label, kind?}]` dispatch existing `actions[id]`. `kind` is `primary`
  (the default) or `secondary`. Choose one main action and mark alternatives secondary.
  Missing callbacks disable buttons. Different action sets can use separate hidden dialog components.

For a game with verified pause and terminal states, compose both screens and show one at a time:

```js
const ui = createGameUI({
  components: [
    { id: 'result', type: 'dialog', label: 'Round result',
      buttons: [{ id: 'restart', label: 'Play again' }] },
    { id: 'pause', type: 'dialog', variant: 'paused', label: 'Paused',
      buttons: [{ id: 'resume', label: 'Continue' },
                { id: 'restart', label: 'Start over', kind: 'secondary' }] }
  ],
  actions: { restart: () => existingRestart(), resume: () => existingResume() }
});
// The existing view/event path supplies these display values from real state.
function renderRoundUI({ ended, won, paused, title, reason, stats }) {
  ui.update({
    result: { visible: ended, variant: won ? 'success' : 'failure',
      label: won ? 'Run complete' : 'Run ended', value: title, text: reason, stats },
    pause: { visible: paused && !ended, value: 'Paused', text: 'Continue when ready.' }
  });
}
```

When migrating an existing `RoundOutcomeOverlay`, preserve its terminal latch, `scaleDelta`,
restart and pointer-lock behavior. Recompose/adapt its owned markup, or deliberately replace its
view while retaining those behavior paths. Do not leave two full-screen overlays/listener owners,
or call `hide()` merely to conceal old DOM: that method also resumes its simulation delta.
Replacing these paths requires a targeted integration check; the factory itself does not freeze play.

### Create/adapt script

```sh
python <skill-root>/forge/ui.py create --project-root <output> --run runs/step3/ui \
  --config /path/to/ui-config.json --fixtures /path/to/ui-fixtures.json
# For existing markup, use adapt with selector config instead of create.
```

`--dry-run` validates config and lists planned files. Conflicts fail before writes; identical
inputs are reusable. Afterwards edit the generated config/view directly. The script adds a
stylesheet link to index.html. Create emits `ui/view.js` with `mountUI({state, actions, mount})`:
import it and connect the existing view-update path once. It does not guess gameplay bindings.
For create, the config is the factory's `{theme?, components}` object; fixtures are named states:

```json
[
  {"name":"normal","state":{"progress":{"value":4},"outcome":{"visible":false}}},
  {"name":"ended","state":{"progress":{"value":7},"outcome":{"visible":true,"value":"Complete","text":"Existing outcome reason"}}}
]
```

Derive fixtures from verified displayed values: running, each applicable pause/win/loss/choice
state, long labels and meaningful boundaries such as low health or zero ammo. Do not invent
mechanics or add unsupported screens merely to exercise every component.

For adapt, specify existing roots and semantic roles:

```json
{"roots":["#hud","#overlay"],"roles":{"metric":["#score"],"dialog":["#overlay"],"card":[".result-card"],"button":["#restart"]}}
```

Adapt injects `ui/adapt.js` and applies classes/theme variables without replacing nodes, text,
IDs, listeners or the gameplay loop. Invalid selectors roll back decoration. `adaptGameUI(config,
document?)` returns `{roots, dispose()}` that restores owned classes/variables. Root selectors must
identify UI layers, not the canvas or whole body. Existing layout/CSS may need scoped overrides;
inspect the resulting view and pointer behavior. DOM created asynchronously needs an explicit call
to `adaptGameUI` after it exists instead of the automatic script tag.

Adapt fixtures use `dom` instead of state, for example
`{"name":"ended","dom":{"#overlay":{"hidden":false},"#result":{"text":"Complete"}}}`.
The preview retains inert HTML/CSS and strips game scripts. Dynamic DOM needs a small static fixture
or a custom isolated view. Keep fixtures, preview and view glue in `ui/`; never import simulation
there. `ui/preview.html` exposes `window.__uiPreview = {cases, show(index), mode, actions}`; the
checker uses that contract, so custom layouts can substitute an equivalent fixture renderer.
For a custom view without factory classes, set `mode: 'custom'` and, for example,
`selectors: {roots: '#interface', components: '.readout, button', passive: '.readout'}` on
`__uiPreview`. Select the actual layout elements to check; `passive` names input-transparent
surfaces and may be empty when none apply. Button focus is checked inside the selected roots;
custom action behavior needs its own affected check only when that wiring changes.

## Verify and record

Follow [acceptance](../../grimoire/build/step3-acceptance.md) for integrated input and UI checks.
Inspect screenshots for grouping, typography, state screens and placement over the actual game.
Optional fixture previews test the 960x640 desktop play view; do not add a phone-size review. Factory stub callbacks prove button dispatch only; acceptance verifies real
state updates and restart. Static interface composition may be reused from Stage 1.

| Symptom | Cause | Remedy |
| --- | --- | --- |
| Polished overlay changes play | Input, pause or simulation ownership moved into UI | Restore the existing action/state path; check only the affected transition |
| Components overlap or cover the play area | Too many panels in the selected docks or long content | Omit irrelevant panels, change docking/scoped CSS, inspect representative fixtures at 960x640 |
| A custom HUD reimplements banners or counted goals | The brief needed a phase title or discrete progress the factory already presents | Use `banner` / `tracker` (and a `meter` for a bounded boss/health bar) instead of a one-off overlay |
| Final UI is still a debug text block | Adapt preserved temporary information structure | Map real values by purpose, split writers and create/recompose appropriate views; check the real update path |
| Adapt preview has no matching nodes | Original UI is created by game code | Supply inert representative markup, or use create/custom fixture rendering |
| Key press also moves the player | Gameplay capture listener sees UI input first | Keep existing UI-target guard/input ownership and test the changed wiring |
