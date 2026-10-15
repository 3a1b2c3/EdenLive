# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-FileCopyrightText: Copyright (c) 2026 Vast AI
# Modified by Vast AI for EdenLive.
# SPDX-License-Identifier: Apache-2.0

"""Client window used by non-rank-0 processes during distributed serving."""

from flashdreams.api_v2.client_window import IClientWindow
from flashdreams.runtime_v2.session_desc import SessionDesc
from flashdreams.runtime_v2.step_result import StepResult
from flashdreams.runtime_v2.user_input_events import UserInputEvents


class NullClientWindow(IClientWindow):
    """Participate in a distributed run without binding a local client.

    Rank 0 owns the real window. Other ranks still have to construct sessions and
    step the model, so they get a window that reports no input and discards output.
    """

    def get_user_input_events(self) -> UserInputEvents:
        """Return an empty input batch; rank 0's events are broadcast separately."""
        return UserInputEvents([])

    def open(self, session_desc: SessionDesc) -> None:
        """Ignore the session description; this window never presents output."""
        del session_desc

    def write(self, result: StepResult) -> None:
        """Drop UI frames produced on worker ranks."""
        del result

    def close(self) -> None:
        """Nothing to release."""
        return
