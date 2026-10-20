# Intake scope boundary

Apply this only when deciding whether an idea fits the product. Match the core mechanic and its
role, not a title, theme or missing library module. These are product limits, not engine limits.

| Core gameplay | Outside current scope |
| --- | --- |
| Outcomes | Games whose defining loop has no reachable win or no reachable loss; do not invent an unrelated terminal condition to admit them |
| Card play | Deck construction and card-combination rules, including card battles; incidental card-shaped UI is fine |
| Unrepresentable interaction | Required hardware or interaction cannot be preserved as keyboard and mouse in a desktop Three.js prototype (webcam, MIDI, VR and similar) |
| Bodily gesture input | Tracked swings, throws, poses or motion-controller gestures whose replacement by buttons changes the game; keyboard steering remains eligible |
| Non-visual output | Generated music, sound effects, beat-matching, haptics, vibration or other non-visual channels whose replacement by visible cues changes the game; visual timing windows remain eligible |
| Non-keyboard/mouse input | Gamepad, joystick, trackpad or touch surface as the defining control; keyboard and mouse/pointer remain the input. Remapping a stick or touch layout to keys is not preservation when that device is the game |
| Non-3D scene presentation | Play whose defining surface is 2D-only, text-only, spreadsheet, paper or a DOM/canvas2d board rather than a 3D modeled scene; a menu, HUD or board overlaid on or placed in a 3D scene remains eligible |
| Destruction physics | Physical fracture, structural collapse, deformation or destruction-driven chain reactions, including slingshot demolition; discrete bricks/blocks are fine |
| Complex mechanism puzzles | Coupled bespoke mechanism chains, time manipulation, perspective-dependent geometry or momentum-preserving placeable portals as the core puzzle; difficulty alone is not a rejection |
| Open-ended voxel sandbox | Survival/crafting with block-by-block terrain editing |
| RTS / 4X | Interdependent economy, construction, training, unit command and progression |
| Terrain-carving crowds | Crowd guidance through runtime terrain reshaping |

Simple push-box puzzles, keys/doors, isolated switches, ordinary rigid-body motion and
rule-based blasts remain eligible. Hybrid action with a small puzzle also fits.
Keep prototypes silent, keyboard/mouse, and presented as a 3D modeled scene in one continuous
round with reachable win and loss states. A campaign can supply the setting for a bounded
round of waves, rooms or a boss. Record that slice explicitly. If independent stages or level
selection are an explicit requirement, explain the scope conflict and resolve the intended slice
before writing the brief; do not silently remove that requirement. Generated audio, haptics, a required gamepad/touch device, or a
2D-only play surface remain outside scope under the rows above.

If a listed mechanic is central, stop intake with the reason and no generated brief. There is no
`unresolved` or `skipped` stage status: before `scaffold init`, do not write a brief and do not
create `.state.json`; after a project exists, keep intake `in_progress` and record the blocker in
a recovery note or evidence, never `passed`. If centrality is unclear, clarify it before
proceeding; do not remove the defining mechanic to fit. Missing assets alone require a small
implementation, not refusal.
