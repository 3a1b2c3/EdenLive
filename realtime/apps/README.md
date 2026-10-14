<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

Reusable applications built on the v2 API. Each directory is a standalone
package that depends on `flashdreams` and stays model-agnostic: an app runs
against a stub network, and binding a real model is the adapter's job, in
`integrations_v2/<model>/apps/<demo>/adapter.py`.

## The layout

```text
apps/<app_slug>/
  <app_slug>/          # the app implementation
  tests/               # validate the app against a stub, not a real model
  pyproject.toml
  README.md            # purpose, controls, example command line, options
```

Tests live in `apps/<app_slug>/tests/`, beside the package rather than inside
it, and must not import from `integrations_v2/`. A check that needs a real
model or its adapter belongs in `integrations_v2/<model>/tests/`.

## What is here

- `cam2v` — interactive camera-to-video. The Eden game2v app imports its
  conditioning code; the other upstream apps are not carried in this fork.

Each app's own README covers how to launch it and what the controls are. To
bind a model to one of these, see `integrations_v2/eden/` for the Eden example.
