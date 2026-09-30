# SPDX-License-Identifier: Apache-2.0
"""Run with python integrations_v2/eden/tests/check_game_backend.py [--render]."""
import sys
import types
from pathlib import Path
import time

package = types.ModuleType('game_backend_check')
package.__path__ = [str(Path(__file__).resolve().parents[1] / 'apps/game2v')]
sys.modules[package.__name__] = package
from game_backend_check.game_timeline import GameTimeline

timeline = GameTimeline('boxed-in')
timeline.input.push('w', 'down')
timeline.input.push('w', 'up')
chunk = timeline.begin_chunk(12, 24)
assert chunk.simulation_tick_end == 30
assert [frame.game_frame_id for frame in chunk.frames if frame.capture_condition] == [1, 5, 9]
assert timeline.begin_chunk(12, 24).input_events == ()
assert [frame.game_frame_id for frame in timeline.begin_chunk(12, 24).frames if frame.capture_condition] == [25, 29, 33]
timeline.reset()
for _ in range(1000):
    timeline.begin_chunk(1, 16)
assert timeline.simulation_tick == 3750
for fps in [0, float('nan'), float('inf')]:
    try:
        timeline.begin_chunk(1, fps)
    except ValueError:
        pass
    else:
        raise AssertionError(fps)
print('Timeline checks passed')
if '--render' in sys.argv:
    from game_backend_check.game_renderer import (
        DEFAULT_CAPTURE_HEIGHT,
        DEFAULT_CAPTURE_WIDTH,
        GameCaptureWorker,
    )
    shape = (DEFAULT_CAPTURE_HEIGHT, DEFAULT_CAPTURE_WIDTH, 3)
    for slug in ['boxed-in', 'subway-run']:
        worker = GameCaptureWorker(slug)
        try:
            timeline = GameTimeline(slug)
            for i in range(2):
                start = time.perf_counter()
                pending = worker.submit(timeline.begin_chunk(12, 24))
                submitted = time.perf_counter()
                chunk = pending.result()
                assert len(chunk.frames) == 12
                assert chunk.frames[-1].simulation_tick == (i + 1) * 30
                sampled = [frame for frame in chunk.frames if frame.capture_condition]
                assert [frame.game_frame_id for frame in sampled] == [1 + i * 12, 5 + i * 12, 9 + i * 12]
                for frame in chunk.frames:
                    assert frame.ui_frame.shape == shape, frame.ui_frame.shape
                    if frame.capture_condition:
                        assert frame.condition_frame is frame.ui_frame
                        assert frame.ui_frame.std() > 1
                    else:
                        assert frame.condition_frame is None
                distinct = {frame.ui_frame.tobytes() for frame in chunk.frames}
                assert len(distinct) >= 1
                print(slug, i, '12 frames in', round(time.perf_counter() - start, 3),
                      's | submit returned in', round((submitted - start) * 1000, 2), 'ms |',
                      len(distinct), 'distinct renders')
            if slug == 'boxed-in':
                injected = {'n': 0}

                def drain():
                    injected['n'] += 1
                    if injected['n'] == 1:
                        return [{'action': 'w', 'phase': 'down'}]
                    if injected['n'] == 2:
                        return [{'action': 'w', 'phase': 'up'}]
                    return []

                live = worker.capture(timeline.begin_chunk(12, 24), drain_events=drain)
                moves = [
                    frame.ui_state.get('moves', 0) if frame.ui_state else 0
                    for frame in live.frames
                ]
                assert max(moves) >= 1, moves
                start = time.perf_counter()
                worker.capture(timeline.begin_chunk(4, 16), duration_s=0.2)
                paced = time.perf_counter() - start
                assert paced >= 0.18, paced
                # Same live page: 12 frames at 16 fps cover 45 ticks, not the
                # 30 ticks a frozen 24 fps capture would have used.
                captured16 = worker.capture(timeline.begin_chunk(12, 16))
                assert (
                    captured16.simulation_tick_end
                    - captured16.simulation_tick_start
                    == 45
                )
                print(slug, 'live inject moves', moves, '| paced 4 frames in', round(paced, 3), 's | 12@16fps ticks', captured16.simulation_tick_end - captured16.simulation_tick_start)
                # Dialog pause: probe() must take dismissing input and redraw
                # without advancing the sim, which is what lets a card be closed
                # while neither the simulation nor the model moves.
                frozen = captured16.simulation_tick_end
                opened = worker.probe(drain_events=lambda: [
                    {'action': 'help.open', 'phase': 'down'}])
                assert opened['state']['helpOpen'] is True, opened['state']
                assert opened['tick'] == frozen, (opened['tick'], frozen)
                for _ in range(3):
                    held = worker.probe()
                    assert held['state']['helpOpen'] is True, held['state']
                    assert held['tick'] == frozen, (held['tick'], frozen)
                closed = worker.probe(drain_events=lambda: [
                    {'action': 'help.close', 'phase': 'down'}])
                assert closed['state']['helpOpen'] is False, closed['state']
                assert closed['tick'] == frozen, (closed['tick'], frozen)
                # The page is still live: capturing resumes from the same tick.
                resumed = worker.capture(timeline.begin_chunk(4, 16))
                assert resumed.simulation_tick_start == frozen, (
                    resumed.simulation_tick_start, frozen)
                print(slug, 'probe froze sim at tick', frozen,
                      '| help open->close over 5 probes | capture resumed at',
                      resumed.simulation_tick_start)
            if slug == 'subway-run':
                # A fresh round waits on its starting line. Simulation and
                # capture keep running there -- that is what lets the model
                # frame rate settle -- but the runner must not move until the
                # player presses space.
                waiting = worker.capture(timeline.begin_chunk(12, 16))
                states = [
                    frame.ui_state.get('state') for frame in waiting.frames
                ]
                assert set(states) == {'READY'}, states
                distances = [
                    frame.ui_state.get('distance') for frame in waiting.frames
                ]
                assert max(distances) == 0, distances
                # Space starts the run, and from then on the runner advances.
                started = worker.capture(
                    timeline.begin_chunk(12, 16),
                    drain_events=lambda: [{'action': ' ', 'phase': 'down'},
                                          {'action': ' ', 'phase': 'up'}],
                )
                assert started.frames[-1].ui_state['state'] == 'RUNNING', (
                    started.frames[-1].ui_state)
                assert started.frames[-1].ui_state['distance'] > 0, (
                    started.frames[-1].ui_state)
                # A restart returns to the starting line rather than running
                # again immediately, so a replay gets the same settling time.
                first_reset = {'sent': False}

                def press_first_reset():
                    if first_reset['sent']:
                        return []
                    first_reset['sent'] = True
                    return [{'action': 'reset', 'phase': 'down'}]

                restarted = worker.capture(
                    timeline.begin_chunk(12, 16),
                    drain_events=press_first_reset,
                )
                assert restarted.frames[-1].ui_state['state'] == 'READY', (
                    restarted.frames[-1].ui_state)
                assert restarted.frames[-1].ui_state['distance'] == 0, (
                    restarted.frames[-1].ui_state)
                print(slug, 'ready line held', len(states), 'frames at distance 0',
                      '| space started the run, distance now',
                      round(started.frames[-1].ui_state['distance'], 2),
                      '| restart returned to READY at distance 0')
                # A restart pressed mid-chunk resets the round in place: the
                # chunk ends on a new roundId at the starting line, which is the
                # signal the model loop rewinds its rollout on.
                before = restarted.frames[-1].ui_state['roundId']
                rerun = worker.capture(
                    timeline.begin_chunk(12, 16),
                    drain_events=lambda: [{'action': ' ', 'phase': 'down'},
                                          {'action': ' ', 'phase': 'up'}],
                )
                assert rerun.frames[-1].ui_state['state'] == 'RUNNING'
                # drain_events is called once per frame and the real buffer is
                # drained, so a press arrives exactly once. Emitting it on every
                # frame would reset the round twelve times.
                reset_once = {'sent': False}

                def press_reset_once():
                    if reset_once['sent']:
                        return []
                    reset_once['sent'] = True
                    return [{'action': 'reset', 'phase': 'down'}]

                restarted_again = worker.capture(
                    timeline.begin_chunk(12, 16),
                    drain_events=press_reset_once,
                )
                after = restarted_again.frames[-1].ui_state
                assert after['roundId'] == before + 1, (before, after['roundId'])
                assert after['state'] == 'READY', after
                assert after['distance'] == 0, after
                print(slug, 'mid-run restart moved roundId', before, '->',
                      after['roundId'], 'and returned to the starting line')
        finally:
            worker.close()

    # The WebGameVault ports share one contract: a READY starting line, a
    # start key that emits round.started with a prompt, and (where the game
    # has one) a pause flag that holds the rollout until probe() clears it.
    ported = {
        'astrobot': (' ', None),
        'need-for-speed': ('w', None),
        'dead-rush': ('w', 'p'),
        'street-of-rage': ('j', 'p'),
        'street-fighter': ('j', 'escape'),
        'dark-soul': ('w', 'p'),
        'hades': ('j', 'escape'),
        'elda': ('w', 'p'),
        'city-walk': ('w', 'escape'),
    }
    for slug, (start_key, pause_key) in ported.items():
        worker = GameCaptureWorker(slug)
        try:
            timeline = GameTimeline(slug)
            waiting = worker.capture(timeline.begin_chunk(12, 16))
            for frame in waiting.frames:
                assert frame.ui_frame.shape == shape, frame.ui_frame.shape
            assert waiting.frames[0].ui_frame.std() > 1, slug
            states = {frame.ui_state.get('state') for frame in waiting.frames}
            assert states == {'READY'}, (slug, states)

            pressed = {'n': 0}

            def press_start():
                pressed['n'] += 1
                if pressed['n'] == 1:
                    return [{'action': start_key, 'phase': 'down'}]
                if pressed['n'] == 4:
                    return [{'action': start_key, 'phase': 'up'}]
                return []

            started = worker.capture(
                timeline.begin_chunk(12, 16), drain_events=press_start)
            assert started.frames[-1].ui_state['state'] == 'RUNNING', (
                slug, started.frames[-1].ui_state)
            prompts = [
                event.get('prompt')
                for frame in started.frames
                for event in frame.ui_state.get('events') or ()
                if event.get('type') == 'round.started'
            ]
            assert prompts and all(prompts), (slug, prompts)

            paused_note = 'no pause'
            if pause_key is not None:
                sent = {'done': False}

                def press_pause():
                    if sent['done']:
                        return []
                    sent['done'] = True
                    return [{'action': pause_key, 'phase': 'down'},
                            {'action': pause_key, 'phase': 'up'}]

                paused = worker.capture(
                    timeline.begin_chunk(4, 16), drain_events=press_pause)
                assert paused.frames[-1].ui_state.get('paused') is True, (
                    slug, paused.frames[-1].ui_state)
                frozen = paused.simulation_tick_end
                resumed = worker.probe(drain_events=lambda: [
                    {'action': pause_key, 'phase': 'down'},
                    {'action': pause_key, 'phase': 'up'}])
                assert not resumed['state'].get('paused'), (slug, resumed['state'])
                assert resumed['tick'] == frozen, (slug, resumed['tick'], frozen)
                paused_note = f'{pause_key!r} paused and probe resumed at tick {frozen}'

            reset_sent = {'done': False}

            def press_reset():
                if reset_sent['done']:
                    return []
                reset_sent['done'] = True
                return [{'action': 'reset', 'phase': 'down'}]

            restarted = worker.capture(
                timeline.begin_chunk(4, 16), drain_events=press_reset)
            assert restarted.frames[-1].ui_state['state'] == 'READY', (
                slug, restarted.frames[-1].ui_state)
            print(slug, f'READY held, {start_key!r} started with',
                  repr(prompts[0][:60]), '|', paused_note, '| reset -> READY')
        finally:
            worker.close()

# Exercise the actual paired transport classes without importing torch/aiortc.
import ast
import asyncio
from collections import deque
from fractions import Fraction
import threading
from dataclasses import dataclass
server_path = Path(__file__).resolve().parents[3] / 'flashdreams/flashdreams/runtime_v2/serving/webrtc_server.py'
tree = ast.parse(server_path.read_text())
classes = {'_QueuedRGBFrame', '_VideoTrack', '_AuxiliaryVideoTrack', '_PairedVideoTrack'}
module = ast.Module(body=[node for node in tree.body if isinstance(node, ast.ClassDef) and node.name in classes], type_ignores=[])
class Track:
    def stop(self):
        pass
namespace = dict(asyncio=asyncio, deque=deque, Fraction=Fraction, threading=threading,
                 time=time, dataclass=dataclass, MediaStreamTrack=Track,
                 MediaStreamError=RuntimeError, VideoFrame=object,
                 _INTERACTIVE_FRAME_QUEUE_SIZE=2)
exec('from __future__ import annotations\n' + ast.unparse(module), namespace)
async def check_pairs():
    track = namespace['_PairedVideoTrack'](24)
    for index in range(3):
        track.enqueue((types.SimpleNamespace(index=index), types.SimpleNamespace(index=index)))
    for expected in (1, 2):
        main = await track.recv()
        game = await track.auxiliary.recv()
        assert main.index == game.index == expected
        assert main.pts == game.pts
        assert main.time_base == game.time_base
    await track.start_session()
    await track.close()
    try:
        await track.auxiliary.recv()
    except RuntimeError:
        pass
    else:
        raise AssertionError('Closed auxiliary receiver did not stop')
asyncio.run(check_pairs())
print('Paired queue/drop/timestamp/close checks passed')
