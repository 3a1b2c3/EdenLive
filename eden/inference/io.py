from __future__ import annotations

from pathlib import Path
from typing import Any

from eden.core.types import Batch, ModalityPayload
from eden.inference.request import GenerationOutput
from eden.utils import get_logger


logger = get_logger(__name__)


def save_generation_artifacts(
    *,
    batch: Batch,
    output: GenerationOutput,
    prompts: list[str],
    step: int | str,
    rank: int,
    output_dir: Path,
    config: dict[str, Any] | None = None,
    reference_output: GenerationOutput | None = None,
    ground_truth_video: ModalityPayload | None = None,
    batch_start_index: int = 0,
) -> None:
    cfg = config or {}
    step_dir = output_dir / (step if isinstance(step, str) else f"step_{step:06d}")
    fps = int(cfg.get("fps", 16))
    image_payload = batch.conditions.get("image") or batch.inputs.get("image")
    video_payload = batch.targets.get("video")
    condition_videos = _condition_video_artifacts(batch, cfg)

    for batch_idx in range(len(prompts)):
        global_batch_idx = batch_start_index + batch_idx
        prefix = f"rank_{rank:02d}_batch_{global_batch_idx:02d}"
        prompt_path = step_dir / f"{prefix}_prompt.txt"
        prompt_path.parent.mkdir(parents=True, exist_ok=True)
        prompt_path.write_text(str(prompts[batch_idx]), encoding="utf-8")

        image = _payload_item(image_payload, batch_idx)
        if image is not None:
            _save_image_array(image, step_dir / f"{prefix}_image.png")

        for suffix, (payload, condition_fps) in condition_videos.items():
            condition_video = _payload_item(payload, batch_idx)
            if condition_video is not None:
                _save_video_array(
                    condition_video,
                    step_dir / f"{prefix}_{suffix}.mp4",
                    fps=condition_fps,
                )

        video = _payload_item(output.outputs.items.get("video"), batch_idx)
        if video is not None:
            _save_video_array(video, step_dir / f"{prefix}.mp4", fps=fps)

        reference_video = (
            _payload_item(reference_output.outputs.items.get("video"), batch_idx)
            if reference_output is not None
            else None
        )
        if reference_video is not None:
            _save_video_array(reference_video, step_dir / f"{prefix}_teacher.mp4", fps=fps)

        gt_video = _payload_item(ground_truth_video or video_payload, batch_idx)
        if gt_video is not None:
            _save_video_array(gt_video, step_dir / f"{prefix}_gt.mp4", fps=fps)


def _condition_video_artifacts(
    batch: Batch,
    config: dict[str, Any],
) -> dict[str, tuple[ModalityPayload, int]]:
    """Resolve optional input condition videos to save beside generated media.

    ``save_condition_videos`` accepts either a mapping from condition names to
    filename suffixes, or a list of condition names (using the condition name
    itself as the suffix). Missing conditions are ignored so the option remains
    reusable across T2V, TI2V, and video-conditioned inference configs.
    ``condition_video_fps`` may override playback FPS by condition name; this
    is useful when a condition contains one RGB frame per latent timestep.
    """

    requested = config.get("save_condition_videos", {})
    if requested is True:
        requested = ["video_context"]
    if requested in (False, None):
        return {}
    if isinstance(requested, (list, tuple)):
        requested = {str(name): str(name) for name in requested}
    if not isinstance(requested, dict):
        raise TypeError("inference.save_condition_videos must be a mapping, list, or boolean")

    fps_overrides = config.get("condition_video_fps", {})
    if fps_overrides is None:
        fps_overrides = {}
    if not isinstance(fps_overrides, dict):
        raise TypeError("inference.condition_video_fps must be a mapping")
    default_fps = int(config.get("fps", 16))
    resolved = {}
    for condition_name, suffix in requested.items():
        condition_name = str(condition_name)
        payload = batch.conditions.get(condition_name) or batch.inputs.get(condition_name)
        if payload is not None and payload.data is not None:
            condition_fps = int(fps_overrides.get(condition_name, default_fps))
            if condition_fps <= 0:
                raise ValueError(f"condition video FPS for {condition_name!r} must be positive")
            resolved[str(suffix)] = (payload, condition_fps)
    return resolved


def _payload_item(payload: ModalityPayload | None, index: int) -> Any | None:
    if payload is None or payload.data is None:
        return None
    data = payload.data
    if isinstance(data, (list, tuple)):
        return data[index]
    try:
        return data[index]
    except Exception:
        return data


def _save_video_array(video: Any, path: Path, fps: int = 16) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    try:
        array = _to_numpy_video(video)
    except ValueError:
        return
    try:
        import imageio.v3 as iio

        iio.imwrite(path, array, fps=fps)
    except Exception:
        import numpy as np

        np.save(path.with_suffix(".npy"), array)


def _save_image_array(image: Any, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    import imageio.v3 as iio

    iio.imwrite(path, _to_numpy_image(image))


def _to_numpy_video(video: Any):
    import numpy as np
    import torch

    if torch.is_tensor(video):
        video = video.detach().float().cpu()
        if video.ndim == 4 and video.shape[0] in (1, 3):
            video = video.permute(1, 2, 3, 0)
        elif video.ndim == 4 and video.shape[-1] not in (1, 3):
            raise ValueError(f"Unsupported video tensor shape: {tuple(video.shape)}")
        video = video.numpy()
    else:
        video = np.asarray(video)

    if video.ndim != 4:
        raise ValueError(f"Validation video must have shape T,H,W,C or C,T,H,W, got {video.shape}")
    if video.shape[-1] not in (1, 3) and video.shape[0] in (1, 3):
        video = np.transpose(video, (1, 2, 3, 0))
    if video.dtype != np.uint8:
        low = float(np.nanmin(video))
        high = float(np.nanmax(video))
        if low < -0.05:
            video = (video + 1.0) * 0.5
        elif high > 1.5:
            video = video / 255.0
        video = (np.clip(video, 0.0, 1.0) * 255.0).round().astype("uint8")
    if video.shape[-1] == 1:
        video = np.repeat(video, 3, axis=-1)
    return video


def _to_numpy_image(image: Any):
    import numpy as np
    import torch

    if torch.is_tensor(image):
        image = image.detach().float().cpu()
        while image.ndim > 3:
            image = image[0]
        if image.ndim == 3 and image.shape[0] in (1, 3):
            image = image.permute(1, 2, 0)
        image = image.numpy()
    else:
        image = np.asarray(image)
        while image.ndim > 3:
            image = image[0]
        if image.ndim == 3 and image.shape[0] in (1, 3) and image.shape[-1] not in (1, 3):
            image = np.transpose(image, (1, 2, 0))

    if image.ndim != 2 and not (image.ndim == 3 and image.shape[-1] in (1, 3, 4)):
        raise ValueError(f"Validation image must have shape H,W,C or C,H,W, got {image.shape}")
    if image.dtype != np.uint8:
        low = float(np.nanmin(image))
        high = float(np.nanmax(image))
        if low < -0.05:
            image = (image + 1.0) * 0.5
        elif high > 1.5:
            image = image / 255.0
        image = (np.clip(image, 0.0, 1.0) * 255.0).round().astype("uint8")
    return image
