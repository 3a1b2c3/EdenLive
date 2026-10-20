"""Bound browser actions and read-only predicates, shared across gates."""
import math


def field(snapshot, path):
    if not isinstance(path, str) or not path or any(not key for key in path.split('.')):
        raise ValueError('observation path must be a nonempty dotted string')
    value = snapshot
    for key in path.split('.'):
        if not isinstance(value, dict) or key not in value:
            raise ValueError(f'missing observation: {path}')
        value = value[key]
    return value


def validate_condition(condition):
    if not isinstance(condition, dict) or any(not isinstance(k, str) or not k or any(not p for p in k.split('.')) for k in condition):
        raise ValueError('conditions require dotted observation paths')
    for value in condition.values():
        if isinstance(value, dict) and any(str(k).startswith('$') for k in value):
            if set(value) - {'$eq', '$ne', '$gt', '$gte', '$lt', '$lte'}:
                raise ValueError('unknown comparison operator')
            for op, operand in value.items():
                if op not in ('$eq', '$ne') and (type(operand) not in (int, float) or not math.isfinite(operand)):
                    raise ValueError('ordered comparison requires a finite number')


def matches(snapshot, condition, *, strict=True):
    """Evaluate one condition against one observation.

    An asserted expectation must resolve, so `strict` (the default) reports an
    unreadable observation as an authoring error. Playthrough rules select which
    input to send next, and a mode that legitimately omits another mode's fields
    must not end the round: `strict=False` reads an unresolved path or a
    non-numeric ordered comparison as "this rule does not apply right now".
    Malformed condition syntax stays an error either way.
    """
    if not isinstance(condition, dict):
        raise ValueError('observation condition must be an object')
    validate_condition(condition)
    for key, value in condition.items():
        try:
            actual = field(snapshot, key)
        except ValueError:
            if strict: raise
            return False
        if isinstance(value, dict) and any(str(k).startswith('$') for k in value):
            for op, operand in value.items():
                if op == '$eq': ok = equal(actual, operand)
                elif op == '$ne': ok = not equal(actual, operand)
                else:
                    if type(actual) not in (int, float) or not math.isfinite(actual):
                        if strict:
                            raise ValueError(f'{key}: ordered comparison requires a finite observed number')
                        return False
                    ok = {'$gt': actual > operand, '$gte': actual >= operand, '$lt': actual < operand, '$lte': actual <= operand}[op]
                if not ok: return False
        elif not equal(actual, value):
            return False
    return True


def resolves(snapshot, path):
    """Whether one observation path is readable right now; never raises for a miss."""
    try:
        field(snapshot, path)
        return True
    except ValueError:
        return False


def equal(left, right):
    """JSON equality without Python's True == 1 coercion; numeric 1 == 1.0 is valid."""
    if isinstance(left, bool) or isinstance(right, bool):
        return type(left) is type(right) and left == right
    if isinstance(left, dict) and isinstance(right, dict):
        return left.keys() == right.keys() and all(equal(left[k], right[k]) for k in left)
    if isinstance(left, list) and isinstance(right, list):
        return len(left) == len(right) and all(equal(a, b) for a, b in zip(left, right))
    return left == right


def validate_action(action):
    if not isinstance(action, dict):
        raise ValueError('action must be an object')
    kind = action.get('type')
    fields = {
        'tap': {'key', 'hold_ms'}, 'down': {'key'}, 'up': {'key'},
        'move': {'x', 'y'}, 'click': {'x', 'y', 'button'},
        'pointer_down': {'button'}, 'pointer_up': {'button'},
    }
    if kind not in fields or set(action) - (fields[kind] | {'type'}):
        raise ValueError('only bound keyboard/pointer actions are allowed')
    if kind in ('tap', 'down', 'up') and (not isinstance(action.get('key'), str) or not action['key'].strip()):
        raise ValueError('keyboard action requires a key')
    if kind == 'tap' and (type(action.get('hold_ms', 35)) is not int or not 0 <= action.get('hold_ms', 35) <= 5000):
        raise ValueError('tap hold_ms must be 0..5000')
    if kind in ('move', 'click'):
        for axis in ('x', 'y'):
            v = action.get(axis)
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v):
                raise ValueError(f'pointer action requires finite {axis}')
    if 'button' in fields[kind] and action.get('button', 'left') not in ('left', 'middle', 'right'):
        raise ValueError('invalid pointer button')


def act(page, action, held=None):
    validate_action(action)
    kind = action['type']
    if kind == 'tap':
        page.keyboard.down(action['key'])
        page.wait_for_timeout(action.get('hold_ms', 35))
        page.keyboard.up(action['key'])
    elif kind in ('down', 'up'):
        getattr(page.keyboard, kind)(action['key'])
    elif kind == 'move':
        page.mouse.move(action['x'], action['y'])
    elif kind == 'click':
        page.mouse.click(action['x'], action['y'], button=action.get('button', 'left'))
    else:
        getattr(page.mouse, kind.removeprefix('pointer_'))(button=action.get('button', 'left'))
    if held is not None:
        if kind == 'down': held.add(action['key'])
        if kind in ('up', 'tap'): held.discard(action['key'])


def release_inputs(page, held=None, *, dispatch=None):
    send = dispatch or (lambda action: act(page, action, held))
    if held is not None:
        for key in sorted(held): send({'type': 'up', 'key': key})
    for button in ('left', 'middle', 'right'):
        send({'type': 'pointer_up', 'button': button})


def reconcile_keys(page, desired, held, *, dispatch=None):
    """Only send changed held keys; no snapshot or game-specific policy here."""
    actions = []
    for kind, keys in (('up', held - desired), ('down', desired - held)):
        for key in sorted(keys):
            action = {'type': kind, 'key': key}
            if dispatch is None:
                act(page, action, held)
            else:
                dispatch(action)
            actions.append(action)
    return actions


def check_inputs(page, checks, evidence=None):
    """Sequential input cases; expected state must survive the declared wait."""
    if not isinstance(checks, list) or not checks:
        return ['input checks not evaluated: declare input_checks or supply a separate input review']
    problems, meaningful, held = [], False, set()
    try:
        for case in checks:
            if not isinstance(case, dict):
                raise ValueError('input case must be an object')
            name = case.get('name', 'unnamed')
            if not isinstance(case.get('actions'), list) or not case['actions'] or not isinstance(case.get('expect'), dict) or not case['expect']:
                raise ValueError(f'{name}: actions and nonempty expect are required')
            before = page.evaluate('() => window.__gameTest.read()')
            validate_condition(case['expect'])
            if case.get('before') and not matches(before, case['before']):
                problems.append(f'{name}: precondition does not match')
                break
            for action in case['actions']:
                act(page, action, held)
            for wait_key, default in (('settle_ms', 100), ('persist_ms', 100)):
                delay = case.get(wait_key, default)
                if isinstance(delay, bool) or not isinstance(delay, int) or not 0 <= delay <= 5000:
                    raise ValueError(f'{name}: {wait_key} must be 0..5000')
                page.wait_for_timeout(delay)
                after = page.evaluate('() => window.__gameTest.read()')
                if evidence is not None:
                    evidence.append({'name': name, 'phase': wait_key, 'before': before, 'after': after, 'actions': case['actions'], 'expect': case['expect']})
                if not matches(after, case['expect']):
                    problems.append(f'{name}: expected gameplay state not observed after {wait_key}: {case["expect"]}')
            meaningful |= any(not equal(field(before, key), field(after, key)) for key in case['expect'])
        if not meaningful:
            problems.append('no input check changes an asserted gameplay field')
    finally:
        release_inputs(page, held)
    return problems
