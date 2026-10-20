"""Offline catalog-first records: no mesh budget, no historical generated runs."""

from _shared.catalog_eval import (
    catalog_skip_problems, environment_catalog_paths, runtime_imported_assets,
    scene_custom_problems,
)
from check_step1 import REPO_ROOT


def test_environment_candidates_exist_in_the_skill_checkout():
    paths = environment_catalog_paths(REPO_ROOT)
    assert 'assets/world/environment/ArenaLayout.js' in paths
    assert 'assets/world/object/factory/GreyboxKitFactory.js' in paths
    assert len(paths) == 6


def test_custom_setting_must_name_a_real_catalog_candidate():
    brief = {'scene': {'theme_elements': [{'id': 'arena', 'role': 'setting'}]}}
    catalog = environment_catalog_paths(REPO_ROOT)
    missing = scene_custom_problems(
        [{'id': 'arena', 'binding': {'object': 'floor'}, 'custom_reason': 'Stacked rings'}],
        brief, catalog)
    assert any('considered catalog' in problem for problem in missing)
    unknown = scene_custom_problems(
        [{'id': 'arena', 'binding': {'object': 'floor'}, 'custom_reason': 'Stacked rings',
          'considered': 'assets/world/environment/MissingArena.js'}],
        brief, catalog)
    assert any('not a catalog environment module' in problem for problem in unknown)
    ok = scene_custom_problems(
        [{'id': 'arena', 'binding': {'object': 'floor'},
          'custom_reason': 'A meadow with one landmark.',
          'considered': 'assets/world/environment/NaturalEnvironment.js'}],
        brief, catalog)
    assert ok == []


def test_dom_and_non_setting_custom_rows_do_not_need_environment_candidates():
    brief = {'scene': {'theme_elements': [
        {'id': 'commands', 'role': 'interface'},
        {'id': 'hero', 'role': 'actor'},
        {'id': 'spike', 'role': 'hazard'},
    ]}}
    catalog = environment_catalog_paths(REPO_ROOT)
    assert scene_custom_problems([
        {'id': 'commands', 'binding': {'selector': '#commands'}, 'custom_reason': 'Static battle menu'},
        {'id': 'hero', 'binding': {'object': 'hero'}, 'custom_reason': 'Capsule stand-in'},
        {'id': 'spike', 'binding': {'object': 'spike'}, 'custom_reason': 'A few cones'},
    ], brief, catalog) == []


def test_catalog_asset_rows_do_not_need_a_skip_record():
    brief = {'scene': {'theme_elements': [{'id': 'arena', 'role': 'setting'}]}}
    catalog = environment_catalog_paths(REPO_ROOT)
    assert scene_custom_problems([
        {'id': 'arena', 'binding': {'object': 'arena'},
         'asset': 'assets/world/environment/ArenaLayout.js'},
    ], brief, catalog) == []


def _motion_card(modules=(), skips=None):
    implementation = {'controllers': [], 'camera': 'chase', 'input_model': 'WASD'}
    if skips is not None:
        implementation['catalog_skips'] = skips
    return {
        'capabilities': ['continuous_motion'],
        'modules': list(modules),
        'implementation': implementation,
    }


def test_behavior_skips_are_required_only_for_matching_capabilities():
    menu = {
        'capabilities': ['discrete_state'],
        'modules': ['/assets/interaction/MenuSelectionController.js'],
        'implementation': {'controllers': ['MenuSelectionController'],
                           'camera': 'fixed board', 'input_model': 'keys'},
    }
    assert catalog_skip_problems(menu) == []
    chase = _motion_card()
    assert any('continuous_motion' in problem for problem in catalog_skip_problems(chase))
    recorded = _motion_card(skips=[{
        'considered': 'assets/camera/PoseFollowCameraRig.js',
        'reason': 'Souls-like orbit keeps yaw after look input stops.',
    }])
    assert catalog_skip_problems(recorded) == []
    imported = {
        'capabilities': ['continuous_motion', 'resources'],
        'modules': ['/assets/camera/OrbitFollowCameraRig.js', '/assets/gameplay/ResourcePool.js'],
        'implementation': {'controllers': [], 'camera': 'orbit', 'input_model': 'WASD'},
    }
    assert catalog_skip_problems(imported, [
        'assets/camera/OrbitFollowCameraRig.js',
        'assets/gameplay/ResourcePool.js',
    ]) == []
    assert catalog_skip_problems({'capabilities': ['continuous_motion']}) == []


def test_modules_provenance_is_not_an_import():
    claimed = _motion_card(modules=['/assets/camera/OrbitFollowCameraRig.js'])
    problems = catalog_skip_problems(claimed)
    assert any('does not import' in problem for problem in problems), problems
    assert catalog_skip_problems(
        claimed, ['assets/camera/OrbitFollowCameraRig.js']) == []
    skipped_despite_claim = _motion_card(
        modules=['/assets/camera/OrbitFollowCameraRig.js'],
        skips=[{
            'considered': 'assets/camera/PoseFollowCameraRig.js',
            'reason': 'Game-owned orbit; PoseFollow turns with the body.',
        }],
    )
    assert catalog_skip_problems(skipped_despite_claim) == []


def test_runtime_import_graph_not_modules_provenance(tmp_path):
    root = tmp_path / 'project'
    run = root / 'runs/step2/orbit'
    run.mkdir(parents=True)
    (run / 'index.html').write_text(
        '<!doctype html><script type="module" src="./main.js"></script>', encoding='utf-8')
    (run / 'main.js').write_text(
        'export const ready = true;\n', encoding='utf-8')
    catalog = root / 'assets/camera/OrbitFollowCameraRig.js'
    catalog.parent.mkdir(parents=True)
    catalog.write_text('export class OrbitFollowCameraRig {}\n', encoding='utf-8')
    card = _motion_card(modules=['/assets/camera/OrbitFollowCameraRig.js'])
    imported = runtime_imported_assets(root, run)
    assert 'assets/camera/OrbitFollowCameraRig.js' not in imported
    assert any('does not import' in problem for problem in catalog_skip_problems(card, imported))

    (run / 'main.js').write_text(
        "import { OrbitFollowCameraRig } from '/assets/camera/OrbitFollowCameraRig.js';\n"
        'export const Rig = OrbitFollowCameraRig;\n',
        encoding='utf-8')
    imported = runtime_imported_assets(root, run)
    assert 'assets/camera/OrbitFollowCameraRig.js' in imported
    assert catalog_skip_problems(card, imported) == []
