#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
cd "$project_dir"
step=step1
for candidate in step3 step2 step1; do
    for entry in "runs/$candidate"/*/index.html; do
        if [ -f "$entry" ]; then step=$candidate; break 2; fi
    done
done
case "${1-}" in
    step1|step2|step3) step=$1; shift ;;
    ""|--*) ;;
    *) printf '%s\n' "Usage: $0 [step1|step2|step3] [server options]" >&2; exit 2 ;;
esac
if [ ! -d "runs/$step" ]; then
    printf '%s\n' "No runs/$step directory in $project_dir" >&2
    exit 2
fi
# PYTHON overrides the interpreter; otherwise python3, then python (Windows installs often lack python3).
python_bin=${PYTHON:-python3}
if ! command -v "$python_bin" >/dev/null 2>&1; then python_bin=python; fi
exec "$python_bin" "$project_dir/serve_step.py" --runs "runs/$step" "$@"
