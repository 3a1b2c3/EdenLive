# SPDX-License-Identifier: Apache-2.0
"""Run ``claude -p`` as a cancellable subprocess and summarize its stream."""

from __future__ import annotations

import asyncio
import json
import os
import signal
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CLAUDE = os.environ.get("EDEN_WORKBENCH_CLAUDE", "claude")


@dataclass
class AgentResult:
    ok: bool
    text: str
    cost_usd: float | None = None
    error: str | None = None


def _tool_summary(name: str, payload: dict[str, Any]) -> str:
    for key in ("command", "file_path", "path", "pattern", "description", "url"):
        value = payload.get(key)
        if isinstance(value, str) and value:
            text = " ".join(value.split())
            # Heredocs and inline scripts would flood the log; the first line is enough.
            return f"{name}: {text[:200]}{'…' if len(text) > 200 else ''}"
    return name


def summarize(event: dict[str, Any]) -> list[str]:
    """Turn one stream-json event into human log lines."""
    kind = event.get("type")
    if kind == "assistant":
        lines = []
        for block in event.get("message", {}).get("content") or ():
            if block.get("type") == "text" and block.get("text", "").strip():
                lines.append("say  " + " ".join(block["text"].split()))
            elif block.get("type") == "tool_use":
                lines.append("tool " + _tool_summary(block.get("name", "?"), block.get("input") or {}))
        return lines
    if kind == "result":
        return [f"done {event.get('subtype')} in {event.get('duration_ms', 0) / 1000:.0f}s"]
    return []


def claude_command(*, add_dirs: Sequence[Path], unattended: bool, allowed_tools: Sequence[str] = ()) -> list[str]:
    """The prompt goes on stdin: ``--add-dir`` and ``--allowedTools`` are
    variadic and would swallow a trailing prompt argument."""
    command = [CLAUDE, "-p", "--output-format", "stream-json", "--verbose"]
    if unattended:
        # A generation run has nobody to approve tool calls; the bridge confines
        # it to its project directory as the working directory instead.
        command.append("--dangerously-skip-permissions")
    for tool in allowed_tools:
        command += ["--allowedTools", tool]
    for directory in add_dirs:
        command += ["--add-dir", str(directory)]
    return command


class Agent:
    """One ``claude -p`` run. ``cancel()`` kills its whole process group."""

    def __init__(self, command: list[str], prompt: str, *, cwd: Path, env: dict[str, str], on_line: Callable[[str], None]) -> None:
        self.command = command
        self.prompt = prompt
        self.cwd = cwd
        self.env = env
        self.on_line = on_line
        self._process: asyncio.subprocess.Process | None = None
        self.cancelled = False

    async def run(self, timeout_s: float) -> AgentResult:
        self._process = await asyncio.create_subprocess_exec(
            *self.command,
            cwd=self.cwd,
            env=self.env,
            stdin=asyncio.subprocess.PIPE,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
            start_new_session=True,
            limit=16 * 1024 * 1024,
        )
        assert self._process.stdin is not None
        self._process.stdin.write(self.prompt.encode("utf-8"))
        await self._process.stdin.drain()
        self._process.stdin.close()
        final: dict[str, Any] | None = None

        async def consume() -> None:
            nonlocal final
            assert self._process is not None and self._process.stdout is not None
            async for raw in self._process.stdout:
                line = raw.decode("utf-8", "replace").strip()
                if not line:
                    continue
                try:
                    event = json.loads(line)
                except json.JSONDecodeError:
                    self.on_line("log  " + line[:500])
                    continue
                if event.get("type") == "result":
                    final = event
                for text in summarize(event):
                    self.on_line(text)
            await self._process.wait()

        try:
            await asyncio.wait_for(consume(), timeout_s)
        except asyncio.TimeoutError:
            self.cancel()
            return AgentResult(False, "", error=f"Claude did not finish within {timeout_s / 60:.0f} minutes.")
        if self.cancelled:
            return AgentResult(False, "", error="Cancelled.")
        if final is None:
            return AgentResult(False, "", error=f"Claude exited with code {self._process.returncode} and no result.")
        return AgentResult(
            ok=not final.get("is_error") and final.get("subtype") == "success",
            text=str(final.get("result") or ""),
            cost_usd=final.get("total_cost_usd"),
            error=None if final.get("subtype") == "success" else str(final.get("subtype")),
        )

    def cancel(self) -> None:
        self.cancelled = True
        if self._process is not None and self._process.returncode is None:
            try:
                os.killpg(self._process.pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
