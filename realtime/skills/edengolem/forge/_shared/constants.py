"""Shared stage IDs, prompt routes, executable gate plans and refinement cap.

The pipeline intentionally has only three build stages after intake.  A scene is
assembled once, behaviour is wired into that retained scene until the game is
playable end to end, and the final stage completes presentation and proves the
whole game through real input and delivery checks.

Behaviour therefore owns level progression, win/loss, terminal stop and restart,
verified by a bounded `closure` playthrough: one representative terminal outcome,
a real same-page restart and a fresh round that still accepts effective input.
Acceptance keeps the full WON/LOST/WON sequence, because the final UI can change
focus, click targets and input delivery. A closure pass never substitutes for it.
"""

import shlex

# Pipeline order. `current_stage` in .state.json is one of these, or "done".
STAGES = ("intake", "scene", "behavior", "acceptance")

# Which grimoire prompt each stage follows (forge/next.py reports these).
STAGE_PROMPTS = {
    "intake": "grimoire/intake/01-parse-prompt.md",
    "scene": "grimoire/build/step1-static-scene.md",
    "behavior": "grimoire/build/step2-behavior.md",
    "acceptance": "grimoire/build/step3-acceptance.md",
}

# Commands and report locations have one source for both finish.py and next.py.
# Templates are split BEFORE substitution; paths with spaces remain single argv items.
GATE_SPECS = {
    "brief": ("validate_game_brief.py {run}", None),
    "metadata": ("validate_run_meta.py {run}/step1.json", None),
    "scene": ("check_step1.py --project-root {root} --runs {runs} --only {name} --output {output}/scene --record-attempt",
              "{output}/scene/{name}.json"),
    "behavior": ("check_step2.py --project-root {root} --runs {runs} --only {name} --output {output}/behavior --record-attempt",
                 "{output}/behavior/{name}.json"),
    "closure": ("check_step3.py --scope closure --project-root {root} --runs {runs} --only {name} --strategy {strategy} --output {output}/closure --record-attempt",
                "{output}/closure/report.json"),
    "acceptance": ("check_step3.py --project-root {root} --runs {runs} --only {name} --strategy {strategy} --output {output}/acceptance --record-attempt",
                   "{output}/acceptance/report.json"),
    "relocation": ("run_project.py --project-root {root} --stage step3 --only {name} --relocate --output {output}/relocation.json",
                   "{output}/relocation.json"),
}
STAGE_GATE_IDS = {
    "intake": ("brief",),
    # Static scene checks include metadata, factory manifest and boot/framing.
    "scene": ("metadata", "scene"),
    # Behaviour checks cover controls and applicable motion/action/collision logic,
    # then prove the playable loop closes: a terminal outcome, restart and replay.
    "behavior": ("behavior", "closure"),
    # Acceptance owns final presentation, the full real-input sequence and packaging.
    "acceptance": ("acceptance", "relocation"),
}

# What each build stage must deliver, what it defers, and the evidence its gates
# produce.  One source so prompts, the task packet and scaffolding cannot drift.
STAGE_CONTRACTS = {
    "scene": {
        "goal": "Compose every theme element with reusable assets in a complete static scene.",
        "delivers": (
            "every brief theme element bound to a scene object or DOM element",
            "an intentional camera/framing and the interaction areas the game needs",
            "a scene manifest naming the reused asset or, for a custom 3D setting, the catalog environment considered and skipped",
        ),
        "defers": (
            "controls, rules and outcomes to behavior",
            "final UI styling, result cards and decorative menus to acceptance",
        ),
        "evidence": "static coverage, boot, framing and WebGL canvas CSS fit; custom 3D settings name a considered catalog path; no gameplay claim",
    },
    "behavior": {
        "goal": "Wire the complete playable loop: controls, progression, outcomes, terminal stop and restart.",
        "delivers": (
            "applicable controls, camera, actions, navigation and collisions",
            "catalog camera, combat or resource modules imported by the run page or recorded as skipped when those capabilities apply",
            "level/stage progression and the brief's win and loss conditions",
            "a terminal state that stops play, plus a real same-page restart",
            "the feedback the player needs to make those decisions",
        ),
        "defers": (
            "final UI composition, result presentation and polish to acceptance",
            "the full win/loss/restart acceptance sequence and packaging to acceptance",
        ),
        "evidence": "declared capability inputs, plus one closure path: a representative terminal "
                    "outcome, real restart and a fresh round that still accepts input. The other "
                    "terminal branch must be implemented but is not evaluated here.",
    },
    "acceptance": {
        "goal": "Finish presentation, repair integration, then prove the whole game and standalone delivery.",
        "delivers": (
            "final UI and presentation appropriate to the brief",
            "integration repairs where the finished UI changed focus, input or terminal handling",
            "the full real-input sequence and a relocated standalone launch",
        ),
        "migration": "Extend the inherited closure strategy to the full sequence WON -> LOST -> WON; "
                     "reuse its useful rules, add the missing terminal branch and complete the replay win.",
        "defers": (),
        "evidence": "win, deliberate loss and a win after real restart with the final UI integrated, "
                    "plus a relocated launch",
    },
}


def gate_plan(stage, values, python="python", forge="forge", options=(), gates=None):
    """Return ordered (id, argv, report) entries; never execute through a shell."""
    plan = []
    for gate in (STAGE_GATE_IDS[stage] if gates is None else gates):
        template, report = GATE_SPECS[gate]
        parts = [part.format_map(values) for part in shlex.split(template)]
        argv = [python, f"{forge}/{parts[0]}", *parts[1:]]
        for flag, value in options:
            # Browser checks consume viewport/hardware options; only the playthrough
            # scopes consume simulation settings. Unknown options
            # are deliberately dropped instead of leaking into a checker that
            # does not understand them.
            if flag == "--sim-seconds" and gate not in ("closure", "acceptance"):
                continue
            if flag != "--sim-seconds" and gate not in ("scene", "behavior", "closure", "acceptance", "relocation"):
                continue
            argv.append(flag)
            if value is not None:
                argv.append(str(value))
        plan.append((gate, argv, report.format_map(values) if report else None))
    return plan


STAGE_GATES = {
    stage: tuple(" ".join(argv) for _, argv, _ in gate_plan(stage, {
        "root": "<output>", "run": "<output>/brief.json" if stage == "intake" else "<output>/<run>",
        "runs": "<runs-dir>", "name": "<name>", "output": "<evidence-dir>", "strategy": "<strategy.json>",
    })) for stage in STAGES
}

# Max refine rounds per stage. Hitting it stops the pipeline (fail loud).
# forge/finish.py spends one round per failed check batch; manual and revision
# records are counted by whoever writes them.
LOOP_CAP = 3

# One gate subprocess must finish inside this budget (forge/finish.py).
GATE_TIMEOUT_SECONDS = 300

# Acceptance drives three scenarios, an optional capture replay and browser
# startup inside that budget, so per-scenario wall time stays well below it:
# 3 * 75 s + a 15 s capture window + bounded image/boot overhead fits 300 s.
MAX_WALL_SECONDS = 75
DEFAULT_WALL_SECONDS = 60

# Consecutive process-launch failures stop automation without spending game refinements.
LAUNCH_RETRY_CAP = 3

# Asset constructor defaults live in their JS modules, not in this workflow.
