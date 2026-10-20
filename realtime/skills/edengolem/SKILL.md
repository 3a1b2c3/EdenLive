---
name: edengolem
description: "Build or revise standalone Three.js browser game prototypes with a silent desktop keyboard/mouse 3D scene, one continuous round, and reachable win and loss states. Use for bounded playable game requests within those limits; not 2D-only, audio-led, or open-ended games without both terminal outcomes."
---

# EdenGolem（v0.1）

The final project includes `serve_step.py` and `launch.sh` in a copied output directory. It does not promise production art or a full commercial game.

Stage IDs, gate commands, the refinement cap and timeouts live in `forge/_shared/constants.py`. Data shapes live in `docs/specs/`. Flag behavior is each tool's `--help`. A project's live paths and commands come from `forge/task_packet.py` through `forge/next.py`. This file routes; `grimoire/` teaches the current stage; `README.md` navigates.

## Start or resume

Authoring tools stay in the skill checkout. Generated projects have no `forge/`, so `python forge/...` from the output directory will not work. Pass `--project-root <output>` and take live commands from the task packet; handwritten examples only show the convention.

Choose the workflow before editing:

- **New game:** follow intake below.
- **Unfinished game:** read `<output>/.state.json` and request its current packet with `python <skill-root>/forge/next.py <output>/.state.json --task-packet`.
- **Change a passed game:** use [revisions](grimoire/build/revisions.md), including when the packet reports `complete`. Start a revision before changing the retained artifact; ordinary stage closeout does not handle revisions.

For a new request, read the [intake scope boundary](grimoire/intake/scope.md) and [intake prompt](grimoire/intake/01-parse-prompt.md) first. If the defining mechanic is outside scope, stop intake, record the blocker, and do not generate a brief.

For an in-scope request, write and validate the brief, then initialize the standalone project ([setup](grimoire/build/standalone-project.md)). Initialization creates an intake-in-progress state and schema-only evidence; it does not pass intake. Complete the intent review before advancing to scene.

There is no `unresolved` or `skipped` stage status. Before initialization, an out-of-scope request has no project state. After initialization, a blocked intake stays `in_progress` with a recovery note or evidence; never record `passed`.

## Stages

The pipeline has one intake phase and three build stages.

| Stage | Prompt and contracts | Deliverable | Automatic checks | Explicit review |
| --- | --- | --- | --- | --- |
| `intake` | [parse the prompt](grimoire/intake/01-parse-prompt.md); [scope](grimoire/intake/scope.md) | A validated brief with an explicit inventory of concrete theme elements | Brief schema validation | Intent review comparing the brief to the request |
| `scene` (`step1`) | [build the static scene](grimoire/build/step1-static-scene.md) | A complete static composition made with asset factories: background, actors, mechanisms, board or interface elements | Metadata + static browser check (canvas CSS matches `#app` at DPR 2; custom 3D settings name a considered catalog path). Mesh counts are not gated. | Experience and performance review of recognition, coverage, composition and geometric simplicity |
| `behavior` (`step2`) | [build the playable loop](grimoire/build/step2-behavior.md); [input contract](grimoire/review/input-contract.md) | A complete playable loop: applicable controls, camera, actions, navigation, collisions, progression, win/loss, terminal stop, restart and the feedback play requires | Real-input behavior check + closure playthrough. Locomotion, aiming, resources or autonomous agents import a catalog module from the run page or record `catalog_skips`. | Experience and performance review of controls, feedback and the playable loop |
| `acceptance` (`step3`) | [finish and accept](grimoire/build/step3-acceptance.md); [playthrough contract](grimoire/review/playthrough-contract.md) | Final UI and presentation, integration repairs, full real-input replay and relocated launch | Acceptance + relocation | Experience and performance review of presentation, outcomes, restart and standalone launch |

Read the current prompt and only the capability references it selects. Choose behavior by capabilities (selection, movement, aiming, timing, collision, turn order, targeting, etc.), not by genre labels. A menu game may need no avatar; a creature battle may need a fixed encounter; a tactical board may need grid navigation and turn state. Combine capabilities for hybrids; consult [optional patterns](grimoire/patterns/_index.md) when a selected mechanic needs them.

Preserve defining actions and explicit values within the [product scope](grimoire/intake/scope.md): silent desktop keyboard/mouse play, a 3D modeled scene, one continuous round, and reachable win and loss states. Scope-changing reductions follow intake, not silent substitutions. Prefer fitting catalog factories; missing assets use simple primitives, while the game owns input, state and rules. Stage prompts route detailed scene, camera and UI contracts only when applicable.

## Closeout

After stage edits, obtain a fresh task packet and execute its `closeout.check` command. It includes the required strategy for behavior and acceptance. Inspect evidence, complete the printed review, then execute `closeout.review` with that review path; review submission does not rerun gates. Individual gates and preflight are diagnostics. See [stage closeout](grimoire/review/gates.md) for evidence reuse and [recovery](grimoire/review/gate-recovery.md) for bounded failure handling.

The scene check proves static coverage, framing, WebGL canvas CSS fit and catalog-first records for a custom 3D setting. Behavior runs two scopes: the behavior check proves applicable real inputs, persistent effects, and catalog camera/combat/resource reuse from the run page or recorded skips; the closure check proves one representative terminal outcome, a real same-page restart and a fresh round that still accepts input. Acceptance proves the full win/loss/restart sequence with the final UI integrated, plus the copied launcher. A closure pass never substitutes for acceptance; each report names its own scope. Composition and geometric simplicity stay experience review.

Use the shared contracts when editing cards, manifests or state: [shared contract](grimoire/review/shared-contract.md), [capability routing](grimoire/review/capability-matrix.md), [pre-ship checklist](grimoire/review/pre-ship.md), and [recovery](grimoire/review/recovery-and-manifest.md). Keep evidence under each run's `evidence/` directory. Report an unevaluated or inapplicable check as such with its reason; never present one as a pass.
