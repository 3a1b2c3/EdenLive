# Asset router

Select the current stage's resources first, then the capabilities the brief needs. Read only relevant
catalogs and chosen exports/signatures. A missing module calls for a small implementation around
reusable infrastructure; it does not justify changing the game to fit a nearby example.

Runtime: Three.js 0.161.0; optional Rapier compat 0.14.0. The template uses pinned vendor imports.
WorldBasis describes axes; some planar helpers explicitly require Y-up. Check that boundary before
composition. Render factories do not automatically supply rules, collision or navigation.

| Build stage | Presentation and reading boundary |
| --- | --- |
| 1 / scene | Select fitting world/visual/UI factories and build the complete static composition, including actors, mechanisms, boards and interface surfaces. Bind the brief's theme inventory to actual objects. Freeze poses and animation. Read UI entries for layout and infrastructure only; leave result cards and decorative menus to Stage 3. |
| 2 / behavior | Reuse the scene and wire only applicable motion, controls, camera, interactions, animation, navigation and collisions. Close the loop: progression, win/loss, terminal stop and restart, plus the feedback those decisions require. Select behavior catalogs by capability and read UI entries for decision feedback. |
| 3 / acceptance | Compose final UI and presentation from real state, repair what it changed, and verify the full real-input sequence, integrated UI and standalone launch. Explicit no-UI omits UI design but still requires acceptance. |

World foundations and World visuals are complementary catalogs, available from scene assembly.
Intentional primitives fit abstract pieces and 3D roles with no factory; depicted characters and
scenery use fitting factories. Do not import dense meshes as a substitute for a missing factory.
A custom 3D setting considers a catalog environment first and records the skip; keep geometry
readable rather than ornamental. The visual factories are simplified geometric variants: choose by recognizable silhouette, preset
palette and color blocks, and read the selected API for its reduced parameter and motion surface.
Use the transitive copier for selected entrypoints. For [revisions](../grimoire/build/revisions.md),
retain existing visuals and read their factories only if the change affects that integration.

| Need | Catalog |
| --- | --- |
| Character, vehicle, automatic, grid or indirect motion | [Motion](catalogs/motion.md) |
| Menu, placement, falling piece, station or feed interaction | [Interaction](catalogs/interaction.md) |
| Objectives, resources, clocks, combat and domain rules | [Gameplay](catalogs/gameplay.md) |
| Pathing, detection, waypoints and autonomous behavior | [Behavior](catalogs/behavior.md) |
| Fixed, follow, pose, orbit or first-person camera components | [Camera](catalogs/camera.md) |
| Optional jump assists, hit-stop or recoil | [Game feel](catalogs/game-feel.md) |
| Shell, feedback, counters, labels and overlays | [User interface](catalogs/ui.md) |
| Simple geometry, support, collision and functional world feedback; any stage | [World foundations](catalogs/world.md) |
| Characters, animals, buildings, scenery and visual effects; assemble in Stage 1 | [World visuals](catalogs/world-visuals.md) |
| Coordinate basis, fixed/discrete frame timing, vector and seeded-random utilities | [Math](catalogs/math.md) |

The [brief index](../grimoire/intake/exemplars.md) covers 24 example requests, not 24 complete
verified implementations. `assets/examples/` holds component demonstrations only, not example
games: no genre, balance or interaction choice here is a shared requirement. For integration
guidance read the applicable [pattern](../grimoire/patterns/_index.md).

When composing parameterized scene visuals in Stage 1, read the selected factory's API and the conditional
[factory pattern](../grimoire/patterns/parameterized-visual-factory.md). When contributing a new
factory of any asset category, use the [admission and interface contract](../docs/api/asset-factory-contract.md).

Maintain the relevant catalog when adding modules. `forge/check_factory_drift.py` follows this
router's explicit catalog links and detects uncatalogued factories; it does not certify every API.
