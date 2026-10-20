# Shared build and evidence contract

Read once at intake or resumption. Stage prompts add only their stage's requirements.

- Preserve requested actions, explicit values and the agreed bounded slice. Infer routine details;
  resolve intent-changing scope conflicts before implementation under [scope](../intake/scope.md).
  Both reachable terminal outcomes are required. Missing assets call for simple custom geometry,
  not a different game. Stage prompts own factory selection, canvas fit and conditional camera/UI
  details; read only those selected by the current task.
- For new builds, read [scope](../intake/scope.md) and parse the prompt before initializing a
  project. Parse concrete theme elements at intake, assemble the complete static scene in
  Stage 1, build the complete playable loop in Stage 2 -- controls, progression, win/loss, terminal
  stop and restart -- then finish presentation and prove the whole game in Stage 3. Keep the
  constructed scene and game-owned state through promotion. Functional
  feedback and playable choices belong with behavior; an interface can itself be the static scene.
  Stage 3 completes presentation and repairs what it changed; it does not reimplement outcomes.
  `ui.mode: none` omits extra UI composition, not the acceptance stage. All stages require review.
  Live commands for the current project come from the task packet.
- Evidence scope differs between the two playthrough checks. Behavior's closure check proves one
  representative terminal outcome, a real same-page restart and a fresh round that still accepts
  input; both terminal branches must be implemented, but the unexercised one stays unevaluated.
  Acceptance proves win, deliberate loss and a win after restart with the final UI integrated.
  A closure pass never stands in for acceptance. Both scopes share the strategy format, the input
  executor and the read-only observation adapter, and the authored strategy travels with the run.
- Route implementation and checks by [capability](capability-matrix.md), combining hybrid modes
  and recording custom behavior when needed. Do not impose movement, timers, enemies or score on
  games that lack them. Explain omitted subtasks without omitting required stage outcomes.
- Evidence proves only the artifact, inputs and scope actually checked. Rule simulation, boot,
  screenshots and component previews each have limits; none alone proves real-input full play.
  Inspect images before a visual verdict. Retain failed paths and mark unavailable checks
  `not_evaluated`; a saved replay recipe is not an observed reproduction.
- Keep functional, experience and performance assessments separate. Required function and
  experience must pass; measured performance is required only for an agreed target. Each evaluated
  assessment links evidence, and each unevaluated/inapplicable assessment states its reason.
- Reuse checks only within unchanged dependencies/configuration/environment; verify changed
  behavior on the current artifact. Latest failures block older passes. Normal closeout uses
  [gates](gates.md); revisions and failed checks use [recovery](gate-recovery.md).
- Retain stage artifacts, evidence and state in the [standalone output](../build/standalone-project.md).
  Each stage/revision has at most three correction-and-recheck rounds, counted once per cycle;
  reading evidence or a preflight adds no round. Process-launch failures have a separate bounded
  retry count and remain unevaluated. A passing third round may advance; otherwise
  preserve the blocker and stop. See [refinement actions](gate-recovery.md#bounded-refinement).
