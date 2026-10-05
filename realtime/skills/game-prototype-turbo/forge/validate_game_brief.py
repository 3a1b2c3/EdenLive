"""Validate a game brief JSON against docs/specs/game-brief.schema.json (fail closed).

Contract: --help; non-zero exit + printed reason on failure; no network; reads the schema
from docs/specs/ and the brief from an explicit path. One dependency: jsonschema
(requirements.txt).

Usage:
    python forge/validate_game_brief.py <path-to-brief.json>
    python forge/validate_game_brief.py --starter

Exit codes:
    0  the brief is valid
    1  the brief violates game-brief.schema.json (fail closed)
    2  usage or I/O error (bad path, invalid JSON)
"""

import argparse
import json
import sys
from pathlib import Path

from jsonschema import Draft7Validator, ValidationError

SCHEMA_PATH = Path(__file__).resolve().parents[1] / "docs" / "specs" / "game-brief.schema.json"


def load_schema():
    """Read the game-brief schema from docs/specs/."""
    return json.loads(SCHEMA_PATH.read_text(encoding="utf-8"))


def validate_brief(brief):
    """Return the list of ValidationError for ``brief``; empty means valid."""
    schema = load_schema()
    validator = Draft7Validator(schema)
    errors = list(validator.iter_errors(brief))
    if isinstance(brief, dict) and isinstance(brief.get('interaction_tags'), list):
        seen = set()
        for index, tag in enumerate(brief['interaction_tags']):
            if not isinstance(tag, dict) or not isinstance(tag.get('id'), str):
                continue
            if tag['id'] in seen:
                errors.append(ValidationError('interaction tag IDs must be unique', path=['interaction_tags', index, 'id']))
            seen.add(tag['id'])
    scene = brief.get('scene') if isinstance(brief, dict) else None
    elements = scene.get('theme_elements') if isinstance(scene, dict) else None
    if isinstance(elements, list):
        seen = set()
        for index, item in enumerate(elements):
            if isinstance(item, dict) and isinstance(item.get('id'), str):
                if item['id'] in seen:
                    errors.append(ValidationError('theme element IDs must be unique', path=['scene', 'theme_elements', index, 'id']))
                seen.add(item['id'])
    return sorted(errors, key=lambda e: [str(part) for part in e.path])


def starter_brief():
    """Include every required field; blank semantic values must be authored."""
    return {
        "title": "",
        "core_verb": "",
        "fantasy": "",
        "control_scheme": "custom",
        "player_modality": "",
        "fail_state": "",
        "win_state": "",
        "interaction_tags": [],
        "time_budget_seconds": 120,
        "context": {},
        "scene": {"description": "", "theme_elements": [{"id": "", "label": "", "role": ""}]},
        "ui": {"mode": "polish"},
    }


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate a game brief against game-brief.schema.json (fail closed).",
        epilog='; '.join(f"{name}: {', '.join(load_schema()['properties'][name]['enum'])}"
                         for name in ('control_scheme', 'player_modality')),
    )
    parser.add_argument("brief", nargs="?", help="path to the *.brief.json to validate")
    parser.add_argument(
        "--starter", action="store_true",
        help="print an authoring skeleton with safe defaults; semantic fields remain blank",
    )
    parser.add_argument('--output', type=Path, help='write --starter to a new file instead of stdout')
    args = parser.parse_args(argv)

    if args.starter:
        if args.brief:
            parser.error("--starter does not take a brief path")
        data = json.dumps(starter_brief(), indent=2, ensure_ascii=False) + '\n'
        if args.output:
            try:
                with args.output.open('x', encoding='utf-8') as stream:
                    stream.write(data)
            except OSError as exc:
                print(f'error: {exc}', file=sys.stderr)
                return 2
        else:
            print(data, end='')
        return 0
    if args.output:
        parser.error('--output requires --starter')
    if not args.brief:
        parser.error("a brief path is required unless --starter is used")

    brief_path = Path(args.brief)
    if not brief_path.is_file():
        print(f"error: not a file: {brief_path}", file=sys.stderr)
        return 2

    try:
        brief = json.loads(brief_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        print(f"error: invalid JSON in {brief_path}: {exc}", file=sys.stderr)
        return 2

    errors = validate_brief(brief)
    if errors:
        for err in errors:
            location = ".".join(str(part) for part in err.path) or "<root>"
            print(f"{brief_path}: {location}: {err.message}", file=sys.stderr)
        print(f"{len(errors)} validation error(s)", file=sys.stderr)
        return 1

    print(f"{brief_path}: OK")
    return 0


if __name__ == "__main__":
    sys.exit(main())
