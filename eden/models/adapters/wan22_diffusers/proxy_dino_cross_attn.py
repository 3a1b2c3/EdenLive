"""Frame-aligned Proxy-DINO cross-attention layers for Wan2.2."""

from __future__ import annotations

from typing import Any

import torch
import torch.nn as nn

from eden.runtime.distributed.sequence_parallel import gather_sequence, split_sequence


def normalized_2d_patch_centers_rope(
    query_grid: tuple[int, int],
    key_grid: tuple[int, int],
    head_dim: int,
    device: torch.device,
    theta: float = 10000.0,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """Return 2D RoPE factors with control centers in the query coordinate space.

    The Y and X axes each own half the head dimensions.  A control patch at
    ``(i, j)`` is represented by its center after rescaling into the query
    grid: ``((i + .5) * Hq / Hk - .5, (j + .5) * Wq / Wk - .5)``.
    """

    query_height, query_width = map(int, query_grid)
    key_height, key_width = map(int, key_grid)
    if head_dim < 4 or int(head_dim) % 4:
        raise ValueError(f"2D RoPE requires head_dim divisible by 4, got {head_dim}")
    if min(query_height, query_width, key_height, key_width) < 1:
        raise ValueError(f"invalid query/key grids: {query_grid}, {key_grid}")
    if float(theta) <= 0:
        raise ValueError("2D RoPE theta must be positive")

    pairs_per_axis = int(head_dim) // 4
    inv_frequency = float(theta) ** (
        -torch.arange(pairs_per_axis, device=device, dtype=torch.float32) / pairs_per_axis
    )

    def coordinates(height: int, width: int, target_height: int, target_width: int):
        rows = (torch.arange(height, device=device, dtype=torch.float32) + 0.5) * target_height / height - 0.5
        columns = (torch.arange(width, device=device, dtype=torch.float32) + 0.5) * target_width / width - 0.5
        return rows.repeat_interleave(width), columns.repeat(height)

    def embeddings(rows: torch.Tensor, columns: torch.Tensor):
        angles = torch.cat((rows[:, None] * inv_frequency, columns[:, None] * inv_frequency), dim=-1)
        return angles.cos()[None, :, None], angles.sin()[None, :, None]

    query_rows, query_columns = coordinates(query_height, query_width, query_height, query_width)
    key_rows, key_columns = coordinates(key_height, key_width, query_height, query_width)
    query_cos, query_sin = embeddings(query_rows, query_columns)
    key_cos, key_sin = embeddings(key_rows, key_columns)
    return query_cos, query_sin, key_cos, key_sin


def normalized_3d_patch_centers_rope(
    query_positions: torch.Tensor,
    query_grid: tuple[int, int],
    key_frames: int,
    key_grid: tuple[int, int],
    rope_dims: tuple[int, int, int],
    device: torch.device,
    theta: float = 10000.0,
    key_start_position: int = 0,
) -> tuple[torch.Tensor, torch.Tensor, torch.Tensor, torch.Tensor]:
    """Return Wan-aligned T/H/W RoPE for video queries and DINO keys.

    Time is expressed in latent-frame indices. Spatial DINO patch centers are
    normalized into the query grid as in the existing 2D branch. ``rope_dims``
    is ordered T/H/W and is taken from Wan's own rotary module by the layer
    configurator, keeping the cross-attention split aligned with self-attention.
    """

    query_height, query_width = map(int, query_grid)
    key_height, key_width = map(int, key_grid)
    key_frames = int(key_frames)
    t_dim, h_dim, w_dim = map(int, rope_dims)
    if query_positions.ndim != 1 or query_positions.numel() < 1:
        raise ValueError("query_positions must be a non-empty 1D tensor")
    if min(query_height, query_width, key_frames, key_height, key_width) < 1:
        raise ValueError(
            f"invalid query/key grids or key timeline: {query_grid}, {key_frames}, {key_grid}"
        )
    if min(t_dim, h_dim, w_dim) < 2 or any(dim % 2 for dim in (t_dim, h_dim, w_dim)):
        raise ValueError(f"T/H/W RoPE dimensions must be positive and even, got {rope_dims}")
    if float(theta) <= 0:
        raise ValueError("3D RoPE theta must be positive")

    def axis_angles(coordinates: torch.Tensor, axis_dim: int) -> torch.Tensor:
        # Match WanRotaryPosEmbed/get_1d_rotary_pos_embed: exponent indices
        # advance over individual rotary dimensions, i.e. 0, 2, ... / dim.
        exponent = torch.arange(0, axis_dim, 2, device=device, dtype=torch.float32) / axis_dim
        inv_frequency = 1.0 / (float(theta) ** exponent)
        return coordinates[:, None] * inv_frequency

    query_times = query_positions.to(device=device, dtype=torch.float32)
    query_rows = torch.arange(query_height, device=device, dtype=torch.float32).repeat_interleave(query_width)
    query_columns = torch.arange(query_width, device=device, dtype=torch.float32).repeat(query_height)
    key_times = torch.arange(
        int(key_start_position), int(key_start_position) + key_frames, device=device, dtype=torch.float32
    )
    key_rows = (torch.arange(key_height, device=device, dtype=torch.float32) + 0.5) * query_height / key_height - 0.5
    key_columns = (torch.arange(key_width, device=device, dtype=torch.float32) + 0.5) * query_width / key_width - 0.5
    key_rows = key_rows.repeat_interleave(key_width)
    key_columns = key_columns.repeat(key_height)

    query_spatial_tokens = query_height * query_width
    key_spatial_tokens = key_height * key_width
    query_angles = torch.cat(
        (
            axis_angles(query_times, t_dim)[:, None, :].expand(-1, query_spatial_tokens, -1),
            axis_angles(query_rows, h_dim)[None, :, :].expand(query_times.numel(), -1, -1),
            axis_angles(query_columns, w_dim)[None, :, :].expand(query_times.numel(), -1, -1),
        ),
        dim=-1,
    ).reshape(-1, (t_dim + h_dim + w_dim) // 2)
    key_angles = torch.cat(
        (
            axis_angles(key_times, t_dim)[:, None, :].expand(-1, key_spatial_tokens, -1),
            axis_angles(key_rows, h_dim)[None, :, :].expand(key_frames, -1, -1),
            axis_angles(key_columns, w_dim)[None, :, :].expand(key_frames, -1, -1),
        ),
        dim=-1,
    ).reshape(-1, (t_dim + h_dim + w_dim) // 2)

    def embeddings(angles: torch.Tensor):
        return angles.cos()[None, :, None], angles.sin()[None, :, None]

    query_cos, query_sin = embeddings(query_angles)
    key_cos, key_sin = embeddings(key_angles)
    return query_cos, query_sin, key_cos, key_sin


def _apply_2d_rope(states: torch.Tensor, cos: torch.Tensor, sin: torch.Tensor) -> torch.Tensor:
    """Apply the reference fp32 rotary path and restore the input dtype."""

    with torch.autocast(device_type=states.device.type, enabled=False):
        pairs = states.float().unflatten(-1, (-1, 2))
        first, second = pairs.unbind(-1)
        rotated = torch.stack(
            (first * cos.float() - second * sin.float(), first * sin.float() + second * cos.float()),
            dim=-1,
        )
        return rotated.flatten(-2).type_as(states)


class FrameAlignedProxyDinoCrossAttention(nn.Module):
    """Cross-attend Wan video tokens to aligned or full-timeline DINO grids.

    The optional spatial RoPE is local to this control branch and leaves Wan's
    self-attention RoPE untouched. The temporal mode adds Wan-aligned T/H/W
    rotary subspaces and permits all-frame routing with a causal prefix
    restriction when requested by teacher forcing or chunk-AR.
    """

    def __init__(
        self,
        dim: int,
        heads: int,
        dim_head: int,
        cross_attention_dim: int,
        eps: float = 1.0e-6,
        spatial_rope: bool = True,
        temporal_rope: bool = False,
        rope_theta: float = 10000.0,
        rope_dims: tuple[int, int, int] | None = None,
        frame_routing: str = "aligned",
        causal_visibility: bool = True,
    ) -> None:
        super().__init__()
        inner_dim = int(heads) * int(dim_head)
        self.heads = int(heads)
        self.dim_head = int(dim_head)
        self.spatial_rope = bool(spatial_rope)
        self.temporal_rope = bool(temporal_rope)
        self.rope_theta = float(rope_theta)
        self.rope_dims = tuple(map(int, rope_dims)) if rope_dims is not None else None
        self.frame_routing = str(frame_routing)
        self.causal_visibility = bool(causal_visibility)
        if self.frame_routing not in {"aligned", "all"}:
            raise ValueError(
                "proxy-DINO cross-attention frame_routing must be 'aligned' or 'all', "
                f"got {self.frame_routing!r}"
            )
        if self.temporal_rope:
            if not self.spatial_rope or self.frame_routing != "all":
                raise ValueError("temporal Proxy-DINO RoPE requires spatial_rope=true and frame_routing='all'")
            if self.rope_dims is None or sum(self.rope_dims) != self.dim_head:
                raise ValueError(
                    f"T/H/W RoPE dimensions must sum to head_dim={self.dim_head}, got {self.rope_dims}"
                )
            normalized_3d_patch_centers_rope(
                torch.zeros(1, dtype=torch.long),
                (1, 1),
                1,
                (1, 1),
                self.rope_dims,
                torch.device("cpu"),
                self.rope_theta,
            )
        elif self.spatial_rope:
            normalized_2d_patch_centers_rope((1, 1), (1, 1), self.dim_head, torch.device("cpu"), self.rope_theta)
        self.to_q = nn.Linear(dim, inner_dim, bias=True)
        self.to_k = nn.Linear(cross_attention_dim, inner_dim, bias=True)
        self.to_v = nn.Linear(cross_attention_dim, inner_dim, bias=True)
        self.norm_q = nn.RMSNorm(inner_dim, eps=eps, elementwise_affine=True)
        self.norm_k = nn.RMSNorm(inner_dim, eps=eps, elementwise_affine=True)
        self.to_out = nn.ModuleList([nn.Linear(inner_dim, dim, bias=True), nn.Dropout(0.0)])

    def forward(
        self,
        hidden_states: torch.Tensor,
        proxy_dino_tokens: torch.Tensor,
        query_positions: torch.Tensor,
        query_grid_size: tuple[int, int] | None = None,
        key_grid_size: tuple[int, int] | None = None,
        causal: bool = False,
        key_start_frame: int = 0,
    ) -> torch.Tensor:
        """Return a residual update from frame-local or full-timeline DINO KV.

        ``hidden_states`` is flattened in Wan's time-major token order.  The
        feature tensor has one spatial grid per latent-time source frame:
        ``[B, T, K, C]``.  ``query_positions`` is repeated for teacher-forcing's
        clean/noisy streams, preserving the same source frame for both streams.
        """

        batch_size, seq_len, _ = hidden_states.shape
        if proxy_dino_tokens.ndim != 4:
            raise ValueError(
                "proxy_dino_tokens must have shape [B,T,K,C], "
                f"got {tuple(proxy_dino_tokens.shape)}"
            )
        if int(proxy_dino_tokens.shape[0]) != batch_size:
            raise ValueError(
                f"proxy-DINO batch {proxy_dino_tokens.shape[0]} does not match hidden batch {batch_size}"
            )
        if query_positions.ndim != 1 or query_positions.numel() < 1:
            raise ValueError("proxy-DINO query_positions must be a non-empty 1D tensor")
        query_frames = int(query_positions.numel())
        if seq_len % query_frames:
            raise ValueError(f"hidden seq_len {seq_len} is not divisible by query_frames {query_frames}")
        absolute_positions = query_positions.to(device=proxy_dino_tokens.device, dtype=torch.long)
        positions = absolute_positions - int(key_start_frame)
        if int(positions.min().item()) < 0 or int(positions.max().item()) >= int(proxy_dino_tokens.shape[1]):
            raise ValueError(
                "proxy-DINO query positions must be within the source feature timeline "
                f"[0, {int(proxy_dino_tokens.shape[1])}), got "
                f"[{int(positions.min().item())}, {int(positions.max().item())}]"
            )

        spatial_tokens = seq_len // query_frames
        query_states = hidden_states.reshape(batch_size, query_frames, spatial_tokens, -1)
        query_grid_size, key_grid_size = self._validate_spatial_grids(
            spatial_tokens, int(proxy_dino_tokens.shape[2]), query_grid_size, key_grid_size
        )
        if self.frame_routing == "aligned":
            query_states = query_states.reshape(batch_size * query_frames, spatial_tokens, -1)
            key_value_states = proxy_dino_tokens.index_select(1, positions)
            key_value_states = key_value_states.reshape(batch_size * query_frames, proxy_dino_tokens.shape[2], -1)
            return self._forward_aligned(
                query_states,
                key_value_states,
                query_grid_size=query_grid_size,
                key_grid_size=key_grid_size,
            ).reshape(batch_size, seq_len, -1)
        return self._forward_all_frames(
            query_states,
            proxy_dino_tokens,
            absolute_positions,
            query_grid_size=query_grid_size,
            key_grid_size=key_grid_size,
            causal=bool(causal and self.causal_visibility),
            key_start_frame=int(key_start_frame),
        ).reshape(batch_size, seq_len, -1)

    def _forward_aligned(
        self,
        query_states: torch.Tensor,
        key_value_states: torch.Tensor,
        *,
        query_grid_size: tuple[int, int],
        key_grid_size: tuple[int, int],
    ) -> torch.Tensor:
        query = self.norm_q(self.to_q(query_states)).unflatten(2, (self.heads, -1))
        key = self.norm_k(self.to_k(key_value_states)).unflatten(2, (self.heads, -1))
        value = self.to_v(key_value_states).unflatten(2, (self.heads, -1))
        if self.spatial_rope:
            query_cos, query_sin, key_cos, key_sin = normalized_2d_patch_centers_rope(
                query_grid_size,
                key_grid_size,
                self.dim_head,
                query.device,
                self.rope_theta,
            )
            query = _apply_2d_rope(query, query_cos, query_sin)
            key = _apply_2d_rope(key, key_cos, key_sin)
        from diffusers.models.attention_dispatch import dispatch_attention_fn

        output = dispatch_attention_fn(
            query,
            key,
            value,
            attn_mask=None,
            dropout_p=0.0,
            is_causal=False,
            backend=None,
            parallel_config=None,
        )
        output = output.flatten(2, 3).type_as(query_states)
        return self.to_out[1](self.to_out[0](output))

    def _forward_all_frames(
        self,
        query_states: torch.Tensor,
        key_value_states: torch.Tensor,
        query_positions: torch.Tensor,
        *,
        query_grid_size: tuple[int, int],
        key_grid_size: tuple[int, int],
        causal: bool,
        key_start_frame: int,
    ) -> torch.Tensor:
        batch_size, query_frames, spatial_tokens, _ = query_states.shape
        key_frames, key_spatial_tokens = int(key_value_states.shape[1]), int(key_value_states.shape[2])
        query = self.norm_q(self.to_q(query_states)).unflatten(3, (self.heads, -1))
        key = self.norm_k(self.to_k(key_value_states)).unflatten(3, (self.heads, -1))
        value = self.to_v(key_value_states).unflatten(3, (self.heads, -1))
        if self.temporal_rope:
            query_cos, query_sin, key_cos, key_sin = normalized_3d_patch_centers_rope(
                query_positions,
                query_grid_size,
                key_frames,
                key_grid_size,
                self.rope_dims,
                query.device,
                self.rope_theta,
                key_start_position=int(key_start_frame),
            )
            query = _apply_2d_rope(query.flatten(1, 2), query_cos, query_sin).unflatten(
                1, (query_frames, spatial_tokens)
            )
            key = _apply_2d_rope(key.flatten(1, 2), key_cos, key_sin).unflatten(
                1, (key_frames, key_spatial_tokens)
            )
        elif self.spatial_rope:
            query_cos, query_sin, key_cos, key_sin = normalized_2d_patch_centers_rope(
                query_grid_size,
                key_grid_size,
                self.dim_head,
                query.device,
                self.rope_theta,
            )
            query = _apply_2d_rope(query, query_cos, query_sin)
            key = _apply_2d_rope(key, key_cos, key_sin)

        from diffusers.models.attention_dispatch import dispatch_attention_fn

        # Use the same 4D contract as Wan self-attention:
        #   query=[B, Tq*S, heads, D], key/value=[B, Tk*K, heads, D].
        # In particular, do not pass a broadcasted 5D tensor to SDPA.  Some
        # CUDA versions then choose the math backend and materialize a
        # [B,Tq,heads,S,Tk*K] score tensor, which is the source of the large
        # activation spike seen at 720p.  A single flattened dispatch lets
        # Diffusers select flash/efficient attention for the full sequence.
        query = query.reshape(batch_size, query_frames * spatial_tokens, self.heads, self.dim_head)
        key = key.reshape(batch_size, key_frames * key_spatial_tokens, self.heads, self.dim_head)
        value = value.reshape(batch_size, key_frames * key_spatial_tokens, self.heads, self.dim_head)

        attention_mask = None
        backend = None
        if causal:
            # FlexAttention's BlockMask represents the frame-prefix rule
            # without materializing a dense [Tq*S, Tk*K] bool matrix.  The
            # block mask is indexed in flattened token coordinates but only
            # compares the corresponding temporal frame indices.
            try:
                from torch.nn.attention.flex_attention import create_block_mask
            except ImportError as exc:  # pragma: no cover - torch is required by Wan
                raise RuntimeError("causal HWT Proxy-DINO attention requires torch flex_attention") from exc

            spatial_query = int(spatial_tokens)
            spatial_key = int(key_spatial_tokens)
            positions = query_positions.to(device=query.device, dtype=torch.long)

            def frame_prefix_mask(_batch, _head, query_index, key_index):
                query_frame = torch.div(query_index, spatial_query, rounding_mode="floor")
                key_frame = torch.div(key_index, spatial_key, rounding_mode="floor")
                return key_frame + int(key_start_frame) <= positions[query_frame]

            attention_mask = create_block_mask(
                frame_prefix_mask,
                B=None,
                H=None,
                Q_LEN=query_frames * spatial_tokens,
                KV_LEN=key_frames * key_spatial_tokens,
                device=query.device,
            )
            backend = "flex"

        output = dispatch_attention_fn(
            query,
            key,
            value,
            attn_mask=attention_mask,
            dropout_p=0.0,
            is_causal=False,
            backend=backend,
            parallel_config=None,
        )
        output = output.reshape(batch_size, query_frames, spatial_tokens, self.heads, self.dim_head)
        output = output.flatten(3, 4).type_as(query_states)
        return self.to_out[1](self.to_out[0](output))

    @staticmethod
    def _validate_spatial_grids(
        spatial_tokens: int,
        key_tokens: int,
        query_grid_size: tuple[int, int] | None,
        key_grid_size: tuple[int, int] | None,
    ) -> tuple[tuple[int, int], tuple[int, int]]:
        if query_grid_size is None:
            query_grid_size = (1, int(spatial_tokens))
        if key_grid_size is None:
            key_grid_size = (1, int(key_tokens))
        query_h, query_w = (int(query_grid_size[0]), int(query_grid_size[1]))
        key_h, key_w = (int(key_grid_size[0]), int(key_grid_size[1]))
        if query_h < 1 or query_w < 1 or query_h * query_w != int(spatial_tokens):
            raise ValueError(
                "proxy-DINO query_grid_size must multiply to the per-frame query token count: "
                f"grid={query_grid_size}, tokens={spatial_tokens}"
            )
        if key_h < 1 or key_w < 1 or key_h * key_w != int(key_tokens):
            raise ValueError(
                "proxy-DINO key_grid_size must multiply to the control token count: "
                f"grid={key_grid_size}, tokens={key_tokens}"
            )
        return (query_h, query_w), (key_h, key_w)


def configure_wan_proxy_dino_cross_attention_layers(model, config: dict[str, Any]) -> None:
    """Attach frame-aligned Proxy-DINO cross-attention to configured Wan blocks."""

    if not bool(config.get("enabled", False)):
        model._eden_proxy_dino_cross_attn_enabled = False
        return
    if str(config.get("injection_type", "channel_concat")) != "frame_cross_attn":
        model._eden_proxy_dino_cross_attn_enabled = False
        return

    blocks = tuple(int(index) for index in config.get("blocks", range(len(model.blocks))))
    invalid = [index for index in blocks if index < 0 or index >= len(model.blocks)]
    if invalid:
        raise ValueError(f"proxy_dino.blocks contains invalid layer indices: {invalid}")
    control_dim = int(config.get("control_dim", 1024))
    if control_dim < 1:
        raise ValueError("proxy_dino.control_dim must be positive")
    default_heads = int(getattr(model.config, "num_attention_heads"))
    heads = int(config.get("cross_attention_heads", default_heads))
    if heads < 1:
        raise ValueError("proxy_dino.cross_attention_heads must be positive")
    zero_init = bool(config.get("cross_attn_to_out_zero_init", True))
    spatial_rope = bool(config.get("cross_attn_spatial_rope", True))
    rope_theta = float(config.get("cross_attn_rope_theta", 10000.0))
    temporal_rope = bool(config.get("cross_attn_temporal_rope", False))
    frame_routing = str(config.get("cross_attn_frame_routing", "aligned"))
    causal_visibility = bool(config.get("cross_attn_causal_visibility", True))
    rope_dims = None
    if temporal_rope:
        rope = getattr(model, "rope", None)
        if rope is None or any(not hasattr(rope, name) for name in ("t_dim", "h_dim", "w_dim")):
            raise ValueError("Wan-aligned Proxy-DINO temporal RoPE requires model.rope T/H/W dimensions")
        rope_dims = (int(rope.t_dim), int(rope.h_dim), int(rope.w_dim))

    from diffusers.models.normalization import FP32LayerNorm

    for index in blocks:
        block = model.blocks[index]
        hidden_dim = int(block.scale_shift_table.shape[-1])
        dim_head = int(config.get("cross_attention_head_dim", hidden_dim // heads))
        if dim_head < 1 or heads * dim_head != hidden_dim:
            raise ValueError(
                "proxy-DINO cross_attention_heads * cross_attention_head_dim must equal "
                f"Wan hidden dim {hidden_dim} (got {heads} * {dim_head})"
            )
        device = block.scale_shift_table.device
        with torch.device(device):
            block.attn_proxy_dino = FrameAlignedProxyDinoCrossAttention(
                dim=hidden_dim,
                heads=heads,
                dim_head=dim_head,
                cross_attention_dim=control_dim,
                spatial_rope=spatial_rope,
                temporal_rope=temporal_rope,
                rope_theta=rope_theta,
                rope_dims=rope_dims,
                frame_routing=frame_routing,
                causal_visibility=causal_visibility,
            )
            block.norm_proxy_dino = FP32LayerNorm(hidden_dim, 1.0e-6, elementwise_affine=True)
        if zero_init:
            nn.init.zeros_(block.attn_proxy_dino.to_out[0].weight)
            if block.attn_proxy_dino.to_out[0].bias is not None:
                nn.init.zeros_(block.attn_proxy_dino.to_out[0].bias)
        block._eden_proxy_dino_cross_attn_enabled = True
        block._eden_proxy_dino_cross_attn_time_axis = "latent"

    model._eden_proxy_dino_cross_attn_enabled = True
    model._eden_proxy_dino_cross_attn_blocks = blocks
    model._eden_proxy_dino_cross_attn_to_out_zero_init = zero_init
    model._eden_proxy_dino_cross_attn_frame_routing = frame_routing
    model._eden_proxy_dino_cross_attn_rope_dims = rope_dims


def apply_wan_proxy_dino_condition(
    block,
    hidden_states: torch.Tensor,
    proxy_dino_embeds: torch.Tensor | None,
    *,
    num_frames: int,
    start_frame: int = 0,
    repeat_streams: int = 1,
    query_grid_size: tuple[int, int] | None = None,
    causal: bool = False,
    key_start_frame: int = 0,
    runtime_context=None,
) -> torch.Tensor:
    """Inject source-video DINO grids while preserving sequence-parallel layout."""

    if proxy_dino_embeds is None or getattr(block, "attn_proxy_dino", None) is None:
        return hidden_states
    if proxy_dino_embeds.ndim != 5:
        raise ValueError(
            "proxy-DINO cross-attention features must have shape [B,C,T,H,W], "
            f"got {tuple(proxy_dino_embeds.shape)}"
        )
    if int(proxy_dino_embeds.shape[0]) != int(hidden_states.shape[0]):
        raise ValueError(
            f"proxy-DINO batch {proxy_dino_embeds.shape[0]} does not match hidden batch {hidden_states.shape[0]}"
        )

    local_length = int(hidden_states.shape[1])
    full_hidden = gather_sequence(hidden_states, runtime_context, dim=1)
    query_positions = torch.arange(
        int(start_frame),
        int(start_frame) + int(num_frames),
        device=full_hidden.device,
    ).repeat(int(repeat_streams))
    proxy_dino_tokens = proxy_dino_embeds.to(device=full_hidden.device, dtype=full_hidden.dtype)
    proxy_dino_tokens = proxy_dino_tokens.permute(0, 2, 3, 4, 1).flatten(2, 3).contiguous()
    norm_hidden = block.norm_proxy_dino(full_hidden.float()).type_as(full_hidden)
    full_hidden = full_hidden + block.attn_proxy_dino(
        norm_hidden,
        proxy_dino_tokens,
        query_positions,
        query_grid_size=query_grid_size,
        key_grid_size=(int(proxy_dino_embeds.shape[-2]), int(proxy_dino_embeds.shape[-1])),
        causal=causal,
        key_start_frame=int(key_start_frame),
    )
    local_hidden, _ = split_sequence(full_hidden, runtime_context, dim=1)
    if int(local_hidden.shape[1]) != local_length:
        raise RuntimeError("Proxy-DINO cross-attention changed the local sequence length")
    return local_hidden


__all__ = [
    "FrameAlignedProxyDinoCrossAttention",
    "apply_wan_proxy_dino_condition",
    "configure_wan_proxy_dino_cross_attention_layers",
    "normalized_2d_patch_centers_rope",
    "normalized_3d_patch_centers_rope",
]
