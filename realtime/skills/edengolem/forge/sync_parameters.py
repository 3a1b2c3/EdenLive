"""Generate/check the current-parameters section from the game's runtime JSON source."""
import argparse
import hashlib
import json
from pathlib import Path

START = '<!-- current-parameters:start -->'
END = '<!-- current-parameters:end -->'


def section(path):
    raw = Path(path).read_bytes()
    values = json.loads(raw)
    if not isinstance(values, dict):
        raise ValueError('parameters must be an object')
    digest = hashlib.sha256(raw).hexdigest()
    return f'{START}\nRuntime source: {Path(path).name}; SHA256: {digest}\n\n```json\n{json.dumps(values, ensure_ascii=False, indent=2)}\n```\n{END}'


def sync(source, document, check=False):
    block = section(source)
    path = Path(document)
    text = path.read_text(encoding='utf-8') if path.exists() else ''
    if text.count(START) != text.count(END) or text.count(START) > 1:
        raise ValueError('malformed current-parameters markers')
    if START in text:
        start, end = text.index(START), text.index(END) + len(END)
        if end < start:
            raise ValueError('reversed current-parameters markers')
        updated = text[:start] + block + text[end:]
    else:
        updated = text.rstrip() + '\n\n' + block + '\n'
    if check:
        return updated == text
    path.write_text(updated, encoding='utf-8')
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('source'); parser.add_argument('document'); parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    try:
        valid = sync(args.source, args.document, args.check)
    except (OSError, ValueError) as exc:
        print(f'parameters: failed: {exc}'); return 1
    print('parameters: synchronized' if valid else 'parameters: stale; regenerate current section')
    return 0 if valid else 1

if __name__ == '__main__':
    raise SystemExit(main())
