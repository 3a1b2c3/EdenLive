"""Write a compact machine-readable recovery note for an output project."""
import argparse
import json
from pathlib import Path

from _shared.attempts import load_ledger, reusable, evidence_valid, file_hashes


def write_recovery(root, *, artifact, next_step, unresolved=(), check=None):
    base = Path(root).resolve()
    attempts = load_ledger(base)["attempts"]
    latest = attempts[-1] if attempts else None
    note = {
        "format": "gameblocks-recovery/v1",
        "artifact": str(artifact),
        "artifact_hashes": file_hashes(base, [artifact]),
        "check": check,
        "latest": {"run_id": latest["run_id"], "check": latest["check"], "result": latest["result"],
                   "valid": evidence_valid(base, latest)} if latest else None,
        "reusable": reusable(base, check, artifact=artifact) if check else None,
        "unresolved": list(unresolved),
        "next": str(next_step),
    }
    path = base / "evidence" / "recovery.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(note, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return path


def read_recovery(root):
    """Refresh evidence on read; a saved recovery note cannot certify old code."""
    base = Path(root).resolve()
    note = json.loads((base / 'evidence/recovery.json').read_text())
    if note.get('format') != 'gameblocks-recovery/v1':
        raise ValueError('invalid recovery format')
    note['artifact_current'] = file_hashes(base, [note['artifact']]) == note['artifact_hashes']
    note['reusable'] = reusable(base, note['check'], artifact=note['artifact']) if note.get('check') else None
    latest = load_ledger(base)['attempts']
    note['latest'] = ({k: latest[-1][k] for k in ('run_id', 'check', 'result')}
                      | {'valid': evidence_valid(base, latest[-1])}) if latest else None
    return note


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=Path("."))
    parser.add_argument("--artifact")
    parser.add_argument("--next", dest="next_step")
    parser.add_argument("--read", action='store_true', help='read the note with freshly verified hashes')
    parser.add_argument("--unresolved", action="append", default=[])
    parser.add_argument("--check")
    args = parser.parse_args(argv)
    if args.read:
        print(json.dumps(read_recovery(args.root), indent=2, ensure_ascii=False))
        return 0
    if not args.artifact or not args.next_step:
        parser.error('--artifact and --next are required when writing a note')
    print(write_recovery(args.root, artifact=args.artifact, next_step=args.next_step,
                          unresolved=args.unresolved, check=args.check))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
