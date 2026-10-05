"""Readiness checks for brief-derived actions; semantic fidelity still needs review."""
from _shared.browser_input import equal, field

GENERIC_FIELDS = {'state', 'elapsed', 'roundId', 'terminalCount', 'score', 'frame.id'}


def signature_problems(meta, brief=None):
    actions = meta.get('signature_actions')
    if not isinstance(actions, list) or not actions:
        return ['signature_actions must cover the defining actions in the brief']
    checks = meta.get('input_checks', [])
    names = [c.get('name') for c in checks if isinstance(c, dict)]
    if len(names) != len(set(names)):
        return ['input check names must be unique for signature evidence']
    problems, ids = [], set()
    for action in actions:
        if not isinstance(action, dict):
            problems.append('signature action must be an object')
            continue
        aid = action.get('id', 'unnamed')
        if aid in ids:
            problems.append(f'duplicate signature action: {aid}')
        ids.add(aid)
        if not action.get('action') or not action.get('feedback', '').strip():
            problems.append(f'{aid}: describe the action and its visible feedback')
        refs = action.get('brief_refs', [])
        if not refs:
            problems.append(f'{aid}: link the defining brief fields')
        if brief is not None:
            for ref in refs:
                try:
                    value = brief
                    if not isinstance(ref, str) or not ref.startswith('/'):
                        raise ValueError()
                    for key in ref[1:].split('/'):
                        key = key.replace('~1', '/').replace('~0', '~')
                        value = value[int(key)] if isinstance(value, list) else value[key]
                except (ValueError, TypeError, KeyError, IndexError):
                    problems.append(f'{aid}: unresolved brief reference {ref}')
        success = action.get('success_checks', [])
        boundary = action.get('boundary', {})
        if not isinstance(boundary, dict):
            problems.append(f'{aid}: boundary must name checks or a skip reason')
            continue
        if not success:
            problems.append(f'{aid}: success_checks not evaluated')
        if not boundary.get('checks') and not boundary.get('skip_reason', '').strip():
            problems.append(f'{aid}: add boundary/repeat/release checks or a reason to skip')
        if boundary.get('checks') and boundary.get('skip_reason'):
            problems.append(f'{aid}: boundary cannot be checked and skipped')
        for name in success + boundary.get('checks', []):
            if name not in names:
                problems.append(f'{aid}: unknown input check {name}')
        for name in success:
            case = next((c for c in checks if c.get('name') == name), {})
            if case and set(case.get('expect', {})) <= GENERIC_FIELDS:
                problems.append(f'{aid}: {name} needs a defining gameplay assertion, not just outcome/score')
    return problems


def signature_evidence_problems(meta, observations):
    """Check per-action changes using the existing input check's final observations."""
    changed_checks = set()
    for observation in observations:
        if observation['phase'] != 'persist_ms':
            continue
        if any(not equal(field(observation['before'], key), field(observation['after'], key))
               for key in set(observation['expect']) - GENERIC_FIELDS):
            changed_checks.add(observation['name'])
    return [f"{action['id']}: no success check changes an asserted defining gameplay field"
            for action in meta['signature_actions']
            if not changed_checks.intersection(action['success_checks'])]
