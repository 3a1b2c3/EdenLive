# Control routing from a genre hint

A genre suggests candidates; the brief's action decides. Read
[continuous controls](../build/continuous-controls.md) for movement,
automatic motion and indirect steering, or [discrete interactions](../build/discrete-interactions.md)
for cells, selection, placement and modes. Combine them for hybrids.

Do not transfer snake reversal rules to maze chase or falling pieces, flight mouse controls to
every aircraft, health depletion to ring-out combat, or fixed top-down cameras to every arena.
Select input frame, timing, constraints and outcome from the actual brief. Specialized gameplay
rules stay with that brief or selected module, not the shared workflow.

When no controller fits, record the missing transition and implement it using reusable surrounding
infrastructure. Use the [capability matrix](../review/capability-matrix.md) to retain equivalent
checks. Lack of a genre-specific row is not permission to omit a core action.
