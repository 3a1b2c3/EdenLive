# Final game handoff

Outcome: a runnable independent project with evidence for the delivered version.
Read only at final handoff or completion of a revision; reuse the linked checks and judgments.
Follow the [shared contract](shared-contract.md) and [stage closeout](gates.md#stage-closeout).

## Pre-ship checklist

Before handing over a final game or completed revision, review the artifact being delivered against
this summary of the gates. Link supporting evidence from the final stage/revision record; checked
boxes alone do not establish a pass. Use capability routing to select applicable checks.

- [ ] The current brief/rules preserve the requested defining actions, explicit requirements and
  bounded slice; changes from the original brief are recorded. The delivered game stays silent,
  keyboard/mouse, and a 3D modeled scene in one continuous round: no generated audio or haptics,
  no gamepad/touch layout, and no level-select of independent stages (in-round waves or a boss
  after clearing enemies are fine).
- [ ] The documented run path and launch instructions open the reviewed artifact in a browser
  without fatal startup, import or request errors.
- [ ] The chosen output root has the [standalone layout](../build/standalone-project.md): necessary
  copied assets, npm manifest/lockfile, all three stage artifacts, server, launcher and local evidence.
  A relocated copy restores dependencies with `npm ci` and launches from another working directory
  without runtime imports into the skill installation or a CDN. Acceptance includes the final UI closure.
- [ ] Actual player controls cause meaningful gameplay state changes with understandable feedback.
- [ ] A full win and a deliberate loss are reachable through normal input. Each terminal outcome
  occurs once, remains stable and explains why the round ended.
- [ ] The real restart control restores a fresh playable round, clears relevant input/state and
  supports an observed second win.
- [ ] The normal player view keeps the required space, board or interface, controls and cues readable
  and operable. Any screenshots or recordings used as evidence have inspection verdicts.
- [ ] Stage 1 evidence covers all concrete theme elements in the static scene, board or interface,
  following the
  [scene selection criteria](../build/step1-static-scene.md#compose-the-intended-presentation).
  Roles without a catalog factory use simple primitive massing rather than imported dense meshes.
  A custom 3D setting records the catalog environment considered and skipped. Prefer silhouette,
  color and a few large masses over stacked decoration; that judgment is review, not a mesh count.
  The play canvas CSS box matches `#app` at high DPR.
  The delivered game's corresponding poses and effects follow live state and survive restart, with
  applicable behavior/acceptance observations; a component preview alone is insufficient.
- [ ] Acceptance has a composed player interface for a desktop browser view, with reviewed hierarchy, appropriate resource
  displays and applicable state screens. Do not add a phone layout, touch overlay or gamepad mapping. An explicit no-UI brief omits added interface design,
  while outcomes and restart still pass through actual player input.
- [ ] Relevant capabilities have success and failure/boundary evidence; applicable hybrid transitions
  and regressions are covered. Omitted cases have reasons.
- [ ] Evidence identifies the delivered artifact/version, commands or actual input sequences, and
  observed outcomes. Passes from earlier artifacts remain labeled as historical evidence.
- [ ] Functional and experience assessments pass. Unevaluated or inapplicable subchecks have reasons
  and leave no required outcome unverified.
- [ ] Any required performance target has a measured pass. Without a required target, performance
  may remain `not_evaluated` with a reason; report any samples separately from a target verdict.
- [ ] Closeout reports `current_stage: done`, or the manual/revision route's task packet
  validates state and reports no unfinished stage/revision. The handoff includes the run path,
  launch instructions, controls, evidence and remaining limitations.
