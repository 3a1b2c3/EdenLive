# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

"""torchrun launcher for the FlashDreams v2 CLI.

``torchrun`` runs one copy of this script per rank, so a plain ``.py`` file is a
more robust entry point than the installed ``flashdreams-run-v2`` console script
(which may not be on ``PATH`` in every shell). The v2 CLI detects ``RANK`` and
``WORLD_SIZE`` and initializes the process group before the pipeline loads.
"""

from flashdreams.runtime_v2.cli import entrypoint

if __name__ == "__main__":
    entrypoint()