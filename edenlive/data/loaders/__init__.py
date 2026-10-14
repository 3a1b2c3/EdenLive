from __future__ import annotations

import math
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable


ConditionLoader = Callable[[Any, dict[str, Any]], Any]


@dataclass
class LoadedCondition:
    data: Any
    metadata: dict[str, Any]


def _is_missing(value: Any) -> bool:
    if value is None:
        return True
    try:
        import math

        if isinstance(value, float) and math.isnan(value):
            return True
    except Exception:
        pass
    text = str(value)
    return text == "" or text.lower() in {"none", "null", "nan"}


def load_condition(value: Any, loader: str, cfg: dict[str, Any] | None = None) -> Any:
    if _is_missing(value):
        return None
    cfg = cfg or {}
    if loader not in LOADERS:
        available = ", ".join(sorted(LOADERS))
        raise KeyError(f"Unknown condition loader {loader!r}; available: {available}")
    return LOADERS[loader](value, cfg)


def _resolve_path(value: Any, cfg: dict[str, Any]) -> Path:
    path = Path(str(value))
    root = cfg.get("root")
    if root and not path.is_absolute() and "://" not in str(path) and ":" not in str(path).split("/", 1)[0]:
        path = Path(str(root)) / path
    return path


def _text(value: Any, cfg: dict[str, Any]) -> str:
    return str(value)


def _image(value: Any, cfg: dict[str, Any]) -> Any:
    import numpy as np
    import torch
    from PIL import Image

    with Image.open(_resolve_path(value, cfg)) as source:
        image = source.convert(cfg.get("mode", "RGB"))
        if cfg.get("resize_mode") == "center_crop":
            if "height" not in cfg or "width" not in cfg:
                raise ValueError("image center_crop requires both height and width")
            array = np.array(image, copy=True)
            frames = torch.from_numpy(array).permute(2, 0, 1).unsqueeze(0)
            tensor = _resize_center_crop_frames(frames, int(cfg["height"]), int(cfg["width"]))[0]
        elif "size" in cfg:
            image = image.resize(tuple(cfg["size"]))
            # PIL-backed arrays can be read-only; make the tensor source writable.
            array = np.array(image, copy=True)
            tensor = torch.from_numpy(array).permute(2, 0, 1).contiguous().float()
        else:
            # PIL-backed arrays can be read-only; make the tensor source writable.
            array = np.array(image, copy=True)
            tensor = torch.from_numpy(array).permute(2, 0, 1).contiguous().float()
    tensor = tensor / 255.0
    if cfg.get("value_range") == "-1,1":
        tensor = tensor * 2.0 - 1.0
    return tensor


def _resize_center_crop_frames(frames, height: int, width: int):
    """Resize ``[T,C,H,W]`` RGB frames and take a centered spatial crop."""

    import torch.nn.functional as F

    if height < 1 or width < 1:
        raise ValueError(f"video/image output size must be positive, got {height}x{width}")
    frames = frames.float()
    input_height, input_width = (int(value) for value in frames.shape[-2:])
    scale = max(height / input_height, width / input_width)
    resize_height = max(height, int(math.ceil(input_height * scale)))
    resize_width = max(width, int(math.ceil(input_width * scale)))
    frames = F.interpolate(frames, size=(resize_height, resize_width), mode="bilinear", align_corners=False)
    top = max(0, (resize_height - height) // 2)
    left = max(0, (resize_width - width) // 2)
    return frames[:, :, top : top + height, left : left + width].contiguous()


def _video(value: Any, cfg: dict[str, Any]) -> LoadedCondition:
    """Load a deterministic RGB clip as ``[C,T,H,W]`` for a named condition.

    ``sampling=uniform`` spans the complete source clip, which is the canonical
    proxy-video evaluation policy. ``sampling=fps`` samples at a requested FPS
    from the center of the available temporal window.
    """

    import numpy as np
    import torch

    try:
        from decord import VideoReader, cpu
    except ImportError as exc:
        raise ImportError("video condition loading requires decord") from exc

    path = _resolve_path(value, cfg)
    num_threads = int(cfg.get("num_threads", 1))
    reader = VideoReader(str(path), num_threads=num_threads, ctx=cpu(0))
    total_frames = len(reader)
    if total_frames < 1:
        raise ValueError(f"video condition {path} contains no frames")
    try:
        source_fps = float(reader.get_avg_fps())
    except Exception:
        source_fps = float(cfg.get("fps", 0.0))
    if not math.isfinite(source_fps) or source_fps <= 0:
        raise ValueError(f"video condition {path} has invalid FPS {source_fps!r}")

    expected_duration = cfg.get("duration_seconds")
    if expected_duration is not None:
        duration = total_frames / source_fps
        tolerance = float(cfg.get("duration_tolerance_seconds", 0.05))
        if abs(duration - float(expected_duration)) > tolerance:
            raise ValueError(
                f"video condition {path} has duration {duration:.3f}s, expected "
                f"{float(expected_duration):g}s (+/- {tolerance:g}s)"
            )

    num_frames = int(cfg.get("num_frames", total_frames))
    if num_frames < 1:
        raise ValueError(f"video condition num_frames must be positive, got {num_frames}")
    sampling = str(cfg.get("sampling", "fps"))
    if sampling == "uniform":
        if total_frames < num_frames and not bool(cfg.get("pad_short", False)):
            raise ValueError(
                f"video condition {path} has {total_frames} frames but {num_frames} were requested"
            )
        indices = np.rint(np.linspace(0, total_frames - 1, num_frames)).astype(np.int64)
    elif sampling == "fps":
        target_fps = float(cfg.get("fps", source_fps))
        if not math.isfinite(target_fps) or target_fps <= 0:
            raise ValueError(f"video condition target FPS must be positive, got {target_fps!r}")
        step = max(1.0, source_fps / target_fps)
        span = 1.0 + (num_frames - 1) * step
        if span > total_frames and not bool(cfg.get("pad_short", False)):
            raise ValueError(
                f"video condition {path} has {total_frames} frames at {source_fps:g} FPS, "
                f"insufficient for {num_frames} frames at {target_fps:g} FPS"
            )
        max_start = max(0, int(math.floor(total_frames - span)))
        clip_position = str(cfg.get("clip_position", "center"))
        if clip_position == "start":
            start = 0
        elif clip_position == "center":
            start = max_start // 2
        elif clip_position == "end":
            start = max_start
        else:
            raise ValueError(f"Unsupported video clip_position {clip_position!r}")
        indices = start + np.arange(num_frames, dtype=np.float64) * step
        indices = np.clip(np.rint(indices), 0, total_frames - 1).astype(np.int64)
    else:
        raise ValueError(f"Unsupported video sampling mode {sampling!r}; use 'uniform' or 'fps'")

    frames = torch.from_numpy(reader.get_batch(indices.tolist()).asnumpy()).permute(0, 3, 1, 2)
    height = cfg.get("height")
    width = cfg.get("width")
    if (height is None) != (width is None):
        raise ValueError("video condition resizing requires both height and width")
    if height is not None:
        frames = _resize_center_crop_frames(frames, int(height), int(width))
    else:
        frames = frames.float().contiguous()
    frames = frames.permute(1, 0, 2, 3).contiguous()
    if bool(cfg.get("normalize", True)):
        frames = frames / 255.0
        value_range = str(cfg.get("value_range", "-1,1"))
        if value_range == "-1,1":
            frames = frames * 2.0 - 1.0
        elif value_range != "0,1":
            raise ValueError(f"Unsupported video value_range {value_range!r}")
    return LoadedCondition(
        data=frames,
        metadata={
            "path": str(path),
            "frame_indices": indices.tolist(),
            "source_fps": source_fps,
            "source_num_frames": total_frames,
        },
    )


LOADERS: dict[str, ConditionLoader] = {
    "text": _text,
    "image": _image,
    "video": _video,
}


__all__ = ["LOADERS", "ConditionLoader", "LoadedCondition", "load_condition"]
