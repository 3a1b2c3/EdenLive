# Stage 0: Preserve the idea in a brief

Outcome: a validated brief with concrete outcomes and enough context for all later stages.
Use when turning a new gameplay idea into a bounded prototype.

## Workflow

Read the [scope boundary](scope.md) and the [shared contract](../review/shared-contract.md) once.
If the defining mechanic is outside scope, stop here: do not generate a brief and do not initialize
a project. For an in-scope request, start with
`python <skill-root>/forge/validate_game_brief.py --starter --output /path/to/brief.json`; it creates
a new file without overwriting one. `--help` lists control and modality enums. Open only the relevant section of
`docs/specs/game-brief.schema.json` if validation errors leave a field unclear.
Choose the [standalone output root](../build/standalone-project.md) before changing directories:
use the user's path or the agent's starting working directory. Write `brief.json` there, validate it,
then initialize; keep all later artifacts in the same project.

1. Identify repeated player actions, automatic responses, win/loss conditions and the bounded
   prototype slice. Preserve signature mechanics and explicit values. Infer routine missing details
   in `context.assumptions`; ask only when an unresolved choice changes the core game or scope.
2. Use the [exemplar index](exemplars.md) to read at most one or two nearby briefs when useful.
   Examples calibrate format, not design. A hybrid is a valid composition, not inherently ambiguous.
   With no close exemplar, derive actions, state transitions and outcomes directly from the idea.
3. Write the brief. `control_scheme` is a discovery hint (`custom` if none fits); `player_modality`
   describes the primary interaction, not every capability. Record the concrete subjects in
   `scene.theme_elements`: actors/opponents, environment/backdrop, mechanisms, hazards, resources,
   goals and interface/board elements. Give each a stable `id`, `label` and `role`; optional `source`
   and `visual_hint` explain its origin and appearance. Reconcile scene description, fantasy,
   interaction tags and explicit counts; do not omit a subject just because it has no gameplay tag.
   Group repeated decorations when useful, but keep distinct gameplay roles identifiable. Invisible
   rules can bind to their visible cue or owning object; they need no invented decorative object.
   Stage 1 maps this inventory to scene objects; Stage 2 records controllers, capability checks and
   the outcome/restart rules that close the loop.
4. Carry all meaningful intent into `context.distilled_prompt`, `twists`, `assumptions` and
   `open_questions`. Do not discard contradictory requirements by choosing the closest example.
   Later stages resolve open questions before implementing the dependent behavior.

### Field decisions

- `core_verb` can be a connected sequence, such as carry/process/serve, or an action that controls
  automation. Do not invent manual firing for automatic weapons or walking for a menu game.
- `win_state` and `fail_state` name reachable terminal states. Include phase prerequisites and
  expiry/tie behavior where relevant. If two terminal conditions can become true in one simulation
  step, record their precedence and stable `outcomeReason` in `context.assumptions` or
  `open_questions`; never let the implementation choose silently. Both terminal outcomes are a product boundary. If the
  defining loop has no win or loss, apply the scope boundary rather than inventing one.
- `time_budget_seconds` is the simulation-time allowance for each validation scenario (30..300),
  including every in-round phase, not a gameplay deadline or the sum of all scenarios. Actual
  execution has a separate wall-clock limit; see [validation budgets](../review/playthrough-contract.md#validation-budgets).
  Preserve actual game-clock rules separately; untimed play may wait for a player indefinitely.
  If the requested round can exceed the normal wall-clock bound, record the manual actual-input
  evidence route during intake; do not shorten the requested timer, wave count or phase sequence.
- `interaction_tags` identify semantic objects or events by stable `id`, `role` and `meaning`.
  Noncollision actions are valid; physical markers are optional. See
  [interaction semantics](../patterns/interaction-tags.md) only when needed.
- `control_scheme` and `player_modality` are discovery hints, not complete capability declarations.
  When they conflict with a route, menu, or fixed-encounter description, preserve both requirements
  in `open_questions` and resolve the scope before implementation; never discard movement or
  interaction merely because the primary modality label is narrower.
- `ui.mode` is `polish` by default; set `none` only for an explicit no-UI request and record it in
  `ui.reason`. Optional `ui.style` preserves the requested aesthetic; compose final UI in Stage 3
  for a desktop browser view. Do not record a phone layout, touch overlay or gamepad mapping as an
  assumption. A menu or board that is itself the game still sits in the 3D scene.
- Prototypes are silent, keyboard/mouse, and one 3D modeled scene in one continuous round. Do not
  add audio, music, sound-effect or haptic assets. If the request's defining mechanic needs
  generated audio, vibration, a gamepad, joystick, trackpad or touch surface, or cannot be presented
  as a 3D modeled scene, it is out of [scope](scope.md). Visible timing cues remain valid. Keyboard
  and mouse/pointer are the input; do not author a stick or touch layout. Choose a single-round
  campaign slice under the [scope boundary](scope.md); resolve explicit independent-stage
  requirements before proceeding. Waves, rooms, phases and a boss may advance inside that round.
- `scene.description` covers a 3D world, tabletop or fixed backdrop; keep UI intent in `ui.style`.
  Describe relevant elements and preserve the requested setting and actors without prescribing
  coordinates or a decorative quota. Stage 1 composes them with fitting factories or intentional
  3D geometry, Stage 2 wires their behavior and closes the playable loop, and Stage 3 completes
  presentation and binds final UI to that existing state. Intake records intent without loading
  every factory API.

## Verify and record

The starter includes all required fields and the theme-element structure. Fill the blank intent
values from the request and expand the inventory before validation; defaults remain editable.
Derive the verb, modality, scene and outcomes from the request.

Compare the brief with the request for semantic fidelity. For game builds, initialize after the
brief validates, then use [stage closeout](../review/gates.md#stage-closeout): it reuses matching
`scaffold init` schema evidence, reruns validation if the brief changed, and records your intent
review before advancing. `init` leaves intake `in_progress`; schema evidence is not an intent pass.
For brief-only tasks or manual setup, run
`python <skill-root>/forge/validate_game_brief.py <brief>` and retain its
output with the brief and review. Schema validity alone does not establish fidelity or solvability.
