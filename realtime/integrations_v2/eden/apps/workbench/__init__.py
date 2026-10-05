# SPDX-License-Identifier: Apache-2.0
"""Prompt → prototype game → photoreal first frame → realtime play workbench.

``bridge`` runs where the ``claude`` CLI lives and drives game generation and
captioning; ``flux_worker`` runs on the GPU pod and turns the game's greybox
first frame into a fine first frame. The browser reaches both through the
``/ext/workbench/`` proxy the Game2V session registers.
"""
