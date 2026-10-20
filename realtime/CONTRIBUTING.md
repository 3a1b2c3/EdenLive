<!-- Modified by Vast AI for EdenLive. Copyright (c) 2026 Vast AI. -->

# Contributing to FlashDreams

Thanks for your interest in contributing to **FlashDreams**. This project
is developed openly on GitHub and released under the
[Apache License 2.0](https://github.com/NVIDIA/flashdreams/blob/main/LICENSE). Outside contributions — bug reports,
feature requests, performance improvements, new model integrations,
documentation fixes — are genuinely welcome, and this guide explains how
they fit in alongside the project's day-to-day work.

We have intentionally kept the process light. If something below is
unclear or feels heavier than it should be, that's a bug; please file an
issue and we'll fix it.

## Table of contents

1. [Ways to contribute](#ways-to-contribute)
2. [Project governance](#project-governance)
3. [Developer Certificate of Origin (DCO)](#developer-certificate-of-origin-dco)
4. [Submitting a pull request](#submitting-a-pull-request)
5. [Code review and merge](#code-review-and-merge)
6. [File Tree Of FlashDreams](#file-tree-of-flashdreams)
7. [Coding conventions](#coding-conventions)
8. [Testing](#testing)
9. [Dependency version bounds](#dependency-version-bounds)
10. [Working with a single integration package](#working-with-a-single-integration-package)
11. [Licensing of contributions](#licensing-of-contributions)
12. [Reporting issues](#reporting-issues)
13. [Code of Conduct](#code-of-conduct)

## Ways to contribute

There are several useful ways to help out, ordered roughly from "low
overhead" to "high overhead":

- **Try FlashDreams and tell us what broke.** A clear bug report — what
  you ran, what you expected, what you saw — is one of the most valuable
  contributions a project of this kind can receive.
- **Improve documentation.** README clarifications, integration walkthroughs,
  performance notes, and FAQ entries all land easily and benefit every
  future user.
- **Fix bugs.** Issues labelled `good first issue` are a friendly
  starting point. Larger fixes are welcome too — please leave a comment
  on the relevant issue first so we can avoid duplicate work.
- **Add or extend integrations.** New video-generation models, new schedulers,
  new integrations. For non-trivial features, please open a design issue
  before sending the PR (see [Submitting a pull request](#submitting-a-pull-request)).
- **Performance work.** FlashDreams cares about latency and throughput
  on NVIDIA GPUs. Numbers and reproducible benchmarks make these PRs
  easy to evaluate.

## Project governance

FlashDreams was developed inside NVIDIA's Simulation & Imitation
Learning group, and at the time of release NVIDIA holds the
maintainer and admin roles on the
[`NVIDIA/flashdreams`](https://github.com/NVIDIA/flashdreams) repository.
That includes the `main` branch protections, release tags, the package
publishing keys, and the right to merge.

We treat that as a starting point, not an endpoint. Our intent — modelled
on projects like [Slang](https://github.com/shader-slang/slang), which
moved from a single-vendor home to community governance once it grew an
external user base — is to open governance up as a contributor community
develops. Concretely, that means:

- **CODEOWNERS is the source of truth for review responsibility.** As
  contributors take long-term ownership of a subsystem, they get added
  there and become required reviewers for changes in that area, NVIDIA
  employee or not.
- **Decisions happen in public.** Significant design changes are
  discussed in GitHub issues, pull requests, or
  [Discussions](https://github.com/NVIDIA/flashdreams/discussions).
  Internal NVIDIA roadmap planning that touches the public project will
  surface as a public issue before it lands.
- **Release notes credit external contributors** by name and PR.
- **Open path to maintainer.** Contributors who consistently land
  high-quality work in an area, participate in reviews, and engage with
  the issue tracker can be invited to become maintainers. There is no
  fixed time bar; sustained good judgment is what we look for.

If you have feedback on governance — including things you'd like to see
formalised faster — please open a Discussion. We'd rather hear it than
not.

## Developer Certificate of Origin (DCO)

**This project will only accept contributions under the Apache-2.0
license.** By submitting a pull request you agree that your
contribution is licensed under the Apache License, Version 2.0 (see
[LICENSE](https://github.com/NVIDIA/flashdreams/blob/main/LICENSE)).

All contributions to FlashDreams are made under the
[Developer Certificate of Origin](https://developercertificate.org/).
This is a lightweight, well-understood mechanism (used by the Linux
kernel, GitLab, NVIDIA TensorRT, and many other projects) that lets you
attest that you have the right to submit your contribution under the
project's license — without requiring a separate Contributor License
Agreement.

Full text of the [Developer Certificate of Origin](https://developercertificate.org/):

```
Developer Certificate of Origin
Version 1.1

Copyright (C) 2004, 2006 The Linux Foundation and its contributors.

Everyone is permitted to copy and distribute verbatim copies of this
license document, but changing it is not allowed.


Developer's Certificate of Origin 1.1

By making a contribution to this project, I certify that:

(a) The contribution was created in whole or in part by me and I
    have the right to submit it under the open source license
    indicated in the file; or

(b) The contribution is based upon previous work that, to the best
    of my knowledge, is covered under an appropriate open source
    license and I have the right under that license to submit that
    work with modifications, whether created in whole or in part
    by me, under the same open source license (unless I am
    permitted to submit under a different license), as indicated
    in the file; or

(c) The contribution was provided directly to me by some other
    person who certified (a), (b) or (c) and I have not modified
    it.

(d) I understand and agree that this project and the contribution
    are public and that a record of the contribution (including all
    personal information I submit with it, including my sign-off) is
    maintained indefinitely and may be redistributed consistent with
    this project or the open source license(s) involved.
```

Pull requests without DCO sign-off will be asked to rebase before merge.
This is a hard gate; please don't take a polite ping personally.

NVIDIA contributors and external contributors follow the *same* DCO
process. NVIDIA-internal IP review, where applicable, is handled by
NVIDIA reviewers on your behalf — you do not need to engage with it as
an outside contributor.

### Signing Your Work

We require that all contributors sign-off on their commits. This
certifies that the contribution is your original work, or you have
rights to submit it under the same license, or a compatible license.
Any contribution which contains commits that are not Signed-Off will
not be accepted.

To sign off on a commit, use the `--signoff` (or `-s`) option when
committing your changes:

```bash
$ git commit -s -m "Add cool feature."
```

This will append the following trailer to your commit message:

```
Signed-off-by: Your Name <your@email.com>
```

The `user.name` and `user.email` git config values must be set to your
real name and a verifiable email address — sign-offs from anonymous or
pseudonymous identities cannot be accepted.

## Submitting a pull request

The short version:

1. Fork the repo on GitHub and create a feature branch from `main`.
2. Make your changes. Keep PRs small and focused; a 200-line PR that
   does one thing reviews much faster than a 2000-line PR that does ten.
3. Add or update tests where it makes sense. Every test must carry
   exactly one CI tier marker (`@pytest.mark.ci_cpu`,
   `@pytest.mark.ci_gpu`, or `@pytest.mark.manual`); see
   [Testing](#testing) below. This fork uses the markers by convention;
   it does not include the upstream enforcement plugin.
4. Run the project's checks locally:

   ```bash
   pre-commit run -a                            # format + lint + type-check
   pytest -m ci_cpu                             # CPU tests (no GPU required)
   ```

5. Sign off your commits (`git commit --signoff`) and push to your fork.
6. Open a pull request against `main`. Fill in the PR template, include
   any context a reviewer would need that isn't obvious from the diff,
   and link the issue your PR resolves if there is one.

For larger features (a new integration, a substantial refactor, a new
integration), please open an issue first to discuss the design. This
saves everyone time and gives you a chance to surface trade-offs before
investing implementation effort.

## Code review and merge

- Every pull request requires CI to pass and at least one approving
  review from a maintainer or designated CODEOWNER for the touched area.
- For changes that span multiple subsystems, expect reviews from each
  affected CODEOWNER.
- We squash-merge to keep `main`'s history readable. The PR title and
  description become the squash commit message — please make them
  descriptive and reviewer-facing.
- `main` is gated by GitHub's **merge queue**. Once your PR is approved
  and CI is green, click "Merge when ready" — GitHub will rebase your
  branch on top of `main` plus any earlier queued PRs, re-run the
  required checks against that combined state, and only land the merge
  if everything is still green. You do not need to manually rebase or
  re-run CI when another PR lands first. PRs that would conflict or
  fail after rebase are kicked back out of the queue automatically.
  Maintainers: do not enable "Require branches to be up to date before
  merging" alongside the queue — they're redundant, and enabling both
  reintroduces the rebase-storm problem the queue exists to solve.
- If a review comment is unclear, ask. We'd rather have a 30-second
  clarifying exchange than a misunderstanding turning into rework.

We aim for an initial review on every PR within two business days. If
your PR has been quiet longer than that, please feel free to leave a
short ping comment.

## File Tree Of FlashDreams

Where a new app or model goes. Each documents its own layout:

```text
apps/                           # reusable apps; layout in apps/README.md
integrations_v2/                # model packages; layout in integrations_v2/eden/README.md
```

The framework package, and the test and doc trees:

```text
flashdreams/flashdreams/        # the framework package
  core/                         # numerical primitives, checkpoint loading, attention, I/O
  infra/                        # framework contracts: configs, pipelines, encoders/decoders, schedulers, runners
  recipes/                      # built-in reusable recipe code (WAN, TAEHV)
  api_v2/                       # protocols an application implements
  runtime_v2/                   # the two-thread loop that runs an application
  runtime/                      # experimental inference runtime API envelope (v0, pre-v2)
  serving/                      # serving utilities (WebRTC, network, launch)
  plugins/                      # external-runner plugin layer (RunnerConfig discovery)

integrations_v2/eden/tests/     # the only test suite in this fork
```

This fork is trimmed to the Eden game2v deployment, so the subtrees that served
the other integrations — `demo/`, `accelerated/`, `quality/`, `configs/`,
`scripts/`, `_pytest_plugins/`, the framework test trees, and `docs/source/` —
are not present. They live [upstream](https://github.com/NVIDIA/flashdreams).

## Coding conventions

- Python 3.10+. Type-annotate new code; the project type-checks with
  [`ty`](https://docs.astral.sh/ty/).
- Formatting is enforced by `ruff` via pre-commit (`pre-commit
  run -a`). The CI will reject unformatted code; running pre-commit
  locally is the easiest way to avoid surprises.
- Prefer small, well-named functions over long functions with comments
  explaining each block. Comments should explain *why*, not *what*.
- Tests live next to the thing they validate — see the File Tree Of
  FlashDreams above. Use `pytest` and prefer existing fixtures over
  hand-rolled setup. See
  [Testing](#testing) for discovery and marker requirements.
- Every source file added by a contribution must include the SPDX
  header used elsewhere in the project:

  ```python
  # SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
  # SPDX-License-Identifier: Apache-2.0
  #
  # Licensed under the Apache License, Version 2.0 (the "License");
  # you may not use this file except in compliance with the License.
  # You may obtain a copy of the License at
  #
  # http://www.apache.org/licenses/LICENSE-2.0
  #
  # Unless required by applicable law or agreed to in writing, software
  # distributed under the License is distributed on an "AS IS" BASIS,
  # WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  # See the License for the specific language governing permissions and
  # limitations under the License.
  ```

  External contributors should add their own copyright line *above* the
  NVIDIA line if they wish to be attributed; both attributions are
  retained.

## Testing

Pytest collection is configured in `realtime/pyproject.toml`. Running `pytest`
from `realtime/` collects `apps/cam2v/tests` and `integrations_v2/eden/tests`:

- Files named `test_*.py`. Pytest's default also collects `*_test.py`;
  don't use that name here.
- Classes named `Test*` (pytest default). Some modules use classes,
  some only module-level functions.
- Functions and methods named `test_*` (pytest default), including
  `async def test_*`.

Same test filename in different folders is fine (several
`test_application.py` files exist). Root `pyproject.toml` already sets
`--import-mode=importlib` so pytest keeps them separate. Do not remove
that flag.

A `test_*.py` under either test directory is collected automatically.
The vendored game-authoring skill uses a separate test entry point: run
`python -m pytest forge/tests -q -m "not slow"` from `skills/edengolem/`.
The runtime configuration skips `parity_check`,
`parity_check_v2`, `baseline_fastvideo`, and `baseline_lightx2v` via
`norecursedirs`.

Every test function must be marked with exactly one **CI tier marker**.
Upstream enforces this at collection time with a pytest plugin
(`flashdreams._pytest_plugins.marker_enforcement`); this fork does not
carry the plugin, so the rule is a convention here, not a check.

| Marker | When to use | CI runner |
|--------|-------------|-----------|
| `@pytest.mark.ci_cpu` | Pure CPU logic, no GPU or `libGL` needed | CPU runner |
| `@pytest.mark.ci_gpu` | Needs CUDA, `libGL`, or transitive `cv2` | GPU runner (RTX Pro 6000) |
| `@pytest.mark.manual` | Heavy (OOM risk), flaky, needs credentials or large downloads | Not run in CI |

Use a module-level `pytestmark` when every test in a file shares the
same marker:

```python
import pytest

pytestmark = pytest.mark.ci_cpu
```

Use per-function markers when tests in the same file have different
tiers:

```python
@pytest.mark.ci_cpu
def test_basic_math(): ...

@pytest.mark.ci_gpu
def test_cudagraph_path(): ...
```

Running tests locally:

```bash
pytest -m ci_cpu          # CPU-safe tests only
pytest -m ci_gpu          # GPU tests only (needs CUDA)
pytest -m "not manual"    # everything that runs in CI
pytest                    # all tests including manual
```

## Dependency version bounds

The `flashdreams/pyproject.toml` declares minimum version bounds for all
runtime dependencies. These bounds reflect the oldest versions we believe
are compatible based on API analysis.

**CI tests run against the versions pinned in [`requirements.txt`](requirements.txt)**,
not against the declared minimums. This means:

- We guarantee correctness at the pinned versions.
- We expect the package to work at the declared minimum bounds, but do
  not continuously validate this in CI.
- If you encounter breakage with a version that satisfies the declared
  bounds but differs from the pinned versions, please
  [open an issue](https://github.com/NVIDIA/flashdreams/issues). We will
  either fix compatibility or bump the bound in `pyproject.toml`.

## Installing

This fork is installed with pip, not uv. From `realtime/`:

```bash
pip install torch==2.13.0 torchvision==0.28.0 \
    --index-url https://download.pytorch.org/whl/cu130
pip install --no-deps -e ./flashdreams -e ./apps/cam2v \
    -e ./integrations_v2/eden
pip install -r requirements.txt
```

`requirements.txt` pins the versions the deployment was verified with; see
[`README.md`](README.md) for the CUDA wheel index and the Chromium and three.js
steps. The test suite is `integrations_v2/eden/tests/`:

```bash
pytest integrations_v2/eden/tests/
```

Packages in this fork:

| Path | Distribution |
|------|--------------|
| `flashdreams` | `flashdreams` |
| `integrations_v2/eden` | `flashdreams-eden` |
| `apps/cam2v` | `flashdreams-cam2v` |

`flashdreams-eden` depends on `flashdreams` and `flashdreams-cam2v`: `game2v`
imports `Cam2VConditioning` from the second.

## Licensing of contributions

By submitting a pull request to this repository, you agree that your
contribution is licensed under the
[Apache License, Version 2.0](https://github.com/NVIDIA/flashdreams/blob/main/LICENSE), the same license under which
FlashDreams is distributed. The DCO sign-off described above is your
attestation that you have the right to make that grant.

Third-party code (i.e. code you did not write yourself, but that you
have the right to redistribute under a compatible license) may be
contributed only if:

1. its license is compatible with Apache-2.0;
2. its origin and license are clearly recorded in
   [`REUSE.toml`](https://github.com/NVIDIA/flashdreams/blob/main/REUSE.toml) and
   [`THIRD-PARTY-NOTICES`](https://github.com/NVIDIA/flashdreams/blob/main/THIRD-PARTY-NOTICES);
3. its files retain whatever attribution headers the upstream license
   requires.

If you are not sure whether something is contributable, please ask in
an issue before sending the code — it's much easier to sort out
upfront.

## Reporting issues

Use [GitHub Issues](https://github.com/NVIDIA/flashdreams/issues) to report
functional defects and to request improvements. Please do not include
confidential or customer information.

Do not file security vulnerabilities as public issues. Follow the coordinated
disclosure process in
[SECURITY.md](https://github.com/NVIDIA/flashdreams/blob/main/SECURITY.md).

## Code of Conduct

This project follows the
[Code of Conduct](https://github.com/NVIDIA/flashdreams/blob/main/CODE_OF_CONDUCT.md).
By participating in this project — including issues, discussions, and
pull requests — you agree to abide by it. Please report concerns to the
maintainers via the address listed in the Code of Conduct.

---

Thanks again for contributing. The project is more useful, more correct,
and more interesting because outside contributors take the time to send
their work upstream. We appreciate it.
