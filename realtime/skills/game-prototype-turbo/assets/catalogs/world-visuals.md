# World visuals: static scene assembly

Use in Stage 1, or when a revision changes existing visuals.
Select from the scene's primary actors, buildings and props; read only chosen APIs and dependencies.
Use fitting factories to compose the intended static scene, guided by
[Stage 1](../../grimoire/build/step1-static-scene.md), then wire state-driven poses in Stage 2.
Abstract geometry or UI can remain the intended representation. A missing factory calls
for a small suitable visual; it does not change the requested game or require new library assets.
If that visual is 3D and no catalog factory fits, build it from simple primitives (box, sphere,
cylinder, capsule, plane) rather than imported GLTF/FBX/OBJ packs or dense custom meshes.
A custom 3D `setting` should consider ArenaLayout, ArenaEnvironment, NaturalEnvironment,
BoardEnvironment, RaceTrackEnvironment or GreyboxKitFactory first and record the path skipped.
Keep a custom space as a few large masses and one landmark; stacked concentric rings or unique
prop fields are review failures, not something a mesh budget can catch.
Select public factory entrypoints with `forge/scaffold.py assets`; its transitive copier brings
shared helpers automatically. The factory set is simplified parameterized geometry: preset
identifiers match the earlier full-featured set, parameter surfaces are condensed, and
decoration-specific options are dropped. Named-action factories expose `setPose(action, seconds)`
and `reset`; some also publish `actions` or `motions`. Static assets expose attachments and bounds
only.
See [factory composition](../../grimoire/patterns/parameterized-visual-factory.md) when selected.

Composed environments are listed here too: NaturalEnvironment imports tree, grass and rock visuals.
Terrain, collision and basic geometry use [World foundations](world.md). Rendering factories do not
automatically provide collision, navigation or objective triggers.

### `assets/world/environment/ArenaEnvironment.js`

- Functionality: Builds arena scene visuals with obstacles and walls, supports spawn position sampling and obstacle queries, and creates explicit Rapier physics colliders. Rectangular via `worldSizeForward`; cover is opt-out (`pillars: false`, `ramps: false`) and the suppressed layout is empty, so obstacle queries agree with what was built; `wallOpenings: [{ side, centre, width }]` cuts a doorway or goal mouth into the perimeter; `wallOpacity` for see-through walls.

### `assets/world/environment/NaturalEnvironment.js`

- Functionality: Builds natural scene visuals with terrain and tree/rock/grass props, supports terrain height queries, and creates explicit terrain/tree/rock Rapier physics colliders. Trees vary by seeded random tree options so crowns stay per-tree while gameplay-held sizes stay explicit.

### `assets/world/environment/RaceTrackEnvironment.js`

- Functionality: Builds race-track scene visuals with road terrain, checkpoint markers, and barriers, supports spawn pose sampling, and creates explicit terrain/barrier Rapier physics colliders.

### `assets/world/environment/SceneAtmosphere.js`

- Functionality: Sets a whole look from one palette object -- `applyAtmosphere(scene, {...})` for sky colour, linear or exponential fog, an ambient fill and one directional key. The key's direction comes from `keyElevationDeg`/`keyAzimuthDeg` rather than a hand-written vector (prose describes light in angles, and a hand-written vector is where the axis-sign trap puts the key behind the play space), and the shadow frustum is sized to the visible space rather than a fixed extent. `fogFarForGoal(goalDistance)` derives the fog distance from the furthest thing that must read: fog far is a legibility budget, not a mood knob, because a goal past the fog plane is unwinnable while every coordinate stays legal.

### `assets/world/object/FpsWeaponViewModel.js`

- Functionality: Updates first-person weapon presentation from player movement, stance, aiming, and recoil state.

### `assets/world/object/factory/CharacterVisualFactory.js`

- Functionality: Creates thirty simplified body presets spanning everyday, fantasy and profession roles. Capsule chests, tapered limbs and simple heads keep the mesh budget small; the shared grip controller attaches left/right equipment so held items follow the hands. Named poses cover idle, walk and run; gameplay owns hit and death states. Read [Character API](../../docs/api/character-visual-factory.md).

### `assets/world/object/factory/EquipmentVisualFactory.js`

- Functionality: Creates thirty simplified weapon, shield, magic and profession presets, each a few primitives on a shared grip/action rig. Main and support grips plus item attachments support both standalone display and character loadouts. Named still/inspect poses and per-kind `sampleAction` compose with the shared equipment action helpers. Read [Equipment API](../../docs/api/equipment-visual-factory.md).

### `assets/world/object/factory/FantasyCreatureVisualFactory.js`

- Functionality: Creates eighteen presets across nine species: dragons, zombies, skeletons, slimes, orcs, vampires, werewolves, demons and elementals. Per-form parts builders (dragon, humanoid, slime, elemental) share the creature action rig, so pounce, charge and death work exactly as on ordinary animals. Also needs `FantasyCreatureParts.js`. Read [Fantasy creature API](../../docs/api/fantasy-creature-visual-factory.md).

### `assets/world/object/factory/MechanismVisualFactory.js`

- Functionality: Creates ten switch, hazard, platform and gate presets. Named static states and transitions expose press/toggle, timed spikes, swing, lift/rotate, launch, saw spin and gate operation -- the same action set as the full-featured factory, on simplified geometry. World working-axis frames and pose bounds aid integration; activation and physics stay game-owned. Read [Mechanism API](../../docs/api/mechanism-visual-factory.md).

### `assets/world/object/factory/QuadrupedVisualFactory.js`

- Functionality: Creates fifteen four-legged animal presets with simplified anatomy: block torso, tapered legs, optional ears, horns, tusks and humps. Shared named poses cover idle, move, pounce, charge and death; step cadence and tail swing stay configurable. Read [Quadruped API](../../docs/api/quadruped-visual-factory.md).

### `assets/world/object/factory/BirdVisualFactory.js`

- Functionality: Creates thirteen bird presets across raptors, tropical birds, waterfowl and farmyard birds. Simplified bodies flap through the shared idle/move poses; pounce, charge and death come from the shared creature action rig, with flap speed and glide ratio configurable. Flight path stays caller-owned. Read [Bird API](../../docs/api/bird-visual-factory.md).

### `assets/world/object/factory/FishVisualFactory.js`

- Functionality: Creates fourteen aquatic presets including fish, shark, ray, puffer, eel, cetaceans, seahorse and jellyfish. Simplified bodies swim through the shared idle/move poses with fin, tentacle and tail options; pounce, charge and death come from the shared creature action rig. Depth and movement stay caller-owned. Read [Fish API](../../docs/api/fish-visual-factory.md).

### `assets/world/object/factory/TrainVisualFactory.js`

- Functionality: Creates nine train presets across steam, diesel, metro, tram and high-speed forms. Parameters control proportions, car count, roof, nose and palette; the optional still/roll poses spin the wheels from caller-supplied seconds. Exposes local rest bounds, cars, wheels and couplings; gameplay owns route following and collision. [API and copy dependencies](../../docs/api/train-visual-factory.md).

### `assets/world/object/factory/HouseVisualFactory.js`

- Functionality: Creates twelve simplified rural house presets across single, L, T and courtyard layouts with porch, chimney, stilt and five roof silhouettes. Each roof is one primitive via `addSimpleRoof`. Exposes an `entrance` attachment, local rest bounds and stats; static, so there is no pose or update. Also needs `ArchitectureParts.js`. [API and copy dependencies](../../docs/api/house-visual-factory.md).

### `assets/world/object/factory/BuildingVisualFactory.js`

- Functionality: Creates twelve simplified city building presets across six massing forms (block, setback, podium, twins, row, courtyard) with true floor counts, plus optional flat, gable or pyramid roofs and an entrance canopy. Exposes local rest bounds and stats; static, with no pose or update. Also needs `ArchitectureParts.js`. [API and copy dependencies](../../docs/api/building-visual-factory.md).

### `assets/world/object/factory/TreeVisualFactory.js`

- Functionality: Creates thirteen tree presets across seven forms: blob crown, cone, layered, column, umbrella, palm fan and bare. One trunk plus a couple of crown primitives per tree; no branches, fruit or flowers, and no shape seed, so the same parameters always give the same tree. `setPose('still'|'wind', seconds)` sways an internal wind rig without moving the root. [API and copy dependencies](../../docs/api/tree-visual-factory.md).

### `assets/world/object/factory/VehicleVisualFactory.js`

- Functionality: Creates fifteen road-vehicle presets across cars, pickup, buses, box truck, tractor and motorcycles. Named still/drive poses spin the wheels from caller-supplied seconds; the steering option angles the front pivots at construction and the poses do not steer or lean. Wheels and steering pivots are exposed for caller-owned state. Read [Vehicle API](../../docs/api/vehicle-visual-factory.md).

### `assets/world/object/factory/AircraftVisualFactory.js`

- Functionality: Creates eighteen aircraft presets including fighters, helicopters and a flying wing. The shared flight rig animates hinged control surfaces, with rotors, landing gear, cannon bursts and weapon launch appearing where the preset builds them -- jets, gliders and flying wings have no rotors to spin. `setPose` accepts evaluated controls; world weapon muzzle and hardpoint frames support caller-owned effects. Read [Aircraft API](../../docs/api/aircraft-visual-factory.md).

### `assets/world/object/factory/GrassVisualFactory.js`

- Functionality: Low-level grass helpers, not a parameterized scene visual: `createGrassMaterial()`, `createGrassBladeGeometry()` and `createGrassBladeVisual({ material, geometry, prng })` returning a bare `THREE.Mesh`. Height comes from `scale.y` so a whole field shares one geometry and one material. Build the shared pair once per field and pass it in; the caller owns both and disposes them. No presets, bounds, stats or factory dispose. [API and copy dependencies](../../docs/api/grass-visual-factory.md).

### `assets/world/object/factory/ArchitectureParts.js`

- Functionality: Shared coarse roof silhouettes (`addSimpleRoof`) used by the house and building factories: one primitive per style (flat, hip, pyramid, gable, shed). Draws into a caller-supplied primitive kit and parent; owns no resources and has no dispose. Copy it alongside either of those factories.

### `assets/world/object/factory/VisualFactoryUtils.js`

- Functionality: Shared option/schema validation, seeded random resolution, primitive geometry/material caches, measurements and owned-resource disposal. `finishVisual` returns `mesh` aliased as `group`; equipment, mechanism and fantasy-creature builders assemble their own API and expose `mesh` only. Creature action rigs, equipment action helpers, aircraft motion, transport utilities and character loadout/equipment control are separate modules in this directory. Select public factory entrypoints with the transitive copier instead of maintaining a helper list. See the [factory contract](../../docs/api/asset-factory-contract.md).

### `assets/world/object/factory/RockVisualFactory.js`

- Functionality: Creates ten grounded rock presets (boulder, slab, ridge, cliff, outcrop, crater, meteorite, crystal and stacks). The full six-action set -- still, rotate, impact, settle, scatter, pulse -- drives the same simplified rig with fragments, crystals and core. Rest bounds and mounts; gameplay owns placement and collision. Read [Rock API](../../docs/api/rock-visual-factory.md).

### `assets/world/object/factory/PickupVisualFactory.js`

- Functionality: Creates twenty-three collectible presets with per-item relative sizing, idle hover/spin and appear/collect transitions. Items are one or two primitives; row/stack/cluster arrangements stay as group offsets. Exposes a local pickup-volume hint; optional PickupObject owns planar collection and reset. Read [Pickup API](../../docs/api/pickup-visual-factory.md).

### `assets/world/object/factory/ProjectileVisualFactory.js`

- Functionality: Builds projectile visual models and update helpers for bullets and missiles. Presentation only; flight, hits and expiry stay with ProjectileObject or game rules. Read [Projectile API](../../docs/api/projectile-visual-factory.md).

### `assets/world/visual-effects/JetFlame.js`

- Functionality: Renders jet exhaust intensity from aircraft throttle and boost state.

### `assets/world/visual-effects/VehicleTireMarkRenderer.js`

- Functionality: Renders terrain-following tire trails from grounded vehicle motion.

### `assets/world/visual-effects/WeaponEffectsSystem.js`

- Functionality: Renders short-lived visual feedback for weapon fire and impacts.

### `assets/world/environment/ArenaLayout.js`

- Functionality: Parameterized Y-up arena floor, instanced stands and gate bays; boundary descriptors do not implement collision. A candidate for a radial chamber or coliseum setting; import it or record it as considered before stacking a custom floor and rings.