"""Timestamp-aligned recording inputs with explicit spatial transforms."""

from __future__ import annotations

import json
import math
from pathlib import Path

from edenlive.data.dataset_manifest import ManifestDataset


def prepare_recording(
    recording, *, width, height, fps, max_frames=None, cover_path=None
):
    import av
    import numpy as np
    import torch
    import torch.nn.functional as F
    from PIL import Image

    recording = Path(recording)
    metadata = json.loads((recording / "prompts.json").read_text())
    video_path = recording / "recording.mp4"
    with av.open(str(video_path)) as container:
        stream = container.streams.video[0]
        sw, sh = source_size = (stream.width, stream.height)
        if sw <= 0 or sh <= 0 or not 4 * 1280 * sh <= 5 * sw * 704 <= 6 * 1280 * sh:
            raise ValueError("Recording aspect ratio must be within 20% of 1280/704")
        cw, ch = (
            min(sw, round(sh * width / height)),
            min(sh, round(sw * height / width)),
        )
        left, top = (sw - cw) // 2, (sh - ch) // 2
        crop_box = (left, top, left + cw, top + ch)
        duration = float(stream.duration * stream.time_base)
        timestamps = np.array(
            [float(frame.time) for frame in container.decode(video=0)]
        )
    timestamps -= timestamps[0]
    available = math.floor(duration * fps)
    if max_frames is not None:
        available = min(available, int(max_frames))
    num_frames = 4 * ((available - 1) // 4) + 1
    if num_frames < 5:
        raise ValueError("Recording needs at least five frames at the target FPS")
    indices = np.searchsorted(
        (timestamps[:-1] + timestamps[1:]) / 2, np.arange(num_frames) / fps
    )
    proxy = torch.empty(3, (num_frames - 1) // 4 + 1, height, width)
    target = 0
    with av.open(str(video_path)) as container:
        for index, frame in enumerate(container.decode(video=0)):
            if target == num_frames:
                break
            if index != indices[target]:
                continue
            if (frame.width, frame.height) != source_size:
                raise ValueError("Recording frame dimensions changed")
            rgb = frame.to_ndarray(format="rgb24")
            if source_size != (width, height):
                picture = Image.fromarray(rgb).crop(crop_box)
                rgb = np.asarray(
                    picture.resize((width, height), Image.Resampling.BILINEAR)
                )
            while target < num_frames and indices[target] == index:
                if target % 4 == 0:
                    proxy[:, target // 4] = (
                        torch.from_numpy(rgb.copy()).permute(2, 0, 1).float() / 127.5
                        - 1
                    )
                target += 1
    if target != num_frames:
        raise ValueError(f"Decoded {target} frames, expected {num_frames}")
    cover = (
        torch.from_numpy(
            np.array(Image.open(cover_path or recording / "cover.png").convert("RGB"))
        )
        .permute(2, 0, 1)
        .float()
    )
    scale = max(height / cover.shape[1], width / cover.shape[2])
    cover = F.interpolate(
        cover[None],
        size=(math.ceil(cover.shape[1] * scale), math.ceil(cover.shape[2] * scale)),
        mode="bilinear",
        align_corners=False,
    )[0]
    top, left = (cover.shape[1] - height) // 2, (cover.shape[2] - width) // 2
    cover = cover[:, top : top + height, left : left + width].contiguous() / 127.5 - 1
    info = dict(
        num_frames=num_frames,
        fps=fps,
        width=width,
        height=height,
        source_frame_indices=indices.tolist(),
        source_timestamps_seconds=timestamps[indices].tolist(),
        spatial_transform=dict(
            source_size=list(source_size),
            crop_box=list(crop_box),
            output_size=[width, height],
            resize_filter="bilinear",
        ),
        media_duration_seconds=duration,
    )
    return proxy, cover, info, metadata


class RecordingManifestDataset(ManifestDataset):
    """Manifest rows select recording directories with cover and prompt events."""

    def __init__(
        self,
        path,
        root=None,
        *,
        width,
        height,
        fps,
        max_frames=None,
        text_mode="global",
        dynamic=True,
        chunk_size=3,
    ):
        self.path = Path(path)
        self.root = Path(root or ".")
        self.rows = self._read_rows(self.path)
        if not self.rows:
            raise ValueError(f"Manifest {path} is empty")
        if text_mode not in {"global", "chunk", "timeline"}:
            raise ValueError("text_mode must be global, chunk, or timeline")
        self.repeat = 1
        self.id_column = "id"
        self.profile = dict(
            width=int(width), height=int(height), fps=float(fps), max_frames=max_frames
        )
        self.text_mode, self.dynamic, self.chunk_size = (
            text_mode,
            bool(dynamic),
            int(chunk_size),
        )

    def __getitem__(self, index):
        row = self.rows[index]
        recording = (self.root / row["proxy_video"]).parent
        cover = self.root / row["first_frame"] if row.get("first_frame") else None
        proxy, image, info, prompts = prepare_recording(
            recording, **self.profile, cover_path=cover
        )
        conditions = dict(
            text=prompts["staticPrompt"], image=image, video_context=proxy
        )
        if self.text_mode == "chunk":
            conditions["chunk_prompts"] = [
                item["prompt"]
                for item in prompt_schedule(
                    prompts,
                    info["num_frames"],
                    dynamic=self.dynamic,
                    fps=info["fps"],
                    chunk_size=self.chunk_size,
                )
            ]
        elif self.text_mode == "timeline":
            conditions["text_timeline"] = text_timeline(
                prompts, info["num_frames"], info["fps"], dynamic=self.dynamic
            )
        return dict(
            conditions=conditions,
            metadata=dict(
                id=row.get(self.id_column),
                row_index=index,
                input=info,
                condition_metadata=dict(
                    video_context=dict(
                        value_range="-1,1",
                        num_frames=info["num_frames"],
                        fps=info["fps"],
                    )
                ),
            ),
        )


def prompt_schedule(metadata, num_frames, dynamic=True, fps=24, chunk_size=3):
    rows = []
    latent_frames = (num_frames - 1) // 4 + 1
    for start in range(0, latent_frames, chunk_size):
        end = min(start + chunk_size, latent_frames)
        # Wan decodes latent 0 to one frame, every later latent to four frames.
        first = max(0, 4 * start - 3)
        stop = 4 * end - 3
        start_ms, end_ms = first * 1000 / fps, stop * 1000 / fps
        events = [
            event
            for event in metadata.get("dynamicPrompts", [])
            if dynamic and event["startMs"] < end_ms and event["endMs"] > start_ms
        ]
        texts = list(dict.fromkeys(event["text"] for event in events))
        rows.append(
            {
                "start_latent": start,
                "latent_frames": end - start,
                "start_ms": start_ms,
                "end_ms": end_ms,
                "events": events,
                "prompt": " ".join([metadata["staticPrompt"], *texts]),
            }
        )
    return rows


def text_timeline(metadata, num_frames, fps, dynamic=True):
    # Latent zero represents frame zero; each subsequent latent represents four
    # decoded frames. Keep every event touching those frames, including brief or
    # overlapping events, then merge neighboring latents with identical text.
    segments = []
    for index in range((num_frames - 1) // 4 + 1):
        first, stop = max(0, 4 * index - 3), 4 * index + 1
        texts = list(
            dict.fromkeys(
                event["text"]
                for event in metadata.get("dynamicPrompts", [])
                if dynamic
                and event["startMs"] < stop * 1000 / fps
                and event["endMs"] > first * 1000 / fps
            )
        )
        text = " ".join([metadata["staticPrompt"], *texts])
        # The adapter assigns latent i at timestamp 4*i/fps to the segment
        # ending there. A first-frame-only segment needs a positive boundary.
        end = max(0.5, 4 * index) / fps
        if segments and segments[-1]["text"] == text:
            segments[-1]["end_sec"] = end
            segments[-1]["latent_frames"] += 1
        else:
            segments.append(
                dict(
                    start_sec=segments[-1]["end_sec"] if segments else 0.0,
                    end_sec=end,
                    text=text,
                    start_latent=index,
                    latent_frames=1,
                )
            )
    return dict(segments=segments, fps=fps, num_frames=num_frames)
