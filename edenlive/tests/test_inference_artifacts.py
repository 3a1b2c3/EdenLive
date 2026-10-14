"""Regression checks for offline output names, writers, and encoding failures."""

import numpy as np
import pytest

from edenlive.core.types import Batch, RuntimeContext
from edenlive.inference.io import _save_video_array
from edenlive.inference.offline import _artifact_names, _is_artifact_writer
from edenlive.runtime.distributed.sequence_parallel import SequenceParallelState


def test_artifact_names_use_manifest_ids_and_safe_fallbacks():
    batch = Batch(metadata={"items": [{"id": "boxed-in"}, {"id": "../clip / two"}, {}]})

    assert _artifact_names(batch, 3, rank=2, batch_idx=4) == [
        "boxed-in", "clip_two", "rank_02_batch_0004_02",
    ]


@pytest.mark.parametrize("sp_rank, expected", [(0, True), (1, False)])
def test_only_first_sequence_parallel_rank_writes_artifacts(sp_rank, expected):
    context = RuntimeContext(extras={
        "sequence_parallel_state": SequenceParallelState(enabled=True, size=2, sp_rank=sp_rank),
    })

    assert _is_artifact_writer(context) is expected


def test_non_sequence_parallel_rank_writes_artifacts():
    assert _is_artifact_writer(RuntimeContext())


def test_video_encoder_failure_is_reported(tmp_path, monkeypatch):
    import imageio.v3 as iio

    def fail(*args, **kwargs):
        raise OSError("encoder unavailable")

    monkeypatch.setattr(iio, "imwrite", fail)
    path = tmp_path / "clip.mp4"

    with pytest.raises(OSError, match="encoder unavailable"):
        _save_video_array(np.zeros((2, 16, 16, 3), dtype=np.uint8), path)

    assert not path.with_suffix(".npy").exists()


def test_invalid_video_shape_is_reported(tmp_path):
    with pytest.raises(ValueError, match="shape"):
        _save_video_array(np.zeros((16, 16, 3), dtype=np.uint8), tmp_path / "clip.mp4")
