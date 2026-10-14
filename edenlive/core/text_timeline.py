"""Clip-relative text timelines; all times are in decoded-video seconds."""

from __future__ import annotations

import math


def clip_text_timeline(
    segments, *, start_sec: float, fps: float, num_frames: int
) -> dict:
    """Crop contiguous captions to the actual decoded-frame window.

    The last frame is at (num_frames - 1) / fps, not num_frames / fps.
    Model-specific conversion to latent frames belongs in the adapter.
    """
    fps, start_sec = float(fps), float(start_sec)
    if (
        not math.isfinite(fps)
        or fps <= 0
        or not math.isfinite(start_sec)
        or start_sec < 0
    ):
        raise ValueError(
            "text timeline requires positive finite fps and nonnegative start_sec"
        )
    if int(num_frames) != num_frames or num_frames < 2:
        raise ValueError("text timeline requires num_frames >= 2")
    if not isinstance(segments, (list, tuple)) or not segments:
        raise ValueError("text timeline requires a nonempty segment list")
    duration = (num_frames - 1) / fps
    end_sec = start_sec + duration
    clipped = []
    previous_end = None
    for segment in segments:
        start, end = float(segment["start_sec"]), float(segment["end_sec"])
        text = segment["text"]
        if (
            not math.isfinite(start)
            or not math.isfinite(end)
            or start < 0
            or end <= start
        ):
            raise ValueError(
                "text timeline segments require finite 0 <= start_sec < end_sec"
            )
        if not isinstance(text, str):
            raise TypeError("text timeline segment text must be a string")
        if previous_end is not None and not math.isclose(
            start, previous_end, abs_tol=1e-6, rel_tol=0
        ):
            raise ValueError(
                "text timeline must be ordered and contiguous, without gaps or overlaps"
            )
        previous_end = end
        left, right = max(start, start_sec), min(end, end_sec)
        if right > left:
            clipped.append(
                dict(start_sec=left - start_sec, end_sec=right - start_sec, text=text)
            )
    if (
        not clipped
        or not math.isclose(clipped[0]["start_sec"], 0, abs_tol=1e-6)
        or not math.isclose(clipped[-1]["end_sec"], duration, abs_tol=1e-6)
    ):
        raise ValueError("text timeline does not cover the requested video window")
    clipped[0]["start_sec"] = 0.0
    clipped[-1]["end_sec"] = duration
    return dict(segments=clipped, fps=fps, num_frames=int(num_frames))
