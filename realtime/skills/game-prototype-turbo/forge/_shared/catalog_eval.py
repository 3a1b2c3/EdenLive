"""Catalog-first evaluation records for custom scene work and skipped behavior modules.

The gate does not count meshes. It only requires that a custom 3D environment
names a real catalog candidate that was considered, and that a behavior card
which declares locomotion, aiming, resources or autonomous agents actually
imports a matching catalog module from the run page, or records the skip.
The run card's `modules` list is provenance, not proof of import. DOM/interface
custom entries are exempt. Visual complexity stays a review judgment.
"""

from pathlib import Path

# A custom 3D *setting* is an environment (arena, meadow, street, chamber).
# Actors, hazards, goals, resources and DOM bindings do not use this gate.
ENVIRONMENT_ROLES = frozenset({'setting'})

# Catalog environment modules a custom arena, meadow, street or chamber should
# consider before stacking primitives. GreyboxKit is the generic massing kit.
ENVIRONMENT_CANDIDATES = (
    'assets/world/environment/ArenaLayout.js',
    'assets/world/environment/ArenaEnvironment.js',
    'assets/world/environment/NaturalEnvironment.js',
    'assets/world/environment/BoardEnvironment.js',
    'assets/world/environment/RaceTrackEnvironment.js',
    'assets/world/object/factory/GreyboxKitFactory.js',
)

# Behavior modules that keep being rewritten when they already exist. A skip
# is allowed; an unrecorded skip on a capability that those modules cover is not.
BEHAVIOR_CANDIDATES = {
    'continuous_motion': (
        'assets/camera/PoseFollowCameraRig.js',
        'assets/camera/LookOffsetCameraRig.js',
        'assets/camera/PositionFollowCameraRig.js',
        'assets/camera/FirstPersonCameraRig.js',
        'assets/camera/OrbitFollowCameraRig.js',
    ),
    'aiming': (
        'assets/gameplay/combat/MeleeAttackSystem.js',
        'assets/world/object/AttackTelegraphView.js',
        'assets/gameplay/AimResolver.js',
        'assets/gameplay/combat/CameraRayShotResolver.js',
        'assets/gameplay/combat/ProjectileWeaponSystem.js',
    ),
    'resources': (
        'assets/gameplay/ResourcePool.js',
        'assets/gameplay/CombatPlay.js',
    ),
    'autonomous_agents': (
        'assets/behavior/CombatBehaviorDirector.js',
        'assets/gameplay/WaveSpawnDirector.js',
    ),
}


def environment_catalog_paths(skill_root):
    """Return catalog environment paths that actually exist in this checkout."""
    root = Path(skill_root)
    return tuple(path for path in ENVIRONMENT_CANDIDATES if (root / path).is_file())


def _normalize_asset(value):
    return str(value or '').strip().lstrip('/')


def _considered_list(item):
    raw = item.get('considered')
    if isinstance(raw, str) and raw.strip():
        return [raw.strip().lstrip('/')]
    if isinstance(raw, list):
        return [str(entry).strip().lstrip('/') for entry in raw if str(entry).strip()]
    return []


def _theme_roles(brief):
    roles = {}
    for element in brief.get('scene', {}).get('theme_elements', []):
        if isinstance(element, dict) and element.get('id'):
            roles[element['id']] = element.get('role')
    return roles


def scene_custom_problems(entries, brief, catalog_paths):
    """Fail custom 3D environment rows that never named a catalog candidate."""
    problems = []
    allowed = set(catalog_paths)
    roles = _theme_roles(brief)
    for item in entries:
        if item.get('asset'):
            continue
        binding = item.get('binding') or {}
        if 'selector' in binding:
            continue
        role = roles.get(item.get('id'))
        if role not in ENVIRONMENT_ROLES:
            continue
        considered = _considered_list(item)
        if not considered:
            problems.append(
                f"{item['id']}: custom 3D environment must name a considered catalog "
                "path (ArenaLayout, ArenaEnvironment, NaturalEnvironment, BoardEnvironment, "
                "RaceTrackEnvironment or GreyboxKitFactory) and why it was skipped"
            )
            continue
        unknown = [path for path in considered if path not in allowed]
        if unknown:
            problems.append(
                f"{item['id']}: considered path is not a catalog environment module: "
                f"{', '.join(unknown)}"
            )
    return problems


def runtime_imported_assets(root, run_path):
    """Project-relative paths reachable from the run page, not from `modules` provenance."""
    from _shared.check_dependencies import closure

    root = Path(root).resolve()
    run_path = Path(run_path)
    entries = [run_path / 'index.html']
    if (run_path / 'round.mjs').is_file():
        entries.append(run_path / 'round.mjs')
    files, _uncertain = closure(root, entries)
    imported = set()
    for path in files:
        try:
            imported.add(_normalize_asset(Path(path).resolve().relative_to(root).as_posix()))
        except ValueError:
            continue
    return imported


def catalog_skip_problems(meta, imported_paths=()):
    """Fail when declared capabilities needed a catalog module and neither imported nor skipped it.

    Scene-stage cards without `implementation` are skipped. Menu and board games
    that never declare locomotion, aiming, resources or autonomous agents need
    no skip list. A matching file in the runtime import graph, or a row in
    `catalog_skips`, is enough; sibling modules in the same family are not
    required. `modules` is card provenance: listing a candidate there without
    importing it does not satisfy the gate and is reported as a miss.
    """
    implementation = meta.get('implementation')
    if not isinstance(implementation, dict):
        return []
    capabilities = set(meta.get('capabilities') or [])
    relevant = [cap for cap in BEHAVIOR_CANDIDATES if cap in capabilities]
    if not relevant:
        return []
    imported = {_normalize_asset(path) for path in imported_paths if str(path).strip()}
    claimed = {_normalize_asset(path) for path in meta.get('modules') or [] if str(path).strip()}
    skips = implementation.get('catalog_skips') or []
    problems = []
    recorded = set()
    if skips and not isinstance(skips, list):
        return ['implementation.catalog_skips must be an array of {considered, reason}']
    for row in skips:
        if not isinstance(row, dict) or not str(row.get('considered', '')).strip() or not str(row.get('reason', '')).strip():
            problems.append('each catalog_skips row needs considered and reason')
            continue
        recorded.add(_normalize_asset(row['considered']))
    for capability in relevant:
        candidates = BEHAVIOR_CANDIDATES[capability]
        if any(path in imported or path in recorded for path in candidates):
            continue
        claimed_unimported = [path for path in candidates if path in claimed]
        if claimed_unimported:
            problems.append(
                f"{capability}: modules lists {', '.join(claimed_unimported)} but the runtime "
                "page does not import it"
            )
            continue
        problems.append(
            f"{capability}: import a catalog module or record it in implementation.catalog_skips "
            f"({', '.join(candidates)})"
        )
    return problems
