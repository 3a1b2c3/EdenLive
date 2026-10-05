"""Input-only browser playthrough. JSON strategy cannot execute code or mutate game state.

Two scopes share this executor, its observation reads and its evidence format.
`acceptance` proves the full WON/LOST/WON sequence with the final UI integrated.
`closure` is the behaviour stage's smaller proof: one representative terminal
outcome, a real same-page restart and a fresh round that still accepts effective
input. A closure pass never stands in for acceptance; each report names its own
scope so a narrower run cannot be read as the full verdict.
"""
import argparse
import json
import math
import statistics
import sys
import time
import uuid
from pathlib import Path

from check_step1 import canvas_report, find_chromium, serving
from _shared.browser_input import field, matches, resolves, act, validate_action, release_inputs, reconcile_keys, validate_condition
from _shared.constants import MAX_WALL_SECONDS, DEFAULT_WALL_SECONDS
from _shared.paths import resolve_inside
from _shared.run_contract import validation_budget, validate_budget, read_meta
from _shared.runtime import browser_args, install_runtime_probe, runtime_report
from _shared.image_review import preflight as image_preflight
from _shared.attempts import stage_snapshot, record_stage, sha256_file
from _shared.diagnostics import diagnose
from _shared.starters import starter_strategy

ROOT = Path(__file__).resolve().parents[1]


SCOPES = ('acceptance', 'closure')

# Every report states what its own run proves. A narrower scope must never read as
# the full verdict, so the claim travels with the evidence instead of the gate ID.
SCOPE_CLAIMS = {
    'acceptance': 'win, deliberate loss and a win after real restart, with the final UI integrated',
    'closure': 'one representative terminal outcome, a real same-page restart and a fresh round that '
               'still accepts effective input; the other terminal branch is not evaluated here',
}

# Scenario counts differ by scope, so a closure report can never be mistaken for
# the full acceptance sequence. Closure proves one representative terminal, a real
# restart and a fresh round that still accepts effective input.
SCENARIO_COUNT = {'acceptance': 3, 'closure': 2}


def expected_sequence(plan, scope):
    observed = [s.get('expect') for s in plan['scenarios']]
    if scope == 'acceptance':
        return observed == ['WON', 'LOST', 'WON'], 'scenarios must be WON, LOST, WON (restart/replay)'
    return (observed[0] in ('WON', 'LOST') and observed[1] == 'RUNNING',
            'closure scenarios must be one terminal outcome (WON or LOST), then RUNNING after a real restart')


def validate_strategy(plan, scope='acceptance'):
    if scope not in SCOPES:
        raise ValueError(f'unknown strategy scope: {scope}')
    count = SCENARIO_COUNT[scope]
    if not isinstance(plan, dict) or not isinstance(plan.get('scenarios'), list) or len(plan['scenarios']) != count:
        raise ValueError('strategy requires win, loss, replay scenarios' if scope == 'acceptance'
                         else 'closure strategy requires one terminal scenario and one restarted RUNNING scenario')
    if set(plan) - {'scenarios', 'interaction_events', 'restart_actions', 'start_actions', 'capture_when'}:
        raise ValueError('unknown strategy field')
    if not all(isinstance(s, dict) for s in plan['scenarios']):
        raise ValueError('scenarios must be objects')
    ordered, reason = expected_sequence(plan, scope)
    if not ordered:
        raise ValueError(reason)
    if not isinstance(plan.get('interaction_events'), list) or not plan['interaction_events'] or not all(isinstance(s, str) and s.strip() for s in plan['interaction_events']):
        raise ValueError('declare meaningful gameplay interaction_events')
    if not plan.get('restart_actions'):
        raise ValueError('restart_actions required')
    for name in ('restart_actions', 'start_actions'):
        if name in plan and (not isinstance(plan[name], list) or not plan[name]):
            raise ValueError(f'{name} must be a nonempty action list')
    for action in plan.get('restart_actions', []) + plan.get('start_actions', []):
        validate_action(action)
    for scenario in plan['scenarios']:
        if not isinstance(scenario.get('rules'), list):
            raise ValueError('scenario requires a rules array (empty is allowed)')
        for rule in scenario.get('rules', []):
            if not isinstance(rule, dict) or not isinstance(rule.get('when'), dict):
                raise ValueError('rule requires observation conditions')
            if set(rule) - {'when', 'hold', 'action', 'once', 'cooldown_ms'}:
                raise ValueError('unknown rule field')
            validate_condition(rule['when'])
            if 'hold' in rule:
                if 'action' in rule or not isinstance(rule['hold'], list) or any(not isinstance(k, str) or not k.strip() for k in rule['hold']):
                    raise ValueError('hold must be a list of keys, without action')
                if 'once' in rule or 'cooldown_ms' in rule:
                    raise ValueError('held intent has no once/cooldown; change its condition to release')
                continue
            cooldown = rule.get('cooldown_ms', 100)
            if isinstance(cooldown, bool) or not isinstance(cooldown, (int, float)) or not math.isfinite(cooldown) or cooldown < 0:
                raise ValueError('cooldown_ms must be a finite nonnegative number')
            if 'once' in rule and not isinstance(rule['once'], bool):
                raise ValueError('once must be boolean')
            action = rule.get('action', {})
            validate_action(action)
            if action['type'] in ('down', 'up'):
                raise ValueError('use hold sets for continuous keyboard intent')
    if 'capture_when' in plan:
        validate_condition(plan['capture_when'])


def verdict(snapshot, expected, interactions, actions, limit):
    if snapshot.get('state') != expected:
        return ('restarted round did not stay running' if expected == 'RUNNING'
                else 'expected terminal outcome not reached')
    elapsed = snapshot.get('elapsed')
    if isinstance(elapsed, bool) or not isinstance(elapsed, (float, int)) or not math.isfinite(elapsed) or not 0 <= elapsed <= limit:
        return 'invalid or over-budget simulation time'
    # A restarted round proves it accepts play, so it must not have ended and must
    # show real input reaching a meaningful gameplay event.
    if expected == 'RUNNING':
        if type(snapshot.get('terminalCount')) is not int or snapshot['terminalCount'] != 0:
            return 'restarted round already recorded a terminal event'
        if not interactions or not actions:
            return 'restarted round requires actual input and a meaningful gameplay event'
        return None
    if type(snapshot.get('terminalCount')) is not int or snapshot['terminalCount'] != 1:
        return 'expected exactly one real round terminal event'
    if expected == 'WON' and (not interactions or not actions):
        return 'win requires actual input and a meaningful gameplay event'
    return None


def snapshot(page, evidence=None):
    result = page.evaluate('() => window.__gameTest.read()')
    if evidence is not None:
        evidence['lastObservation'] = result  # Retain malformed observations too.
    if not isinstance(result, dict):
        raise ValueError('observation must be an object')
    for key in ('state', 'roundId', 'elapsed', 'terminalCount', 'events', 'frame'):
        if key not in result:
            raise ValueError(f'observation missing {key}')
    if type(result['terminalCount']) is not int or result['terminalCount'] < 0:
        raise ValueError('terminalCount must be a nonnegative integer')
    if not isinstance(result['events'], list) or any(not isinstance(e, dict) or type(e.get('id')) not in (int, str) or not isinstance(e.get('type'), str) for e in result['events']):
        raise ValueError('events must contain stable IDs and type strings')
    if len({e['id'] for e in result['events']}) != len(result['events']):
        raise ValueError('duplicate event ID within the observation ring')
    if type(result['roundId']) not in (int, str):
        raise ValueError('roundId must be an integer or string')
    frame = result['frame']
    if not isinstance(frame, dict) or type(frame.get('id')) not in (int, str):
        raise ValueError('frame requires a stable id')
    for label, value in [('elapsed', result['elapsed']), ('frame.rawDt', frame.get('rawDt')), ('frame.simDt', frame.get('simDt'))]:
        if type(value) not in (int, float) or not math.isfinite(value) or value < 0:
            raise ValueError(f'{label} must be a finite nonnegative number')
    return result


def collect_events(state, seen, interactions, allowed, *, baseline_ids=()):
    """Collect new events, excluding the reset/bootstrap baseline when requested.

    A game may expose an event ring that still contains events produced while the
    restart input was being handled. Those events describe the reset, not the
    fresh round's play. The baseline is represented by stable event IDs observed
    immediately after reset; only events first seen after that point can satisfy a
    RUNNING closure scenario.
    """
    for event in state['events']:
        if event['id'] in seen:
            if seen[event['id']] != event:
                raise ValueError('event ID reused or event changed within the round')
            continue
        seen[event['id']] = event
        if event['id'] not in baseline_ids and event['type'] in allowed:
            interactions.append(event)


def dispatched_actions(trace, *, play_only=False):
    """Return successful inputs, optionally restricted to the gameplay phase."""
    return [row for row in trace
            if row['status'] == 'dispatched'
            and (row['phase'] == 'play' if play_only else row['phase'] != 'release')]


def dispatch_input(page, action, held, trace, *, began, phase, state=None, rules=(), paths=()):
    """Record the dispatch before attempting it; a transport error may be partial."""
    row = {'sequence': len(trace) + 1, 'phase': phase, 'action': action,
           'wallSeconds': time.monotonic() - began, 'status': 'attempted'}
    if state is not None:
        row.update(elapsed=state.get('elapsed'), roundId=state.get('roundId'),
                   frameId=state.get('frame', {}).get('id'))
        row['decisionObservation'] = {}
        for key in sorted(set(paths) | {'state'}):
            try:
                row['decisionObservation'][key] = field(state, key)
            except ValueError:
                # A nonmatching mode can legitimately omit another mode's fields.
                row.setdefault('unavailableDecisionFields', []).append(key)
    if rules:
        row['rules'] = list(rules)
    trace.append(row)
    started = time.monotonic()
    try:
        act(page, action, held)
        row['status'] = 'dispatched'
    except Exception as exc:
        row.update(status='dispatch_incomplete', error=f'{type(exc).__name__}: {exc}')
        raise
    finally:
        row['dispatchSeconds'] = time.monotonic() - started


def note_unresolved(record, snapshot, rules, resolved):
    """Track rules whose paths never resolved; a mistype looks like a false condition otherwise."""
    for rid, rule in enumerate(rules):
        if all(resolves(snapshot, path) for path in rule['when']):
            resolved.add(rid)
    record['unresolvedRules'] = [
        {'rule': rid, 'when': sorted(rule['when'])}
        for rid, rule in enumerate(rules) if rid not in resolved]


def apply_rules(page, state, scenario, last_action, fired, held, trace, *, began=None):
    # Conditions share one observation. Matching hold rows contribute a union;
    # dependent actions wait for the next observed state.
    began = time.monotonic() if began is None else began
    desired = set(); hold_rules = []; hold_paths = set()
    for rid, rule in enumerate(scenario['rules']):
        if 'hold' in rule:
            hold_paths.update(rule['when'])
        if 'hold' in rule and matches(state, rule['when'], strict=False):
            desired.update(rule['hold'])
            hold_rules.append(rid)
    reconcile_keys(page, desired, held, dispatch=lambda action: dispatch_input(
        page, action, held, trace, began=began, phase='play', state=state,
        rules=hold_rules, paths=hold_paths))
    for rid, rule in enumerate(scenario['rules']):
        if 'hold' in rule:
            continue
        now = time.monotonic()
        if rule.get('once') and rid in fired:
            continue
        if matches(state, rule['when'], strict=False) and now - last_action.get(rid, -1e9) >= rule.get('cooldown_ms', 100) / 1000:
            action = rule['action']
            if action['type'] == 'tap' and action['key'] in held:
                raise ValueError('one key cannot be both held and tapped in a decision')
            dispatch_input(page, action, held, trace, began=began, phase='play',
                           state=state, rules=[rid], paths=rule['when'])
            last_action[rid] = now
            fired.add(rid)


def install_capture_clock(page):
    # Rendering-only instrumentation. Never enabled during input/performance scenarios.
    page.add_init_script("""(() => {
      const raf = window.requestAnimationFrame.bind(window);
      const pending = new Map(); let paused = false;
      window.requestAnimationFrame = callback => {
        const id = raf(time => { if (paused) pending.set(id, callback); else callback(time); });
        return id;
      };
      const cancel = window.cancelAnimationFrame.bind(window);
      window.cancelAnimationFrame = id => { pending.delete(id); cancel(id); };
      window.__captureClock = Object.freeze({
        pause: () => { paused = true; },
        resume: () => { paused = false; for (const cb of pending.values()) raf(cb); pending.clear(); }
      });
    })();""")


def capture_frozen(page, path):
    """Visual evidence only: suspend RAF callbacks in a separate capture replay.

    Virtual time alone does not stop screenshot-driven RAF in all Chromium builds.
    The observed frame must remain stable; timer/worker-driven games fail explicitly.
    """
    observed = page.evaluate('() => { window.__captureClock.pause(); return window.__gameTest.read(); }')
    try:
        capture = image_preflight(page, retries=0, path=path)
        if capture['status'] != 'channel_ready':
            raise ValueError(f"image channel unavailable: {capture.get('reason', 'unknown')}")
        after = snapshot(page)
        if after != observed:
            raise ValueError('capture changed observed state; use a timer/worker-aware capture adapter')
        return after
    finally:
        page.evaluate('() => window.__captureClock.resume()')


def restart(page, plan, previous_round, held, *, dispatch=None):
    actions = plan['restart_actions']
    for action in actions:
        if dispatch is None: act(page, action, held)
        else: dispatch(action)
    page.wait_for_function("previous => window.__gameTest.read().roundId !== previous", arg=previous_round)
    return actions


def new_report(scope='acceptance'):
    return {'scope': {'id': scope, 'proves': SCOPE_CLAIMS[scope]},
            'functional': {'status': 'not_evaluated'},
            'experience': {'status': 'not_evaluated', 'reason': 'human/player review required'},
            'performance': {'status': 'not_evaluated'},
            'imageReview': {'status': 'not_evaluated', 'reason': 'no screenshot channel attempt yet'},
            'execution': {'phase': 'configuration', 'scenario': None}, 'scenarios': [], 'errors': []}


def fail_report(report, reason):
    report['functional'] = {'status': 'failed', 'reason': reason}
    report.setdefault('failure', {**report['execution'], 'reason': reason,
                                 'inputSequence': len(report['scenarios'][-1]['inputTrace']) if report['scenarios'] else 0,
                                 'reproduction': 'not_attempted'})


def run(page, url, plan, output, *, sim_limit, wall_limit=DEFAULT_WALL_SECONDS, capabilities=(), ui_required=True, report=None,
        scope='acceptance'):
    report = new_report(scope) if report is None else report
    held = set()
    try:
        execute(page, url, plan, output, report, held, sim_limit=sim_limit,
                wall_limit=wall_limit, capabilities=capabilities, ui_required=ui_required, scope=scope)
    except Exception as exc:
        reason = f'{type(exc).__name__}: {exc}'
        fail_report(report, reason)
        if report['scenarios']:
            record = report['scenarios'][-1]
            if record['status'] == 'not_evaluated':
                record.update(status='failed', reason=reason)
                after_failure = {}
                try:
                    snapshot(page, after_failure)
                except Exception:
                    pass  # The first failure and last available observation remain authoritative.
                if 'lastObservation' in after_failure:
                    record['afterFailure'] = after_failure['lastObservation']
    finally:
        try:
            release_inputs(page, held)
        except Exception as exc:
            reason = f'input cleanup: {type(exc).__name__}: {exc}'
            report['errors'].append(reason)
            if 'failure' not in report:
                report['execution'] = {'phase': 'cleanup', 'scenario': None}
                fail_report(report, reason)
    return report


def execute(page, url, plan, output, report, held, *, sim_limit, wall_limit, capabilities, ui_required,
            scope='acceptance'):
    validate_strategy(plan, scope)
    validate_budget(sim_limit)
    errors = report['errors']
    def browser_error(reason):
        errors.append(reason)
        fail_report(report, reason)
    page.on('pageerror', lambda e: browser_error(str(e)))
    page.on('console', lambda m: browser_error(m.text) if m.type == 'error' else None)
    page.on('requestfailed', lambda r: browser_error(f'{r.url}: {r.failure}'))
    page.on('response', lambda r: browser_error(f'HTTP {r.status}: {r.url}') if r.status >= 400 else None)
    install_capture_clock(page)
    install_runtime_probe(page)
    report['execution'] = {'phase': 'boot', 'scenario': None}
    page.goto(url, wait_until='load')
    page.wait_for_function('''() => document.getElementById('fatal')?.style.display === 'block'
        || typeof window.__gameTest?.read === 'function' ''')
    boot = canvas_report(page)
    if not boot['ok']:
        raise ValueError(boot['reason'])
    from check_ui import integrated_review
    report['ui'] = [integrated_review(page, required=ui_required)]
    errors.extend(report['ui'][-1].get('errors', []))
    startup = plan.get('start_actions', [])
    previous_round = None
    all_frames = []
    image_available = None
    for index, scenario in enumerate(plan['scenarios']):
        began = time.monotonic(); trace = []; seen = {}; interactions = []; frames = []; last_frame = None; last_action = {}; fired = set(); resolved_rules = set()
        record = {'index': index + 1, 'expected': scenario['expect'], 'status': 'not_evaluated',
                  'reason': None, 'previousRoundId': previous_round, 'before': None, 'start': None,
                  'lastObservation': None, 'interactions': interactions, 'inputTrace': trace,
                  'events': [], 'frames': frames}
        report['scenarios'].append(record)
        report['execution'] = {'phase': 'start' if not index else 'restart', 'scenario': index + 1}
        before = snapshot(page, record)
        record['before'] = before
        release_inputs(page, held, dispatch=lambda action: dispatch_input(
            page, action, held, trace, began=began, phase='release', state=before))
        def bootstrap_input(action):
            dispatch_input(page, action, held, trace, began=began,
                           phase=report['execution']['phase'], state=before)
        bootstrap = restart(page, plan, previous_round, held, dispatch=bootstrap_input) if index else startup
        if not index:
            for action in bootstrap:
                bootstrap_input(action)
        start = snapshot(page, record)
        record['start'] = start
        expected_count = {'RUNNING': 0, 'WON': 1, 'LOST': 1}.get(start['state'])
        if expected_count is None or start['terminalCount'] != expected_count or (index and start['roundId'] == previous_round):
            raise ValueError('fresh round/reset not observed')
        # A RUNNING closure scenario must prove input after the restart has
        # settled. Seed the event ring at that boundary so a restart-generated
        # interaction, or an event retained from the prior round, cannot count as
        # fresh gameplay. Terminal scenarios keep their existing behavior: an
        # immediate terminal consequence of a required start/restart action is
        # allowed when its event is observed in the new round.
        baseline_ids = set()
        if scenario['expect'] == 'RUNNING':
            baseline_ids = {event['id'] for event in start['events']}
            for event in start['events']:
                seen[event['id']] = event
            record['events'] = list(seen.values())
        previous_round = start['roundId']
        play_began = time.monotonic()
        report['execution']['phase'] = 'play'
        stats = {'decisions': 0, 'snapshots': 0, 'snapshotSeconds': 0, 'dispatchSeconds': 0, 'maxDispatchSeconds': 0}
        record['scheduler'] = stats
        diagnostic_trace = []
        def observe(page):
            t = time.monotonic()
            value = snapshot(page, record)
            stats['snapshots'] += 1
            stats['snapshotSeconds'] += time.monotonic() - t
            if value['roundId'] != previous_round:
                raise ValueError('unexpected round reset during playthrough')
            collect_events(value, seen, interactions, plan['interaction_events'], baseline_ids=baseline_ids)
            record['events'] = list(seen.values())
            note_unresolved(record, value, scenario['rules'], resolved_rules)
            diagnostic = diagnose(value, capabilities)
            if diagnostic['status'] == 'observed' and (not diagnostic_trace or diagnostic_trace[-1]['fields'] != diagnostic):
                sample = {'elapsed': value['elapsed'], 'fields': diagnostic}
                if len(diagnostic_trace) < 64:
                    diagnostic_trace.append(sample)
                else:
                    diagnostic_trace[-1] = sample  # Retain early causes and the latest sample.
                record['diagnostics'] = {'samples': diagnostic_trace, 'limit': 64, 'scope': 'changed fields from existing decision observations'}
            return value
        while time.monotonic() - play_began < wall_limit:
            state = observe(page)
            frame = state['frame']
            if frame['id'] != last_frame:
                last_frame = frame['id']; frames.append(frame)
            if state['state'] in ('WON', 'LOST') or state['elapsed'] > sim_limit: break
            # A RUNNING scenario ends as soon as real input has produced a meaningful
            # gameplay event: waiting for a terminal it must not reach would only
            # spend the wall budget.
            if scenario['expect'] == 'RUNNING' and interactions and dispatched_actions(trace, play_only=True):
                break
            t = time.monotonic()
            apply_rules(page, state, scenario, last_action, fired, held, trace, began=began)
            dispatch = time.monotonic() - t
            stats['decisions'] += 1
            stats['dispatchSeconds'] += dispatch
            stats['maxDispatchSeconds'] = max(stats['maxDispatchSeconds'], dispatch)
            page.wait_for_timeout(10)
        else:
            # Refresh only when the wall deadline, rather than a terminal observation, ended the loop.
            state = observe(page)
        report['execution']['phase'] = 'terminal'
        actions = dispatched_actions(trace, play_only=scenario['expect'] == 'RUNNING')
        failure = verdict(state, scenario['expect'], interactions, actions, sim_limit)
        record['terminal'] = state
        if failure:
            fail_report(report, failure)
        page.wait_for_timeout(120)
        after = snapshot(page, record)
        record['afterTerminal'] = after
        collect_events(after, seen, interactions, plan['interaction_events'], baseline_ids=baseline_ids)
        record['events'] = list(seen.values())
        note_unresolved(record, after, scenario['rules'], resolved_rules)
        terminal_events = [e for e in seen.values() if e['type'] in ('round.won', 'round.lost')]
        if scenario['expect'] == 'RUNNING':
            # The restarted round must be genuinely fresh: no terminal event may
            # survive the reset, and it must still be running after settling.
            if terminal_events:
                failure = failure or 'restarted round retained a terminal event from the previous round'
            if after.get('state') != 'RUNNING' or after.get('roundId') != state.get('roundId'):
                failure = failure or 'restarted round did not stay in the same running round'
            failure = failure or verdict(after, 'RUNNING', interactions, actions, sim_limit)
        else:
            expected_event = 'round.won' if scenario['expect'] == 'WON' else 'round.lost'
            if len(terminal_events) != 1 or terminal_events[0]['type'] != expected_event:
                failure = failure or 'real round terminal event missing, duplicated or inconsistent'
            if any(after.get(key) != state.get(key) for key in ('state', 'terminalCount', 'roundId', 'outcomeReason')):
                failure = failure or 'terminal state is unstable or emits duplicates'
        wall = time.monotonic() - play_began
        stats.update(snapshotsPerSecond=stats['snapshots']/wall, decisionsPerSecond=stats['decisions']/wall,
                     limitation='decision loop only; dispatch includes input transport/hold waits, not game response latency')
        record.update(status='failed' if failure else 'passed', reason=failure, wallSeconds=wall)
        all_frames.extend(frames)
        if failure:
            fail_report(report, failure)
        if index < len(plan['scenarios']) - 1:
            report['ui'].append(integrated_review(page, required=ui_required))
            errors.extend(report['ui'][-1].get('errors', []))
        report['execution']['phase'] = 'image'
        if image_available is not False:
            image = image_preflight(page, retries=2 if image_available is None else 0,
                                    path=output / f'scenario-{index+1}.png')
            image_available = image['status'] == 'channel_ready'
            record['imageReview'] = image
            report['imageReview'] = image
        else:
            record['imageReview'] = {'status': 'not_evaluated', 'review': 'not_evaluated',
                                     'attempts': 0, 'reason': 'image channel unavailable; further attempts skipped'}
        if failure or errors: break
    release_inputs(page, held)
    raw = [f['rawDt'] * 1000 for f in all_frames if isinstance(f.get('rawDt'), (float, int)) and math.isfinite(f['rawDt']) and f['rawDt'] > 0]
    report['execution']['phase'] = 'runtime'
    report['runtime'] = runtime_report(page, capabilities)
    report['diagnostics'] = report['runtime'].get('diagnostics', {'status': 'not_applicable', 'reason': 'game did not expose optional diagnostics'})
    renderer = report['runtime']['renderer']
    report['performance'] = {'status': 'measured' if raw else 'not_evaluated', 'renderer': renderer, 'sampleCount': len(raw), 'medianRawFrameMs': statistics.median(raw) if raw else None, 'p95RawFrameMs': sorted(raw)[min(len(raw)-1, int(len(raw)*.95))] if raw else None, 'rawExceedsSimFrames': sum(f.get('rawDt', 0) > f.get('simDt', math.inf) + 1e-6 for f in all_frames), 'heap': 'not_evaluated', 'limitation': 'sampled frames, not exhaustive; raw > sim may mean backlog, pause or discrete play, not lost time; software rendering cannot establish hardware performance or novice reaction fairness'}
    # Capture is a separate replay; pausing never contaminates measured playthrough timing.
    condition = plan.get('capture_when') if 'failure' not in report and not errors else None
    if condition and image_available is False:
        report['capture'] = {'status': 'not_evaluated', 'reason': 'image channel unavailable; capture replay skipped'}
    elif condition:
        try:
            restart(page, plan, previous_round, held); began = time.monotonic(); captured = False
            last_action = {}; fired = set(); trace = []
            while time.monotonic() - began < min(wall_limit, 15):
                state = snapshot(page)
                if state['state'] in ('WON', 'LOST'): break
                if matches(state, condition, strict=False):
                    frozen = capture_frozen(page, output / 'transient.png')
                    if matches(frozen, condition, strict=False):
                        report['capture'] = {'status': 'captured', 'snapshot': frozen, 'timingEvidence': False}; captured = True; break
                apply_rules(page, state, plan['scenarios'][0], last_action, fired, held, trace)
                page.wait_for_timeout(5)
            if not captured: report['capture'] = {'status': 'not_evaluated', 'reason': 'requested transient condition was not frozen'}
        except Exception as exc:
            # A failed optional image must not discard completed round evidence.
            report['capture'] = {'status': 'not_evaluated', 'reason': f'{type(exc).__name__}: {exc}'}
    release_inputs(page, held)
    report['execution']['phase'] = 'final-check'
    final_boot = canvas_report(page)
    if not final_boot['ok']:
        errors.append(final_boot['reason'])
    report['functional']['status'] = 'passed' if len(report['scenarios']) == SCENARIO_COUNT[scope] and all(s['status'] == 'passed' for s in report['scenarios']) and not errors else 'failed'
    if errors and 'failure' not in report:
        fail_report(report, errors[0])


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    authoring = parser.add_mutually_exclusive_group()
    authoring.add_argument('--starter', action='store_true', help='print a strategy draft, or write a new --output file')
    authoring.add_argument('--validate-only', action='store_true', help='validate --strategy without browser, evidence or attempts')
    parser.add_argument('--scope', choices=SCOPES, default='acceptance',
                        help='acceptance proves WON/LOST/WON with the final UI; closure proves one '
                             'terminal outcome, a real restart and a fresh round that accepts input')
    parser.add_argument('--project-root', type=Path, help='root for runs, assets, npm, strategy and evidence (default: skill repository; strategy/output stay cwd-relative)')
    parser.add_argument('--runs'); parser.add_argument('--only')
    parser.add_argument('--strategy'); parser.add_argument('--output')
    parser.add_argument('--wall-seconds', type=float, default=DEFAULT_WALL_SECONDS,
                        help=f'per-scenario wall clock bound in seconds (at most {MAX_WALL_SECONDS}, '
                             'so three scenarios and a capture replay finish inside one gate batch)')
    parser.add_argument('--sim-seconds', type=float, help='override brief validation allowance (at most 300)')
    parser.add_argument('--hardware', action='store_true', help='omit forced SwiftShader; inspect actual renderer in report')
    parser.add_argument('--width', type=int, default=960)
    parser.add_argument('--height', type=int, default=640)
    parser.add_argument('--record-attempt', action='store_true',
                        help='append a hash-bound attempt record for the report')
    args = parser.parse_args(argv)
    # Each scope reads its own stage's runs unless the caller names a directory.
    if args.runs is None:
        args.runs = 'runs/step2' if args.scope == 'closure' else 'runs/step3'
    if args.starter:
        if args.strategy or args.only or args.record_attempt or args.project_root:
            parser.error('--starter accepts only --output for a destination')
        data = json.dumps(starter_strategy(args.scope), indent=2) + '\n'
        try:
            if args.output:
                with Path(args.output).open('x', encoding='utf-8') as stream:
                    stream.write(data)
            else:
                print(data, end='')
        except OSError as exc:
            print(f'error: {exc}', file=sys.stderr)
            return 2
        return 0
    if args.validate_only:
        if not args.strategy or args.output or args.only or args.record_attempt:
            parser.error('--validate-only requires --strategy and accepts no run, output or attempt')
        try:
            strategy = (resolve_inside(args.project_root.resolve(), args.strategy, '--strategy')
                        if args.project_root else Path(args.strategy))
            validate_strategy(json.loads(strategy.read_text(encoding='utf-8')), args.scope)
        except (OSError, ValueError) as exc:
            print(f'error: {exc}', file=sys.stderr)
            return 1
        print(f'{strategy}: {args.scope} strategy syntax OK')
        return 0
    if not args.only or not args.strategy or not args.output:
        parser.error('playthrough requires --only, --strategy and --output')
    project_root = (args.project_root or ROOT).resolve()
    evidence_root = project_root if args.project_root is not None else Path.cwd()
    try:
        if not 0 < args.wall_seconds <= MAX_WALL_SECONDS:
            raise ValueError(f'wall time budget must be > 0 and <= {MAX_WALL_SECONDS} seconds '
                             '(three scenarios plus a capture replay share one gate timeout)')
        if not 64 <= args.width <= 4096 or not 64 <= args.height <= 4096: raise ValueError('viewport must be 64..4096')
        runs_dir = resolve_inside(project_root, args.runs, '--runs')
        run_dir = (runs_dir / args.only).resolve()
        if run_dir.parent != runs_dir:
            raise ValueError('run must be one named directory inside the project root')
        runs_rel = runs_dir.relative_to(project_root).as_posix()
        output = (evidence_root / args.output).resolve()
        strategy = (evidence_root / args.strategy).resolve()
        report_path = output / 'report.json'
        replay_strategy = output / 'replay-strategy.json'
        if args.project_root is not None:
            output = resolve_inside(project_root, output, '--output')
            strategy = resolve_inside(project_root, strategy, '--strategy')
            report_path = resolve_inside(project_root, report_path, 'report')
            replay_strategy = resolve_inside(project_root, replay_strategy, 'replay strategy')
        if args.project_root is not None:
            names = [f'scenario-{index}.png' for index in range(1, SCENARIO_COUNT[args.scope] + 1)]
            names.append('transient.png')
            for name in names:
                resolve_inside(project_root, output / name, 'screenshot')
            # Reject outside paths before any output, but retain malformed JSON
            # as a recordable checker failure in the execution block below.
            try:
                meta = read_meta(run_dir)
            except ValueError:
                meta = {}
            if isinstance(meta.get('brief'), str):
                resolve_inside(project_root, run_dir / meta['brief'], 'brief')
    except (OSError, ValueError) as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 2
    try:
        output.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f'error: {exc}', file=sys.stderr)
        return 2
    from _shared.ui_evidence import snapshot as ui_snapshot
    ui_inputs = inputs = None
    report = new_report(args.scope)
    report['replay'] = {
        'strategyPath': str(strategy), 'settings': {
            'viewport': {'width': args.width, 'height': args.height},
            'deviceScaleFactor': 2, 'hardwareRequested': args.hardware,
            'wallSeconds': args.wall_seconds, 'simSecondsOverride': args.sim_seconds},
        'scope': 'fresh page, then all preceding scenarios and real restart inputs in order',
        'limitation': 'recipe and observed dispatches, not deterministic replay; source files are hashed, not archived; unexposed randomness, timers and external state may differ',
    }
    try:
        # Keep the actual strategy bytes even when parsing or later execution fails.
        strategy_bytes = strategy.read_bytes()
        if replay_strategy != strategy:
            replay_strategy.write_bytes(strategy_bytes)
        report['replay'].update(strategyCopy=str(replay_strategy), strategySha256=sha256_file(replay_strategy))
        ui_inputs = ui_snapshot(project_root, run_dir)
        # The strategy is a declared dependency, so editing keys, conditions or click
        # targets invalidates an earlier pass instead of reusing it.
        inputs = stage_snapshot(project_root, run_dir, [strategy], kind=args.scope, settings={
            'width': args.width, 'height': args.height, 'hardware': args.hardware,
            'sim_seconds': args.sim_seconds, 'wall_seconds': args.wall_seconds,
            'device_scale_factor': 2}) if args.record_attempt else None
        sim_limit, budget_source = validation_budget(run_dir, args.sim_seconds, project_root=args.project_root)
        report['validationBudget'] = {'seconds': sim_limit, 'source': budget_source}
        # Absolute argv avoids cwd and shell-quoting ambiguity. A new directory retains the failed evidence.
        command = [sys.executable, str(Path(__file__).resolve()), '--project-root', str(project_root),
                   '--scope', args.scope,
                   '--runs', runs_rel, '--only', args.only, '--strategy', str(replay_strategy),
                   '--output', str(output.with_name(output.name + '-retest-' + uuid.uuid4().hex[:8])),
                   '--wall-seconds', str(args.wall_seconds), '--sim-seconds', str(sim_limit),
                   '--width', str(args.width), '--height', str(args.height)]
        if args.hardware: command.append('--hardware')
        if args.record_attempt: command.append('--record-attempt')
        # With no explicit root, diagnostic evidence may live outside the skill checkout.
        if args.project_root is None:
            del command[2:4]
        report['replay']['argv'] = command
        plan = json.loads(strategy_bytes)
        validate_strategy(plan, args.scope)
        report['execution']['phase'] = 'launch'
        from playwright.sync_api import sync_playwright
        with serving(runs_dir, runs_rel, project_root) as base, sync_playwright() as p:
            browser = p.chromium.launch(headless=True, executable_path=find_chromium(), args=browser_args(args.hardware))
            try:
                report['replay']['browserVersion'] = browser.version
                page = browser.new_page(viewport={'width': args.width, 'height': args.height}, device_scale_factor=2)
                page.set_default_timeout(min(15000, args.wall_seconds * 1000))
                run(page, f'{base}/{runs_rel}/{args.only}/', plan, output, report=report,
                             wall_limit=args.wall_seconds, sim_limit=sim_limit, scope=args.scope,
                             capabilities=read_meta(run_dir).get('capabilities', []),
                             # Closure runs before the final UI exists, so it records integrated UI
                             # observations without requiring them. Acceptance still requires them.
                             ui_required=args.scope == 'acceptance' and json.loads(resolve_inside(project_root, run_dir / read_meta(run_dir)['brief'], 'brief').read_text()).get('ui', {}).get('mode') != 'none')
            finally: browser.close()
        if ui_snapshot(project_root, run_dir) != ui_inputs:
            report['execution'] = {'phase': 'source-check', 'scenario': None}
            fail_report(report, 'artifact changed during verification')
    except Exception as exc:
        fail_report(report, f'{type(exc).__name__}: {exc}')
    report['inputs'] = ui_inputs
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    if args.record_attempt and inputs is not None:
        # Closure keeps its own ledger ID so its narrower proof can never be read as
        # the behaviour stage's capability check or as full acceptance.
        check_id = 'step3' if args.scope == 'acceptance' else 'step2-closure'
        record_stage(project_root, run_dir, f"{check_id}:{args.only}", report_path, report, inputs)
    print(json.dumps({k: report[k] for k in ('functional', 'experience', 'performance')}, ensure_ascii=False))
    return 0 if report['functional']['status'] == 'passed' else 1

if __name__ == '__main__':
    raise SystemExit(main())
