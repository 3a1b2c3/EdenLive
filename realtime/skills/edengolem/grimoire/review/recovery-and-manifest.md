# Recovery and factory lookup

Outcome: resume from current evidence or find one factory's usable API without repeating discovery.
Use after interruption/context loss, or when selecting visuals in Stage 1. During a
continuous build, keep relevant documents in context; no per-stage recovery-note cycle is needed.

## Resume only the missing context

If `evidence/recovery.json` exists, read it through the helper so hashes are checked again:

```sh
python <skill-root>/forge/recovery.py --root /path/to/game --read
```

The note locates the artifact, check, unresolved issues and next action. `artifact_current` and
the returned attempt validity reflect current files; the saved note alone never certifies them.
Without a note, use `.state.json` and the current run card. Derive the run card's `capabilities`
from the brief, then open only the current stage and missing applicable references.

Before pausing, compaction or handoff, save a short next step and unresolved items when needed:

```sh
python <skill-root>/forge/recovery.py --root /path/to/game --artifact runs/step3/final \
  --check step3:final --next 'Inspect the goal cue at the target viewport' \
  --unresolved 'Experience review remains not_evaluated'
```

Query a specific current check without reading historical reports:

```sh
python <skill-root>/forge/record_attempt.py --root /path/to/game --check step3:final \
  --artifact runs/step3/final --find
```

`null` means there is no matching valid evidence. Only a valid `passed` result supplies that
check's pass; `failed` and `not_evaluated` retain their meaning. Artifact, brief, shared sources,
lockfile, strategy and report hashes must still match. See [incremental checks](gates.md#incremental-checks)
for recording and refinement; a functional pass does not satisfy an outstanding experience review.

## Look up only a needed factory

In Stage 1, use the [scene selection criteria](../build/step1-static-scene.md#compose-the-intended-presentation)
to identify roles needing a factory lookup. The index omits parameter tables; the selected factory
returns schema defaults, ranges/choices, presets and API location:

```sh
python <skill-root>/forge/factory_manifest.py
python <skill-root>/forge/factory_manifest.py --factory CharacterVisualFactory
python <skill-root>/forge/factory_manifest.py --factory CharacterVisualFactory \
  --options '{"height":2.1,"loadout":{"right":null,"left":null}}'
```

The Python command wraps [factory_manifest.mjs](../../forge/factory_manifest.mjs), which reads live
factory exports. `--options` calls the real normalizer and rejects
unknown keys, including nested keys; inspect the resolved values because normalizers may clamp
or default values. A missing normalizer leaves option validation unavailable. Read the selected
API for composition, animation and ownership only as needed; do not load every factory source.
`runtimeDependencies` lists direct literal references, not a complete copy closure. Use
`python <skill-root>/forge/scaffold.py assets` for [runtime dependency copying](../build/standalone-project.md#copy-selected-runtime-dependencies).

## Verify

Reuse evidence only within its recorded scope and current hashes. Missing capabilities skip their
diagnostics; missing observations do not pass them. Launch/background/relocation commands live in
[standalone setup](../build/standalone-project.md#launch-and-check-the-actual-output).

For acceptance, resume the [presentation and acceptance workflow](../build/step3-acceptance.md) using
the retained behavior artifact and its inherited strategy. Finish changed sources before the formal
batch; it checks integrated play/UI and relocated launch. Keep unresolved checks visible when resuming.

A project whose behavior stage passed under the earlier workflow proves capability inputs only: its
`passed` never meant the loop was verified closed. Keep that record as written, and when resuming,
check whether progression, win/loss, terminal stop and restart actually exist. Implement what is
missing in the current work artifact and verify it there. Do not rewrite historical stage records or
reconstruct a closure result for a run that never produced one; the older ledger has no
`step2-closure` entry, so the current batch runs that check rather than reusing anything.
