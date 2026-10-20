"""Lint the skill's own Markdown against the writing contract (fail loud).

Contract: --help; non-zero exit + printed reason for every offense; no network.
Run from the repo root:
    python forge/validate_md.py

Checks:
  - no emoji in any *.md (project convention: no emoji, no marketing tone)
  - SKILL.md is a thin router: < 500 lines, frontmatter has name + description,
    description <= 1024 chars and contains no '<' or '>'
  - every relative markdown link resolves to an existing file (no broken deep-chain)
  - every repo path cited in backticks exists (prompts cite files as inline code,
    which markdown link checking never sees -- that is where renames rot)
  - docs/specs/*.json and assets/game-briefs/*.json parse as JSON (if present)
"""

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]

# Decorative-symbol ranges that read as emoji; surplus of "no emoji, no marketing tone".
_EMOJI_RE = re.compile(
    "["
    "\U0001F000-\U0001FAFF"  # emoticons, pictographs, transport & symbols, flags
    "\U00002600-\U000027BF"  # misc symbols & dingbats (heart, check, sparkles...)
    "\U00002B00-\U00002BFF"  # misc symbols
    "\U0000FE00-\U0000FE0F"  # variation selectors
    "]"
)

_EXCLUDED_DIRS = {"tmp", ".git", ".claude", "__pycache__", "node_modules"}

# Repo-relative paths cited as inline code, e.g. `assets/camera/PoseFollowCameraRig.js`.
# Anchored on the repo's top-level directories so ordinary prose in backticks is ignored.
_BACKTICK_PATH_RE = re.compile(
    r"`((?:assets|forge|grimoire|docs)/[A-Za-z0-9._*/-]+)`"
)

_SKILL_MAX_LINES = 500
_DESC_MAX = 1024


def _git_known_files(root: Path):
    """Repro-root-relative paths git manages below ``root``, or None outside a repo.

    The set is the union of tracked files (``ls-files --cached``) and untracked files
    not excluded by ignore rules (``ls-files --others --exclude-standard``) -- exactly
    the lint's audience: committed work plus new-but-not-ignored work. Reporting against
    git's view (rather than a blind ``rglob``) is what keeps stale checkouts and ignored
    scratch out of the scan. Returns ``(known, top)`` where ``known`` holds ``Path``s
    relative to the repository top; ``None`` when ``root`` is not under a git repo, so a
    fixture tree still lints as itself with the plain walk.
    """
    try:
        rev = subprocess.run(
            ["git", "-C", str(root), "rev-parse", "--show-toplevel"],
            capture_output=True, text=True,
        )
    except OSError:
        return None
    if rev.returncode != 0 or not rev.stdout.strip():
        return None
    top = Path(rev.stdout.strip()).resolve()

    known = set()
    for args in (["--cached"], ["--others", "--exclude-standard"]):
        try:
            proc = subprocess.run(
                ["git", "-C", str(top), "ls-files", "-z", *args],
                capture_output=True,
            )
        except OSError:
            return None
        if proc.returncode != 0:
            return None
        for raw in proc.stdout.decode("utf-8", "replace").split("\0"):
            # -z separates entries with NUL, so no newline needs stripping; a
            # bare ``raw`` (never ``.strip()``) keeps a legitimate filename that
            # begins or ends in whitespace intact.
            if raw:
                known.add(Path(raw))
    return known, top


def _walk_md(root: Path):
    """Every ``*.md`` under ``root``, pruning nested checkouts instead of re-linting them.

    ``Path.rglob`` cannot prune, so a linked worktree the repo hosts (a directory whose
    own ``.git`` file or directory marks it another checkout -- e.g. ``.claude/worktrees/*``)
    would be linted as if it were the project, surfacing the foreign tree's defects. A
    directory holding a ``.git`` entry is itself a checkout; stop there and skip the whole
    subtree.
    """
    stack = [root]
    while stack:
        directory = stack.pop()
        try:
            entries = sorted(directory.iterdir(), key=lambda entry: entry.name)
        except OSError:
            continue
        for entry in entries:
            if entry.is_symlink():
                # Never follow links: a directory link back to an ancestor would
                # loop this walker forever, and a file link is needless indirection.
                continue
            if entry.is_dir():
                if entry.name in _EXCLUDED_DIRS or (entry / ".git").exists():
                    continue
                stack.append(entry)
            elif entry.suffix == ".md":
                yield entry


def _md_files(root: Path):
    git = _git_known_files(root)
    known, top = git if git is not None else (None, None)
    for path in sorted(_walk_md(root), key=lambda p: p.relative_to(root)):
        if known is not None and path.relative_to(top) not in known:
            continue
        yield path


def check_emoji(root: Path):
    offenses = []
    for path in _md_files(root):
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            if _EMOJI_RE.search(line):
                offenses.append(f"emoji in {path}:{i}: {line.strip()}")
    return offenses


def check_skill_md(root: Path):
    offenses = []
    skill = root / "SKILL.md"
    if not skill.is_file():
        return offenses

    text = skill.read_text(encoding="utf-8")
    if len(text.splitlines()) >= _SKILL_MAX_LINES:
        offenses.append(
            f"SKILL.md has {len(text.splitlines())} lines (limit {_SKILL_MAX_LINES})"
        )

    front = re.search(r"^---\s*\n(.*?)\n---", text, re.DOTALL)
    if not front:
        offenses.append("SKILL.md: missing YAML frontmatter")
        return offenses

    fm = front.group(1)
    if not re.search(r"^name:\s*\S+", fm, re.MULTILINE):
        offenses.append("SKILL.md frontmatter: missing 'name'")
    desc = re.search(r"^description:\s*(.*)$", fm, re.MULTILINE)
    if not desc:
        offenses.append("SKILL.md frontmatter: missing 'description'")
    else:
        value = desc.group(1).strip()
        if len(value) > _DESC_MAX:
            offenses.append(
                f"SKILL.md description is {len(value)} chars (limit {_DESC_MAX})"
            )
        if "<" in value or ">" in value:
            offenses.append("SKILL.md description contains '<' or '>'")
    return offenses


def check_backtick_paths(root: Path):
    """Every `dir/path` in backticks must exist on disk.

    Markdown link checking only covers [text](target); the prompts cite most files as
    inline code (`assets/camera/PoseFollowCameraRig.js`), which is exactly where a rename
    silently rots. Only repo directories are matched, so prose in backticks is untouched.
    """
    offenses = []
    for path in _md_files(root):
        for i, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            for target in _BACKTICK_PATH_RE.findall(line):
                if "*" in target:
                    # Glob such as `assets/game-briefs/*.brief.json`: the filename is a
                    # pattern, but the directory holding it must still exist -- and it
                    # must still match something, or the citation points at nothing.
                    prefix = target.split("*", 1)[0].rstrip("/")
                    directory = prefix if "/" in prefix else target.split("/", 1)[0]
                    if not (root / directory).is_dir():
                        offenses.append(f"broken backtick path in {path}:{i}: {target}")
                    elif not list(root.glob(target)):
                        offenses.append(f"backtick glob matches nothing in {path}:{i}: {target}")
                elif not (root / target).exists():
                    offenses.append(f"broken backtick path in {path}:{i}: {target}")
    return offenses


def check_links(root: Path):
    offenses = []
    link_re = re.compile(r"\[[^\]]*\]\(([^)]+)\)")
    for path in _md_files(root):
        text = path.read_text(encoding="utf-8")
        for target in link_re.findall(text):
            target = target.strip().split("#", 1)[0].strip()
            if not target or "*" in target or target.startswith(("<", "/")):
                continue
            if re.match(r"^[a-z][a-z0-9+.-]*:", target):  # http:, mailto:, etc.
                continue
            resolved = (path.parent / target).resolve()
            if not resolved.exists():
                offenses.append(f"broken link in {path}: {target}")
    return offenses


def check_json(root: Path):
    offenses = []
    for directory in (root / "docs" / "specs", root / "assets" / "game-briefs"):
        if not directory.is_dir():
            continue
        for path in sorted(directory.glob("*.json")):
            try:
                json.loads(path.read_text(encoding="utf-8"))
            except json.JSONDecodeError as exc:
                offenses.append(f"invalid JSON in {path}: {exc}")
    return offenses


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(
        description="Lint the skill's Markdown against the writing contract (fail loud)."
    )
    parser.add_argument(
        "root", nargs="?", default=str(REPO_ROOT), help="directory to scan (default: repo root)"
    )
    args = parser.parse_args(argv)

    root = Path(args.root).resolve()
    if not root.is_dir():
        print(f"error: not a directory: {root}", file=sys.stderr)
        return 2

    offenses = []
    offenses += check_emoji(root)
    offenses += check_skill_md(root)
    offenses += check_links(root)
    offenses += check_backtick_paths(root)
    offenses += check_json(root)

    if offenses:
        for offense in offenses:
            print(offense, file=sys.stderr)
        print(f"{len(offenses)} offense(s)", file=sys.stderr)
        return 1

    print(f"validate_md: OK ({len(list(_md_files(root)))} .md files)")
    return 0


if __name__ == "__main__":
    sys.exit(main())