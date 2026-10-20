"""Playable artifacts for the browser gates, written as literals instead of checked-in games.

The browser gates can only be tested against a real artifact, but a game that sits under
`assets/` is something a skill user reads and imitates, and a named example biases the genre
of whatever they build next. So the two artifacts these tests need live here as strings and
are written into a per-invocation directory under `forge/tests/.fixtures/` that the test
itself removes. Nothing under `assets/` or `forge/` ships them.

`MENU_GAME` is a complete discrete-choice run: it satisfies the behavior input contract, the
optional round diagnostic and the acceptance observation contract, so it exercises the gates
without a gameplay clock. `CUE_PAGE` is not a game at all -- it is the smallest host page
that renders, exposes a cue and holds still while RAF is paused, which is what the overlay
and frozen-capture checks need.
"""

import contextlib
import json
import os
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
FIXTURE_ROOT = ROOT / "forge/tests/.fixtures"


MENU_GAME = {
    "index.html": """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Menu route board</title>
  <style>
    html, body { margin: 0; height: 100%; overflow: hidden; background: #111722; color: #e8eff9; font: 16px/1.45 system-ui, sans-serif; }
    #app { position: absolute; inset: 0; }
    #app canvas { display: block; width: 100%; height: 100%; }
    #hud { position: absolute; left: 24px; top: 20px; z-index: 2; width: 300px; padding: 16px; border: 1px solid #35435a; border-radius: 10px; background: #111722e8; }
    h1 { margin: 0 0 8px; font-size: 20px; }
    p { margin: 7px 0; }
    #options { margin: 14px 0 8px; padding: 0; list-style: none; }
    #options li { padding: 6px 9px; border-radius: 5px; }
    #options li.selected { color: #111722; background: #8cc8ff; font-weight: 700; }
    #fatal { position: absolute; left: 20px; bottom: 20px; z-index: 3; max-width: 80vw; padding: 10px; color: #ffdada; background: #741f2a; white-space: pre-wrap; }
  </style>
  <script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>
</head>
<body>
  <div id="app"></div>
  <div id="hud">
    <h1>Choose a route</h1>
    <p id="status"></p>
    <ul id="options"></ul>
    <p>Arrow keys: move · Enter: confirm · R: restart</p>
  </div>
  <div id="fatal" hidden></div>
  <script type="module">
    import('./main.js').then(({ start }) => start()).catch((error) => {
      const fatal = document.querySelector('#fatal');
      fatal.hidden = false;
      fatal.style.display = 'block';
      fatal.textContent = error?.stack ?? String(error);
    });
  </script>
</body>
</html>
""",
    "main.js": """import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  WebGLRenderer,
} from 'three';
import { buildRound, OPTIONS } from './round.mjs';

export async function start() {
  const container = document.querySelector('#app');
  const status = document.querySelector('#status');
  const optionsElement = document.querySelector('#options');
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(1);
  renderer.setSize(container.clientWidth || 960, container.clientHeight || 640, false);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.background = new Color(0x25354a);
  const camera = new PerspectiveCamera(55, renderer.domElement.width / renderer.domElement.height, 0.1, 100);
  camera.position.set(0, 1.5, 6);
  camera.lookAt(0, 0, 0);
  scene.add(new DirectionalLight(0xffffff, 1.5));
  const board = new Mesh(
    new BoxGeometry(3.2, 0.35, 2.1),
    new MeshStandardMaterial({ color: 0x6b89aa }),
  );
  board.position.y = -0.7;
  board.name = "route-board";
  scene.add(board);
  window.__scene = { scene, camera };

  let parts;
  let roundId = 0;
  let terminalCount = 0;
  let events = [];
  let frameId = 0;
  let frame = { id: 0, rawDt: 0, simDt: 0 };

  const collect = () => {
    for (const event of parts.director.step(0)) {
      events.push(event);
      if (event.type === 'round.won' || event.type === 'round.lost') terminalCount += 1;
    }
    events = events.slice(-64);
  };

  const reset = () => {
    parts = buildRound();
    terminalCount = 0;
    events = [];
    roundId += 1;
  };

  window.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowRight') parts.move(1);
    else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft') parts.move(-1);
    else if (event.key === 'Enter') parts.commit();
    else if (event.key.toLowerCase() === 'r') reset();
    collect();
    renderMenu();
  });

  window.__gameTest = Object.freeze({
    read: () => ({
      state: parts.director.state,
      roundId,
      elapsed: 0,
      terminalCount,
      outcomeReason: parts.director.outcomeReason,
      selected: parts.menu.index,
      menuState: parts.menu.state,
      events: events.map((event) => ({ ...event })),
      frame: { ...frame },
    }),
  });

  const renderMenu = () => {
    optionsElement.replaceChildren(...OPTIONS.map((label, index) => {
      const item = document.createElement('li');
      item.textContent = `${index + 1}. ${label}`;
      item.className = index === parts.menu.index ? 'selected' : '';
      return item;
    }));
    status.textContent = parts.director.state === 'RUNNING'
      ? 'Survey the routes and choose the open path home. There is no time limit.'
      : `${parts.director.state}: ${parts.director.outcomeReason}`;
  };

  reset();
  renderMenu();
  let last = performance.now();
  const animate = (now) => {
    const rawDt = Math.max(0, (now - last) / 1000);
    last = now;
    // No delta cap is needed for discrete turns; elapsed game time stays zero.
    frame = { id: ++frameId, rawDt, simDt: rawDt };
    renderer.render(scene, camera);
    requestAnimationFrame(animate);
  };
  requestAnimationFrame(animate);
}
""",
    "round.mjs": """import { MenuSelectionController } from '/assets/interaction/MenuSelectionController.js';

export const OPTIONS = ['North path (flooded)', 'South path (open)', 'East path (closed bridge)'];

export function buildRound() {
  const menu = new MenuSelectionController({ optionCount: OPTIONS.length, wrap: false });
  let pending = [];
  let nextEventId = 0;
  const emit = (type, extra = {}) => pending.push({ id: ++nextEventId, type, ...extra });
  const director = {
    state: 'RUNNING',
    outcomeReason: null,
    get isResolved() { return this.state !== 'RUNNING'; },
    step() {
      const events = pending;
      pending = [];
      return events;
    },
  };
  const move = (delta) => {
    if (director.isResolved) return;
    const result = menu.move(delta);
    if (result.changed) emit('menu.moved', { index: result.index });
  };
  const commit = () => {
    if (director.isResolved) return;
    const result = menu.commit();
    if (result.transition !== 'committed') return;
    emit('menu.committed', { index: result.committedIndex });
    const won = result.committedIndex === 1;
    director.state = won ? 'WON' : 'LOST';
    director.outcomeReason = won ? 'The open south path reaches home.' : 'The blocked route ends this journey.';
    emit(won ? 'round.won' : 'round.lost', { reason: director.outcomeReason });
  };
  return { director, menu, move, commit };
}

export const SCRIPTS = {
  win(frame, parts) {
    if (frame === 0) parts.move(1);
    if (frame === 1) parts.commit();
  },
  lose(frame, parts) {
    if (frame === 0) parts.commit();
  },
};
""",
    "step3.json": json.dumps({
        "control_scheme": "custom",
        "player_modality": "menu",
        "core_verb": "choose a route",
        "modules": ["/assets/interaction/MenuSelectionController.js"],
        "controls": ["Arrow keys: move highlight", "Enter: confirm route", "R: restart"],
        "gate": "A real selection changes the choice; confirmation reaches a stable outcome "
                "and restart creates a new round.",
        "capabilities": ["discrete_state"],
        "scene_manifest": "scene-manifest.json",
        "capability_checks": {"discrete_state": ["move route highlight", "confirm the open route", "reject move before first option"]},
        "brief": "brief.json",
        "signature_actions": [{
            "id": "choose-route", "brief_refs": ["/core_verb"], "action": "Select and commit a route",
            "success_checks": ["move route highlight", "confirm the open route"],
            "boundary": {"checks": ["reject move before first option", "restart restores selection and outcome"]},
            "feedback": "The selected route is highlighted; its result replaces the instruction.",
        }],
        "implementation": {
            "controllers": ["MenuSelectionController"],
            "camera": "fixed perspective board",
            "input_model": "keyboard discrete selection",
        },
        "input_checks": [
            {"name": "reject move before first option",
             "actions": [{"type": "tap", "key": "ArrowUp"}],
             "expect": {"state": "RUNNING", "selected": 0}},
            {"name": "move route highlight",
             "before": {"state": "RUNNING", "selected": 0},
             "actions": [{"type": "tap", "key": "ArrowDown"}],
             "expect": {"state": "RUNNING", "selected": 1},
             "settle_ms": 50, "persist_ms": 100},
            {"name": "confirm the open route",
             "actions": [{"type": "tap", "key": "Enter"}],
             "expect": {"state": "WON", "terminalCount": 1, "menuState": "committed"}},
            {"name": "restart restores selection and outcome",
             "actions": [{"type": "tap", "key": "r"}],
             "expect": {"state": "RUNNING", "selected": 0, "terminalCount": 0}},
        ],
    }, indent=2) + "\n",
    "scene-manifest.json": json.dumps({"elements": [{"id":"board", "binding":{"object":"route-board"}, "custom_reason":"Abstract route board uses a simple box", "considered":"assets/world/environment/BoardEnvironment.js"}]}),
    "brief.json": json.dumps({
        "ui": {"mode": "polish"},
        "title": "Menu route board",
        "core_verb": "Read route conditions, select and confirm a route home",
        "fantasy": "Choose a safe path after a storm",
        "control_scheme": "custom",
        "player_modality": "menu",
        "fail_state": "Confirm the flooded north path or the closed east bridge",
        "win_state": "Confirm the open south path",
        "interaction_tags": [],
        "time_budget_seconds": 30,
        "context": {
            "distilled_prompt": "A small untimed menu interaction fixture with visible route "
                                "information, a real decision consequence, loss and replay.",
            "assumptions": ["Arrow keys select, Enter confirms and R starts a fresh round."],
        },
        "scene": {"theme_elements": [{"id":"board","label":"Route board","role":"board"}], "description": "A fixed board backdrop and a readable list of three routes, "
                                 "each labeled with its condition."},
    }, indent=2) + "\n",
}
"""Every file of the discrete-choice run, keyed by name. `brief.json` is a sibling by default;
a caller that relocates it rewrites `step3.json`'s `brief` path."""


# Move onto the open route, then confirm it. The losing scenario confirms the route the
# highlight already sits on, so a loss needs no extra input.
_MENU_WIN_RULES = [
    {"when": {"state": "RUNNING", "selected": 0},
     "action": {"type": "tap", "key": "ArrowDown"}, "once": True},
    {"when": {"state": "RUNNING", "selected": 1},
     "action": {"type": "tap", "key": "Enter"}, "once": True},
]

MENU_STRATEGY = {
    "restart_actions": [{"type": "tap", "key": "r"}],
    "interaction_events": ["menu.moved", "menu.committed"],
    "scenarios": [
        {"expect": "WON", "rules": _MENU_WIN_RULES},
        {"expect": "LOST", "rules": [
            {"when": {"state": "RUNNING", "selected": 0},
             "action": {"type": "tap", "key": "Enter"}, "once": True},
        ]},
        {"expect": "WON", "rules": _MENU_WIN_RULES},
    ],
}
"""An acceptance keyboard strategy for `MENU_GAME`: win, loss, then win again after restart."""

MENU_CLOSURE_STRATEGY = {
    "restart_actions": [{"type": "tap", "key": "r"}],
    "interaction_events": ["menu.moved", "menu.committed"],
    "scenarios": [
        {"expect": "WON", "rules": _MENU_WIN_RULES},
        # The restarted round must accept a real move again, without ending.
        {"expect": "RUNNING", "rules": [
            {"when": {"state": "RUNNING", "selected": 0},
             "action": {"type": "tap", "key": "ArrowDown"}, "once": True},
        ]},
    ],
}
"""A behaviour closure strategy for `MENU_GAME`: one win, a real restart, then a fresh
round that still accepts input. It deliberately proves less than `MENU_STRATEGY`."""


# Hold the guard while the cue is up, release it after, spend the charge it earned. The
# losing scenario supplies no rules at all, which is how a timed game loses by not acting.
_HELD_WIN_RULES = [
    {"when": {"cue": True}, "hold": ["f"]},
    {"when": {"ready": True}, "action": {"type": "tap", "key": "e"}},
]

HELD_INPUT_STRATEGY = {
    "restart_actions": [{"type": "tap", "key": "r"}],
    "interaction_events": ["guard.parried"],
    "capture_when": {"cue": True, "labelVisible": True},
    "scenarios": [
        {"expect": "WON", "rules": _HELD_WIN_RULES},
        {"expect": "LOST", "rules": []},
        {"expect": "WON", "rules": _HELD_WIN_RULES},
    ],
}
"""A held-input, cue-reactive strategy. Validation-only: there is no
matching fixture game, because the checks that read it never open a browser."""


CUE_PAGE = {
    "index.html": """<!doctype html><html lang="en"><meta charset="utf-8"><title>Cue overlay fixture</title>
<link rel="icon" href="data:,"><link rel="stylesheet" href="/assets/user-interface/segmented-resource.css">
<style>html,body{margin:0;height:100%;background:#17191e;color:#fff;font:16px system-ui}
#view{height:100%;position:relative}canvas{width:100%;height:100%;display:block}
#label{position:absolute;background:#ffc65c;color:#211509;padding:5px 12px;border-radius:10px;font-weight:bold}</style>
<script type="importmap">{"imports":{"three":"/vendor/three.module.js"}}</script>
<div id="view"><div id="label" hidden></div></div>
<script type="module" src="./main.js"></script></html>
""",
    "main.js": """// Host page for the overlay-projection and frozen-capture checks. It is deliberately not
// a game: there are no rules, no resources and no outcome, only a rendered scene and a cue.
// Input raises the cue; RAF updates timing and the label. After input is released, pausing
// RAF freezes the snapshot because no timer or worker advances it.
import {
  BoxGeometry, Color, DirectionalLight, Mesh, MeshStandardMaterial,
  PerspectiveCamera, Scene, WebGLRenderer,
} from 'three';
import { WorldAnchorLabel } from '/assets/user-interface/WorldAnchorLabel.js';

const view = document.querySelector('#view');
const labelElement = document.querySelector('#label');
const renderer = new WebGLRenderer({ antialias: false });
renderer.setPixelRatio(1);
renderer.setSize(view.clientWidth || 960, view.clientHeight || 640, false);
renderer.shadowMap.enabled = false;
view.appendChild(renderer.domElement);

const scene = new Scene();
scene.background = new Color(0x242b35);
const camera = new PerspectiveCamera(48, 960 / 640, 0.1, 100);
camera.position.set(0, 3.2, 6);
camera.lookAt(0, 0, 0);
const light = new DirectionalLight(0xffffff, 2);
light.position.set(3, 8, 5);
scene.add(light);
const marker = new Mesh(new BoxGeometry(1.4, 1.4, 1.4), new MeshStandardMaterial({ color: 0xad4d37 }));
scene.add(marker);
const label = new WorldAnchorLabel({ element: labelElement, container: view, height: 1.5 });
window.__scene = { scene, camera };

let roundId = 0;
let frameId = 0;
let elapsed = 0;
let frame = { id: 0, rawDt: 0, simDt: 0 };
let events = [];
let nextEventId = 0;
let cue = false;

// R arms the cue, which is what the capture check waits for before freezing the frame.
window.addEventListener('keydown', (event) => {
  if (event.repeat || event.key.toLowerCase() !== 'r') return;
  roundId += 1;
  cue = true;
  events.push({ id: ++nextEventId, type: 'cue.raised' });
  events = events.slice(-32);
});

window.__gameTest = Object.freeze({
  read: () => ({
    state: 'RUNNING',
    roundId,
    elapsed,
    terminalCount: 0,
    events: events.map((event) => ({ ...event })),
    frame: { ...frame },
    cue,
    labelVisible: !labelElement.hidden,
  }),
});

let last = performance.now();
const animate = (now) => {
  const rawDt = Math.max(0, (now - last) / 1000);
  last = now;
  frame = { id: ++frameId, rawDt, simDt: Math.min(rawDt, 0.05) };
  elapsed += frame.simDt;
  label.update({
    position: marker.position,
    camera,
    viewport: renderer.domElement.getBoundingClientRect(),
    visible: cue,
    text: 'PARRY',
  });
  renderer.render(scene, camera);
  requestAnimationFrame(animate);
};
requestAnimationFrame(animate);
""",
}
"""The smallest page that satisfies the acceptance observation contract without being a game."""


def write_game(directory, files=MENU_GAME, **overrides):
    """Write a fixture's files into `directory`, replacing any named in `overrides`."""
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    for name, content in {**files, **overrides}.items():
        (directory / name).write_text(content, encoding="utf-8")
    return directory


@contextlib.contextmanager
def fixture_run(label, files=MENU_GAME, run_name="run", **overrides):
    """Serve-able fixture run under `forge/tests/.fixtures/`, removed on exit.

    Yields `(runs_dir, run_dir)`. The path is per-process because the gates take a runs
    directory and check every run inside it, so a shared path would make one pytest
    invocation discover another's fixture. Only the directory this call created is
    removed; nothing outside it is touched.
    """
    runs_dir = FIXTURE_ROOT / f"{label}-{os.getpid()}"
    shutil.rmtree(runs_dir, ignore_errors=True)
    try:
        yield runs_dir, write_game(runs_dir / run_name, files, **overrides)
    finally:
        shutil.rmtree(runs_dir, ignore_errors=True)
