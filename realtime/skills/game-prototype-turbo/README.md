# game-prototype-turbo

A skill for building bounded, browser-playable game prototypes from gameplay ideas.
The product requires reachable win and loss states in one silent desktop keyboard/mouse 3D round.
Games whose defining loop lacks either terminal outcome are outside scope.
The workflow parses the prompt and its theme inventory, builds the complete static scene with
reusable factories, builds the complete playable loop, then finishes presentation and proves the
whole game. The three build artifacts are `step1` (scene), `step2` (behavior), and `step3`
(acceptance). Each receives its own focused check and human review. Behavior proves its loop closes
through a bounded `closure` playthrough; final acceptance proves real-input
win/loss/restart with the finished UI and launches a relocated standalone project through its copied
`serve_step.py`.
Boards, menus and fixed encounters still need a 3D modeled scene; they do not require an avatar
or physics. HUD and command overlays sit on that scene. Functional feedback, outcomes and restart
belong with behavior; final UI composition and its integration repairs belong with acceptance.
Bespoke polished art production, generated audio, haptics, gamepad or touch-only play,
2D-only or DOM/canvas2d play surfaces, and production-ready game delivery are outside scope.
Prototypes play as one continuous round: in-round waves or a boss after clearing enemies are
fine; a level-select of independent stages is not.

Start with [SKILL.md](SKILL.md). Read the current stage and only its applicable references.
Stage IDs, gate commands, the refinement cap and timeouts live in `forge/_shared/constants.py`.
Data shapes live in `docs/specs/`. Flag behavior is each tool's `--help`. A project's live paths
and commands come from [task_packet.py](forge/task_packet.py). SKILL.md routes; `grimoire/`
teaches the current stage; this README navigates.

## Design principles

- **Clear promise and activation.** State the playable outcome, concrete use cases and scope limits;
  distinguish implemented capabilities from examples and future work.
- **Preserve the requested game.** Infer routine details, retain signature actions and explicit values,
  and ask only about choices that materially change intent or scope.
- **Keep context small.** Use a thin entrypoint and progressive disclosure; include instructions that
  change decisions, with the detail and rigidity warranted by the risk. Route by stage before opening
  capability references; select scene factories in Stage 1, behavior and decision-feedback references
  in Stage 2, and delivery presentation in Stage 3. Route UI by purpose, not by directory.
- **Route by capability.** Combine applicable controls, rules and presentation patterns; examples and
  available assets guide implementation without imposing one genre's checklist.
- **Make references easy to use.** Give procedural guides an outcome, use trigger, workflow and
  verification; put symptom → cause → remedy guidance near likely failures.
- **Explain composition when useful.** Name system ownership, real tuning knobs and their effects
  when the prototype needs them; keep simple games simple.
- **Separate judgment from mechanics.** Route knowledge through references, automate repeated
  deterministic work, and enforce shared data contracts with schemas and validators.
- **Build and verify progressively.** Inspect before editing; run cheap checks before browser review
  and keep examples, APIs and dependency versions consistent. Verify complete static composition,
  then the playable loop through real input, then final presentation, full replay and delivery.
  Reuse matching evidence; avoid universal physics probes and duplicate round harnesses.
- **Correct causes within a bound.** Distinguish specification errors from implementation errors;
  record the correction and recheck, with at most three refinement rounds per stage or revision.
- **Keep evidence recoverable and honest.** Persist state and artifact history; distinguish function,
  experience and performance, retain failed input paths for repair, and never count an unevaluated
  check as passed or a saved replay recipe as a confirmed reproduction.
- **Test behavior and define completion.** Use focused regressions for meaningful changes and a
  pre-ship checklist covering actual controls, outcomes, restart, readability and handoff.
- **Deliver an independent project.** Use the user's output directory, copy only needed runtime
  assets, install pinned local dependencies and verify the delivered project's own launch path.

## Structure

| Location | Purpose |
| --- | --- |
| `grimoire/intake/` | Scope, brief construction and a router across 24 reference briefs |
| `grimoire/build/` | Three stage prompts, conditional control guidance and revisions |
| `grimoire/review/` | Capability routing, executable contracts and review questions |
| `grimoire/patterns/` | Optional patterns with explicit applicability and skip conditions |
| `assets/summary.md` | Stage-aware router to focused module catalogs |
| `assets/template/` | Static renderer, selectable discrete/fixed game loop, gameplay owner and output launcher |
| `assets/game-briefs/` | Reference briefs for capability routing and scaffold regression coverage |
| `assets/examples/` | Runnable component demonstrations only, not example games |
| `forge/` | Standalone scaffolding, validators, state routing, browser/rules checks and regression tests |
| `docs/api/` | Factory contribution guidance, APIs, options and runtime entrypoints |
| `docs/specs/` | Brief, run-card, state, attempt and factory-manifest JSON Schemas |
| `grimoire/review/recovery-and-manifest.md` | Short resume route, hash-bound attempts and optional factory manifest |

The workflow routes by capabilities rather than assigning a fixed checklist to each genre.
For example, menus need selection/confirmation checks; automatic motion needs steering/timing
checks; neither implies WASD, a stop action, a chase camera or hostile agents. Hybrids combine
capabilities and verify transitions. Missing modules use a small custom implementation; unfamiliar
mechanics have an explicit fallback in the [capability matrix](grimoire/review/capability-matrix.md).
A custom 3D setting or a locomotion/combat/resource rewrite records the catalog candidate it
considered. The behavior gate proves a matching import from the run page, not from the card
`modules` list. Geometric simplicity is review prose, not an automated mesh count. The template pins
the play canvas to `#app`; checkers open the page at devicePixelRatio 2. Conditional camera pairings are covered in [behavior](grimoire/build/step2-behavior.md).

## Reusable asset factories

New builds select fitting factories in Stage 1 through [world foundations](assets/catalogs/world.md)
and the [visual catalog](assets/catalogs/world-visuals.md). Assemble actors, environment and
mechanisms once; Stage 2 wires existing control ports and closes the playable loop, and Stage 3
completes presentation.
Retain intentional simple shapes such as balls, crates and abstract tiles; fixed/menu input can
still control depicted people or animals that need refinement. When a brief role has no catalog
factory and still needs 3D structure, represent it with GreyboxKit or Three.js primitives so
silhouette, color and scale carry the role. Do not import GLTF/FBX/OBJ packs or author dense custom
meshes as a substitute. A factory supplies an asset; the
game owns input, movement, collision and rules. The parameterized scene visuals are simplified
geometric variants: recognizable silhouettes, condensed parameter surfaces, color blocks and
procedural motion. Each exposes named presets, a seeded option helper, frozen resolved options,
local rest bounds, stats and idempotent disposal. Named-action factories share
`setPose(action, seconds)` and `reset()`. Seconds are supplied by the game relative to the
action's start. Read the selected API for which families also publish `actions` or `motions`,
and for static exceptions:

| Factory | Use when | API |
| --- | --- | --- |
| CharacterVisualFactory | Reusable simplified bodies, interchangeable left/right equipment and idle/walk/run locomotion fit the game | [Character](docs/api/character-visual-factory.md) |
| EquipmentVisualFactory | Standalone or held weapons, shields and profession tools need their own shapes, grips and actions | [Equipment](docs/api/equipment-visual-factory.md) |
| FantasyCreatureVisualFactory | Dragons, undead, slimes, monsters or elementals need anatomy-specific motion and shared attack/death actions | [Fantasy creatures](docs/api/fantasy-creature-visual-factory.md) |
| PickupVisualFactory | Currency, resources, food, keys and quest items need grouped layouts and collection presentation | [Pickups](docs/api/pickup-visual-factory.md) |
| MechanismVisualFactory | Switches, hazards, platforms or gates need visible states, transitions and working-part mounts | [Mechanisms](docs/api/mechanism-visual-factory.md) |
| QuadrupedVisualFactory | Four-legged animals need gait, pounce, charge and death | [Quadruped](docs/api/quadruped-visual-factory.md) |
| BirdVisualFactory | Birds need flap, swoop, charge and death; game owns flight | [Bird](docs/api/bird-visual-factory.md) |
| FishVisualFactory | Fish, cetaceans or jellyfish need swim, lunge and death; game owns movement | [Fish](docs/api/fish-visual-factory.md) |
| TrainVisualFactory | Straight train consists with configurable cars and still/roll wheel motion fit the game | [Train](docs/api/train-visual-factory.md) |
| HouseVisualFactory | Rural houses with configurable layout, roof and porch fit the game; static | [House](docs/api/house-visual-factory.md) |
| BuildingVisualFactory | City buildings with configurable massing, facade and rooftop fit the game; static | [Building](docs/api/building-visual-factory.md) |
| TreeVisualFactory | Trees or shrubs with preset crowns and optional wind sway fit the game | [Tree](docs/api/tree-visual-factory.md) |
| RockVisualFactory | Grounded rocks, ridges, craters and crystal clusters need simplified silhouettes and short named motions | [Rock](docs/api/rock-visual-factory.md) |
| VehicleVisualFactory | Road vehicles need distance-driven wheels with construction-time steering | [Vehicle](docs/api/vehicle-visual-factory.md) |
| AircraftVisualFactory | Aircraft need rotors, hinged control surfaces, retractable gear or weapon presentation | [Aircraft](docs/api/aircraft-visual-factory.md) |

Not every asset module follows that profile. [GrassVisualFactory](docs/api/grass-visual-factory.md)
is a shared-resource helper: it returns a bare blade mesh plus a geometry and material the caller owns
and disposes, because a field of hundreds of blades wants one shared pair rather than one owned
instance per blade. Check the selected API before assuming a profile.

For integration, read the selected API and [factory composition](grimoire/patterns/parameterized-visual-factory.md).
For contributions, use the [factory contract](docs/api/asset-factory-contract.md) for ownership,
discovery, interface choices and verification. Keep specialized guidance there; a routine factory
addition needs its runtime files, API/catalog entry and applicable behavior checks. Use public
factory entrypoints and shared action/option contracts; add adapters for an actual consumer need.
Character silhouette and equipment are independent: choose a body preset, supply
`loadout: { right: { preset: 'bow' }, left: null }`, then sample `right:draw` or `right:loose`.
Equipment actions are discovered from the current loadout and respect support-hand availability.

Copy only the selected public entrypoints into the generated project; shared motion, equipment
and primitive helpers follow automatically:

```sh
python <skill-root>/forge/scaffold.py assets --project-root /path/to/game --asset assets/world/object/factory/CharacterVisualFactory.js --asset assets/world/object/factory/MechanismVisualFactory.js
```

The standalone copier preserves relative imports and records the copied dependency closure.
Factory runtimes use the project's pinned Three.js package and have no dependency on the preview UI.

The [factory preview](assets/examples/factory-preview/index.html) lets you inspect presets, seeded
variation, shape edits and animation. From this repository root:

```sh
npm ci
python forge/serve_step.py --runs assets/examples
# Open http://127.0.0.1:8017/assets/examples/factory-preview/
```

The preview provides component evidence. Generated games still follow standalone delivery and
verify their actual gameplay through the applicable stage gates.

Acceptance uses [GameUiFactory and its DOM adapter](docs/api/game-ui-factory.md) for configurable
dark teal panels, readouts, resource bars, notices, phase banners, counted-goal trackers and
controls, plus reusable result/pause cards with state variants, icons, statistics and button
hierarchy. Create/recompose temporary state dumps; adapt existing purposeful markup. Compose for a
desktop 960x640 play view; skip phone breakpoints, touch overlays and gamepad mappings.
Keep the delivered game silent, keyboard/mouse, and skip a level-select of independent stages.
`forge/ui.py create|adapt` copies
only the UI runtime closure and generates isolated display fixtures. Existing state/actions remain
owned by the game; omitted capabilities create no UI. [Acceptance](grimoire/build/step3-acceptance.md)
documents the integrated UI review and lightweight evidence checks. `forge/check_ui.py` supplies
Python helper APIs for `forge/ui.py` fixtures and integrated acceptance; it has no standalone CLI.

## Generated project

Create the standalone project at the user's explicit path, or in the working directory where the
agent was started when no path was given. Resolve a relative output path against that starting
directory. The skill installation supplies references and tools; generated games live in the chosen
output directory. See [standalone project setup](grimoire/build/standalone-project.md) for the copy,
dependency and verification contract.

For a new request, read the [intake scope](grimoire/intake/scope.md) first. Create a draft
containing every required key, fill its intent fields, then validate. `--help` lists the
control and player-modality choices; `--output` refuses to overwrite a file:

```sh
python <skill-root>/forge/validate_game_brief.py --starter --output /path/to/brief.json
python <skill-root>/forge/validate_game_brief.py /path/to/brief.json
```

Initialize only after that brief is in scope and schema-valid. From this skill checkout:

```sh
python <skill-root>/forge/scaffold.py init --project-root /path/to/game --name scene --brief /path/to/brief.json
python <skill-root>/forge/scaffold.py assets --project-root /path/to/game --asset assets/math/RandomUtils.js
# After finishing the current stage's edits:
python <skill-root>/forge/next.py /path/to/game/.state.json --task-packet
python <skill-root>/forge/finish.py --project-root /path/to/game --check
# Inspect evidence and fill the review template printed by --check:
python <skill-root>/forge/finish.py --project-root /path/to/game --review <printed-review-path>
```

The current task packet from
`python <skill-root>/forge/next.py /path/to/game/.state.json --task-packet` prints
real artifact paths, selected capabilities/modules, gate commands and closeout
conditions. Prefer that packet over handwritten gate argv. It avoids loading the full catalog and schema when the current stage does not need them.
Revisions and completed stages route to their own workflow; a loop cap suppresses further gate commands
and returns exit code 3. An explicit no-UI brief still runs acceptance; it simply does not require
an additional UI surface beyond the game view.

`init` installs pinned local dependencies and copies a launchable skeleton with no invented player
controls or win/loss rules. It records schema evidence and leaves intake `in_progress`; the agent still reviews intent before marking
intake passed. Assemble the complete static scene before passing scene, then implement applicable
behavior before passing behavior. `assets` follows
literal runtime references and records copied file hashes; computed references need explicit files
and a review note. Conflicting files are preserved. `finish` runs the stage's canonical gates,
generates factual records and accepts an explicit review before advancing with source provenance
and no inherited pass. Submission reuses the unchanged check batch; it does not rerun gates.
Behavior and acceptance use `--strategy` for their respective playthrough scopes; acceptance also
includes relocation. See [stage closeout](grimoire/review/gates.md#stage-closeout)
for review fields, skips and the low-level route for custom evidence, revisions and recovery.

```text
<output>/
├── assets/                 # only required runtime assets and their dependencies
├── node_modules/           # installed by npm
├── package.json
├── package-lock.json
├── runs/
│   ├── step1/<name>/        # index.html, main.js, game.mjs, step1.json; later evidence
│   ├── step2/<name>/
│   └── step3/<name>/        # final UI, presentation and acceptance evidence
├── serve_step.py            # copied from the skill's forge/serve_step.py
├── launch.sh               # copied from assets/template/launch.sh
├── brief.json
├── evidence/               # intake evidence; stage evidence stays with each run
└── .state.json
```

From the output root, use `./launch.sh step1` for the static scene, `./launch.sh step2` for behavior,
or `./launch.sh` for the latest populated artifact (normally `step3`). Select a stage explicitly
with `./launch.sh step3`.
The launcher also works when invoked from another directory. The project requires Python 3.10+;
`npm ci` restores its locked dependencies after moving it or removing `node_modules/`.
Serving and play use the project's own files and require no installed skill.

## Repository checks

Use Python 3.10+ with `python3 -m pip install -r requirements.txt`. Makefile defaults to `python3`;
select another installed interpreter with `make PYTHON=/path/to/python`. JavaScript tools require
Node with `module.registerHooks` (22.15+, 23.5+, or 24+) and `npm ci` for test dependencies.
Three.js is pinned to 0.161.0; the browser template optionally supports Rapier 0.14.0.
This repository's Node manifest is for development. Each generated project has its own runtime
manifest and lockfile; its import map resolves `/vendor/` to its local npm dependencies.

```sh
make lint
make test-js
make test-py
```

`make lint` runs [Markdown link validation](forge/validate_md.py) and factory catalog drift checks.
Stage 1's [scene checker](forge/check_step1.py) and Stage 2's behavior checker both use `--output`
for their reports and screenshots. Strategy and condition drafts have
[offline preflight commands](grimoire/review/playthrough-contract.md#strategy-authoring).

`make test-py` runs the Python suite, including browser cases when their dependencies are available.
Missing Playwright, Chromium or local Three.js causes those cases to skip. For a browser-free run,
use `python3 -m pytest forge/tests -q -m "not slow"`. Install the optional browser dependencies and
require the browser suite with:

```sh
python3 -m pip install -r requirements-browser.txt
python3 -m playwright install chromium
npm ci
make test-browser
```

Use the same Python interpreter for installation and tests. `GBDATA_CHROMIUM` can select an existing
Chromium executable. `make test-browser` fails if any required browser dependency is unavailable;
a skipped optional suite does not establish browser coverage.

`make` runs repository checks without discovering generated games. Gate commands require the
actual run/evidence paths; see [acceptance and evidence](grimoire/review/gates.md). For example:

```sh
python <skill-root>/forge/serve_step.py --project-root <output> --runs runs/step3
python <skill-root>/forge/check_step2.py --project-root <output> --runs runs/step2 --only <run> --output evidence/<run>
python <skill-root>/forge/check_step3.py --scope closure --project-root <output> --runs runs/step2 --only <run> --strategy runs/step2/<run>/strategy.json --output evidence/<run>
python <skill-root>/forge/check_step3.py --project-root <output> --runs runs/step3 --only <run> --strategy runs/step3/<run>/strategy.json --output evidence/<run>
```

Substitute the game's own run name. For an external project, pass `--project-root <output>`
to the server, browser/rules checkers and optional probe; their run paths then resolve under that
root. `/assets/` and `/vendor/` use that project's files. The server's CDN fallback is a preview
convenience, not a substitute for installing standalone dependencies. Validators stay in the skill
checkout and receive explicit artifact paths; tests use their own isolated fixtures.

## Verification boundaries

- Stage 1 (`scene`) checks local boot, scene/camera framing, resource loads and a manifest that covers
  every declared `theme_elements` entry. It samples the scene while idle, so actors, mechanisms
  and boards must be static. It does not claim input, rules or outcomes.
- Stage 2 (`behavior`) checks declared capability/signature coverage and drives the real keyboard or
  pointer inputs in the retained scene. Each applicable control must produce a persistent state
  change; unsupported capabilities are recorded as inapplicable rather than invented. This stage
  may include camera, movement, aiming, navigation, animation, collision and local interactions.
  It then runs a `closure` playthrough through the same executor Stage 3 uses: one representative
  terminal outcome, a real same-page restart and a fresh round that still accepts effective input.
  Both terminal branches must be implemented, but only one is exercised, so the other branch and
  the final-UI integration remain unevaluated at this stage.
- Stage 3 (`acceptance`) checks boot and the template's fatal error panel, then executes a per-game keyboard/pointer
  strategy for win, loss, restart and replay and rechecks the panel before reporting success. A
  `closure` pass does not substitute for it: the finished UI can change focus, click targets and
  input delivery, so the full sequence runs again with that UI integrated. An
  unsupported input needs an equivalent input-only driver or recorded manual evidence. It does
  not plan a strategy, judge fun or certify hardware performance.
  Its scheduler shares one observation per decision and sends only held-key changes. Actions that
  depend on a newly changed state run after the next observation. Terminal, interaction, restart
  and browser-error requirements remain mandatory.
  Failures retain partial input/event evidence, start/reset observations, a strategy copy and retry
  settings, even when observation or restart throws. The [failure repair route](grimoire/review/playthrough-contract.md#failure-reproduction-and-repair)
  reuses the existing report and refinement record. Source hashes identify versions without archiving
  them; replay repeats the input strategy and does not guarantee deterministic browser execution.
- The acceptance batch binds reports and source hashes, verifies real win/loss/restart/replay and
  integrated UI (or the explicit no-UI reason) with `check_step3.py`, then verifies relocation through
  the copied launcher with `run_project.py --relocate`. Isolated fixtures created through `forge/ui.py`
  may supplement a focused layout review; they never substitute for integrated play.
  Information hierarchy and aesthetic judgment remain manual. See [acceptance workflow](grimoire/build/step3-acceptance.md).
- Resource boundaries and presentation quality require the [manual stage review](grimoire/review/gates.md#stage-outcomes):
  static theme coverage in scene, applicable behavior in step2, and state-driven UI/outcomes through
  acceptance. Automated gates do not certify agent reading choices or art detail.
- `finish.py` runs gates, binds their reports to current inputs, records explicit review assessments
  and advances without separate state-tool calls. It rejects stale batches and preserves failed
  attempts; it does not judge experience or turn performance samples into a target pass.
  Low-level state tools validate stage order and evidence records and route the next action; `done` requires
  all stages to be passed. Passed scene, behavior and acceptance records require
  functional, experience and performance assessments. The tools do not verify recorded evidence's truth.
  Revisions retain previous evidence and require new checks for the changed artifact.

The 24 briefs support example selection and scaffold/schema regression coverage. They do not
establish 24 end-to-end game implementations.

During continuous generation, reuse documents already in context. After interruption or context
loss, use the [recovery route](grimoire/review/recovery-and-manifest.md) to revalidate current evidence
and open only missing references. Derive run-card capabilities from the actual brief; absent
mechanics are `not_applicable`, while missing applicable observations are `not_evaluated`.
