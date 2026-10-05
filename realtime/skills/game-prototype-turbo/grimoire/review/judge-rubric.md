# Review the player's experience

Outcome: an experience assessment grounded in observed controls, decisions and feedback.
Use after mechanical checks, including when a revision changes the player's view or interaction.

## Workflow

Answer only applicable questions using inspected views, recordings
or actual play. State how each observation was obtained; a state-reading bot cannot establish
novice reaction fairness or enjoyment. A critical control/readability failure blocks experience.
Record minor findings with their impact and unreviewed aspects with a reason.

| Stage | Shared questions | Conditional questions |
| --- | --- | --- |
| Scene | Is the complete static composition recognizable and faithful to the theme inventory? Are required objects and controls legible from the normal view? | Traversal: support/destinations. Arena: relevant directions and cover. Board: cells/units. Interface: labels, choices and feeds. Hybrid: each phase's surfaces. |
| Behavior | Do advertised actions produce understandable, persistent effects? Are accepted and rejected actions distinguishable? Is the loop playable: can the player progress, reach an outcome, see it end and start again? | Manual movement: release/turning. Automatic motion: steering/timing. Indirect control: cause/effect. Discrete input: focus/commit/repeat. Collision, navigation and state-driven poses only when applicable. Judge the feedback play requires, not finished styling. |
| Acceptance | Can a player understand objectives, outcomes and restart? Do live state, views and UI agree through a full run and replay? | Existing resources and phase changes are visible; state screens and controls remain usable. Agents affect outcomes. Reset clears relevant queues, poses and ownership. The finished presentation did not break the outcome or restart behavior it replaced. |

For acceptance, inspect running and applicable pause/terminal states, depleted resources and long
text at the desktop play viewport. UI should group information by purpose and preserve the game's decision
space. A single intentional readout can suffice; a styled debug dump may not. Inspect bounds/focus
reports alongside actual images. Optional isolated fixtures help diagnose presentation; stub
callbacks cannot establish real-game wiring. The [acceptance workflow](../build/step3-acceptance.md)
checks state writers and actual actions together.

Keep functional HUD, controls and cues in normal-view evidence. A diagnostic view may omit overlays
only as a supplement. Silence is not missing feedback: generated audio and haptics are out of
scope. Missing rumble or a stick is not a control gap. A title, pause or result card is not a
level-select of independent stages. Choose another view or state
when a capture cannot answer a question: a vertical board needs a front view; a long course needs
decision-point captures; a menu needs focus and selection visible. Do not require a top-down
screenshot or a start-to-goal route for every game.

Use [capabilities](capability-matrix.md) to choose boundary cases. A kitchen can prove a served dish,
a placement game can prove an accepted tower affects a wave, and a menu can prove a resolved turn.
No invented threat, jump, collectible chain, branching choice or teaching sequence is required.

## Verify and record

Report function, experience and performance separately. Smooth-looking screenshots are not frame
measurements; software-rendered browser samples are not target-device certification. Measure the
relevant environment/counts and requested budget, or state that performance remains unmeasured.
