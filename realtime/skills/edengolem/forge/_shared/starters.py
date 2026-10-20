"""Authoring drafts: copy known facts; leave gameplay choices visibly unfinished."""

import json


def scene_manifest(brief):
    return {'version': 1, 'elements': [
        {'id': element['id'], 'binding': {}, 'asset': ''}
        for element in brief['scene']['theme_elements']
    ]}


def prepare_behavior_card(meta, brief):
    """Add missing authoring structure in place without replacing authored values."""
    meta.setdefault('capabilities', [])
    checks = meta.setdefault('capability_checks', {})
    for capability in meta['capabilities']:
        checks.setdefault(capability, [])
    implementation = meta.setdefault('implementation', {})
    for key, value in {'controllers': [], 'camera': '', 'input_model': '', 'catalog_skips': []}.items():
        implementation.setdefault(key, value)
    if not meta.get('input_checks'):
        meta['input_checks'] = [{'name': '', 'actions': [], 'expect': {},
                                 'settle_ms': 100, 'persist_ms': 100}]
    if not meta.get('signature_actions'):
        meta['signature_actions'] = [{
            'id': 'core_action', 'brief_refs': ['/core_verb'], 'action': brief['core_verb'],
            'success_checks': [], 'boundary': {'checks': []}, 'feedback': '',
        }]


def blank_strategy(data):
    """True when `data` is an untouched draft of either scope.

    A promoted run carries its strategy forward, but an unedited draft is
    scaffolding: it must not outrank a selected or project-level card, and the
    next stage redraws it for its own scenario sequence.
    """
    try:
        value = json.loads(data)
    except (TypeError, ValueError):
        return False

    return any(value == starter_strategy(scope) for scope in ('closure', 'acceptance'))


def starter_strategy(scope='acceptance'):
    """Draft the scenario sequence the requested scope proves.

    Behaviour prepares a closure draft (one terminal outcome, then a restarted
    running round); acceptance inherits and extends it to the full sequence. The
    format is shared so a stage move never rewrites an authored strategy.
    """
    if scope not in ('closure', 'acceptance'):
        raise ValueError(f'unknown strategy scope: {scope}')
    outcomes = ('WON', 'RUNNING') if scope == 'closure' else ('WON', 'LOST', 'WON')
    return {
        'interaction_events': [],
        'restart_actions': [],
        'scenarios': [{'expect': outcome, 'rules': []} for outcome in outcomes],
    }
