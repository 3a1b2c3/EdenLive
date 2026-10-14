"""Frozen DINOv3 encoder used by Wan proxy-to-real conditioning.

The package is intentionally self-contained so Eden's model adapter can
load the encoder without depending on the reference training repository.
"""

from edenlive.models.proxy_dino.encoder import (
    DINOV3_IMAGE_MEAN,
    DINOV3_IMAGE_STD,
    DINOv3CheckpointEncoder,
    create_checkpoint_dinov3_encoder,
    encode_proxy_dino,
)

__all__ = [
    "DINOV3_IMAGE_MEAN",
    "DINOV3_IMAGE_STD",
    "DINOv3CheckpointEncoder",
    "create_checkpoint_dinov3_encoder",
    "encode_proxy_dino",
]
