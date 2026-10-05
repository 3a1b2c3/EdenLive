# Input and state across modes

Outcome: each mode works and its handoff preserves the intended state without duplicate actions.
Use when one round crosses interaction modes, such as travel -> battle, placement -> wave or
menu -> direct control. A fixture configuration that selects a different game at startup is not
itself a runtime mode transition. A level-select of independent stages is not a mixed-mode
handoff; collapse it into one round. In-round waves, rooms or a boss after clearing enemies
remain mixed-mode when they change input ownership. Single-mode games skip this reference.

## Workflow

1. Inspect the brief's complete sequence and existing state owners. In implementation notes, name
   each mode's entry/exit condition, accepted inputs, active systems and state carried forward.
   Include terminal and restart transitions; keep the initial mode explicit.
2. Give each gameplay action an owner in the active mode. Consume a transition edge once before
   the next mode can accept it. On exit, clear mode-local commands and pointer deltas; transfer held
   intent only when specified. Decide whether a fresh press or release is needed after entry.
3. Give each shared resource, progress value and round outcome one authoritative owner. Modes submit
   accepted domain events to those owners instead of maintaining private copies of the same state.
4. State which clocks, agents and delayed actions continue during each mode. Pause, dispose or
   ignore work that no longer belongs to the active mode/round, while retaining intentional background
   simulation. A wave continues through placement only when that fits the brief's pause policy.
5. Update the focus, camera, controls and cues affected by the mode change. Reset through the shared
   [restart path](loop-restart.md), restoring the initial mode and clearing the relevant queues.

Keep this map in the game's existing notes; it needs no new schema. For several interacting
systems or tunables, use [systems, knobs and composition](../build/prototype-design.md).

## Verify and record

Exercise a real action in each required mode and each handoff in the core loop. Include a press
held across a transition, its release and the first new action; inspect focus and feedback.
Verify intended shared-state carryover, background behavior and win/loss/restart into the initial
mode. Recheck a transition-sensitive action in the next round. Record mode, inputs and resulting
state/events; a switch banner alone does not prove the destination mode works.

## Troubleshooting

| Symptom | Likely cause | Remedy and recheck |
| --- | --- | --- |
| Confirming a menu also fires, places or skips in the next mode | Both consumers handle the transition edge | Consume the edge at its owner and apply the entry release/press policy. Recheck one press, a held press and the next deliberate action. |
| A hidden mode keeps spending, moving or changing the result | Old listeners, ticks or callbacks remain active without an ownership check | Route commands and delayed work by current mode/round; keep only declared background systems running. Recheck shared state after the old work would have fired. |
| Progress duplicates or disappears at a handoff | Modes copy resources or replay the same transfer event | Use one shared owner and an explicit once-only transition. Recheck the amount/progress before and after the handoff and any allowed return. |
| Controls or camera describe a different mode | UI/focus changes independently of the authoritative mode | Derive presentation and input routing from the same transition. Recheck the first visible cue and accepted action after entry. |
| Restart returns to a late phase or immediately performs an old action | Mode, focus or queued intent was omitted from reset | Restore the initial mode with the rules and input owners. Recheck same-page restart from the reachable terminal modes. |
