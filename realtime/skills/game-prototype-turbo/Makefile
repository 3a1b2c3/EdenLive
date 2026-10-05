# Makefile — repository checks plus opt-in generated-run gates.
#
# The default target validates the shipped skill without requiring ignored run
# artifacts. Run gate1 and gate2 deliberately against generated prototypes.
#
# All targets are phony: there are no build artefacts.
#
# Usage:
#   make          # run repository checks
#   make lint     # doc lint and factory catalog coverage
#   make test-js  # just the JS suite
#   make test-browser # browser suite; fails if dependencies are unavailable
#   make PYTHON=/path/to/python # select an installed Python 3.10+ interpreter
#   make gate1    # stage-1 static-scene gate (needs Playwright + Chromium)
#   make gate2    # stage-2 real-input behavior gate (Playwright + Chromium)
#   make all      # everything, same as bare `make`

PYTHON ?= python3
NODE   ?= node

.PHONY: all lint test-js test-py test-browser gate1 gate2 clean

all: lint test-js test-py

# --- repository checks (isolated fixtures) ---------------------------------

lint:
	$(PYTHON) forge/validate_md.py
	$(PYTHON) forge/check_factory_drift.py

test-js:
	$(NODE) --test "forge/tests/js/*.test.mjs"

test-py:
	$(PYTHON) -m pytest forge/tests -q

# test-py skips browser cases if optional dependencies are absent. This target
# requires them so CI can distinguish missing coverage from a successful run.
test-browser:
	$(PYTHON) -m pytest forge/tests -q -m slow --require-browser

# --- gates (heavier) --------------------------------------------------------

gate2:
	@test -n "$(RUNS)" -a -n "$(RUN)" -a -n "$(EVIDENCE)" || (echo 'Set RUNS=<runs-dir> RUN=<name> EVIDENCE=<dir>'; exit 2)
	$(PYTHON) forge/check_step2.py --runs "$(RUNS)" --only "$(RUN)" --output "$(EVIDENCE)"

# Stage-1 gate checks static scenes in headless Chromium via Playwright,
# so it is slower and needs a GPU or SwiftShader. Run it deliberately.
gate1:
	@test -n "$(RUNS)" -a -n "$(RUN)" -a -n "$(EVIDENCE)" || (echo 'Set RUNS=<runs-dir> RUN=<name> EVIDENCE=<dir>'; exit 2)
	$(PYTHON) forge/check_step1.py --runs "$(RUNS)" --only "$(RUN)" --output "$(EVIDENCE)"

# --- housekeeping ------------------------------------------------------------

clean:
	rm -rf forge/__pycache__ forge/_shared/__pycache__ forge/tests/__pycache__ .pytest_cache
