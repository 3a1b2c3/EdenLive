# Conditional patterns

Read only the entry whose trigger occurs. Stages and checks route by
[capability](../review/capability-matrix.md); a game may need several entries or none.

| Trigger | Read | Other games |
| --- | --- | --- |
| A character needs support, mouse look, camera-relative orbit or optional jump assistance | [Player controller](player-controller.md) | Use the actual actor/interaction model |
| Considering a controller from a genre label | [Control routing](genre-controls.md) | Derive behavior from the verb |
| Collision, menu or other domain events need semantic identity | [Interaction tags](interaction-tags.md) | Empty tags are valid when no named interactions are needed |
| A completed round must reset (wired in Stage 2) | [Restart ownership](loop-restart.md) | Shared round outcome; reset only existing systems |
| Using intentional simple shapes, a 3D role with no factory, or reviewing readability | [Greybox kit](greybox-kit.md) | Use the actual scene, board or interface; no scenery quota; skip dense imported meshes |
| Static scene assembly or a visual revision uses parameterized assets | [Factory composition](parameterized-visual-factory.md) | Freeze poses in Stage 1; drive them from evaluated state in Stage 2 |
| Solid boxes provide support and side blocking | [Box collision](box-collision.md) | Use occupancy, physics or another fitting collision model |
| Movement or camera controls affect framing, geometry can obscure relevant content, camera modes/modifiers need coordination, or touch camera gestures share inputs | [Camera correctness](camera-correctness.md) | Skip stable, unobstructed views with none of these needs; omit checks for absent capabilities |
| A camera ray determines target/impact | [Camera aiming](camera-combat-navigation.md) | Skip for direct selection or automatic targeting without camera aim |
| Agents plan around solids or attacks require occlusion | [Spatial navigation](spatial-navigation.md) | Fixed scripts/boards need only their actual movement constraints |
| A short action window needs a matching cue | [Action readability](action-readability.md) | Skip timing-specific checks when timing cannot affect success |
| The loop crosses interaction modes | [Mixed modes](mixed-modes.md) | A startup configuration choice needs no runtime handoff checks |
| Several systems share state or real parameters need tuning | [Systems, knobs and composition](../build/prototype-design.md) | Simple interactions can use a short note; omit knobs without tunables |
