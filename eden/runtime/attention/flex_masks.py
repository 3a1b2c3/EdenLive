from __future__ import annotations

from functools import lru_cache
import math


@lru_cache(maxsize=64)
def build_teacher_forcing_block_mask(
    num_frames: int,
    frame_seq_length: int,
    chunk_size: int,
    *,
    max_context_frames: int | None = None,
    sink_frames: int = 0,
    independent_first_frame: bool = False,
    pack_first_frame: bool = False,
    device: str,
    block_size: int = 128,
    arithmetic: bool = False,
):
    """Build the clean/noisy chunk mask used by AR teacher forcing.

    Token layout is ``[clean_video_tokens, noisy_video_tokens]``. Clean tokens
    attend causally by chunk within the clean half. Noisy tokens attend to
    previous clean chunks plus noisy tokens in the same chunk.

    With ``independent_first_frame`` the first frame is its own 1-frame chunk
    unless ``pack_first_frame`` is enabled. Packed mode retains TI2V clean-frame
    semantics outside the mask while using uniform ``chunk_size`` attention
    blocks starting at frame 0.
    """

    clean_length = int(num_frames) * int(frame_seq_length)
    total_length = clean_length * 2
    return _build_teacher_forcing_sparse_block_mask(
        num_frames=num_frames,
        frame_seq_length=frame_seq_length,
        chunk_size=chunk_size,
        query_start=0,
        query_length=total_length,
        arithmetic=arithmetic,
        max_context_frames=max_context_frames,
        sink_frames=sink_frames,
        independent_first_frame=independent_first_frame,
        pack_first_frame=pack_first_frame,
        device=device,
        block_size=block_size,
    )


@lru_cache(maxsize=128)
def build_teacher_forcing_local_query_block_mask(
    num_frames: int,
    frame_seq_length: int,
    chunk_size: int,
    query_start: int,
    query_length: int,
    *,
    max_context_frames: int | None = None,
    sink_frames: int = 0,
    independent_first_frame: bool = False,
    pack_first_frame: bool = False,
    device: str,
    block_size: int = 128,
):
    """Build teacher-forcing BlockMask for a local SP query shard.

    FlexAttention sees local q indices in ``[0, query_length)``. The mask
    translates them back to global indices before applying clean/noisy chunk
    visibility rules against the full key/value sequence.
    """

    return _build_teacher_forcing_sparse_block_mask(
        num_frames=num_frames,
        frame_seq_length=frame_seq_length,
        chunk_size=chunk_size,
        query_start=query_start,
        query_length=query_length,
        max_context_frames=max_context_frames,
        sink_frames=sink_frames,
        independent_first_frame=independent_first_frame,
        pack_first_frame=pack_first_frame,
        device=device,
        block_size=block_size,
    )


def _build_teacher_forcing_sparse_block_mask(
    *,
    num_frames: int,
    frame_seq_length: int,
    chunk_size: int,
    query_start: int,
    query_length: int,
    max_context_frames: int | None,
    sink_frames: int,
    independent_first_frame: bool,
    pack_first_frame: bool,
    device: str,
    block_size: int,
    arithmetic: bool = False,
):
    """Construct a FlexAttention BlockMask without a token-dense GPU mask.

    ``torch.nn.attention.flex_attention.create_block_mask`` first evaluates a
    dense ``[Q_LEN, KV_LEN]`` boolean tensor. At 720p teacher forcing, even an
    SP=8 local-query mask is 5.54 GiB. The visibility pattern here is a union of
    contiguous token intervals per temporal chunk, so its sparse block rows can
    be derived directly on CPU and only the compact BlockMask metadata is moved
    to the execution device.

    Boundary tiles remain partial and use ``mask_mod`` for exact token-level
    semantics. Interior tiles that are visible for every query in a block are
    marked full, preserving FlexAttention's full-block optimization.
    """

    try:
        import torch
        from torch.nn.attention.flex_attention import BlockMask
    except ImportError as exc:
        raise RuntimeError("torch flex_attention is required for teacher-forcing masks") from exc

    num_frames = int(num_frames)
    frame_seq_length = int(frame_seq_length)
    query_start = int(query_start)
    query_length = int(query_length)
    block_size = int(block_size)
    if num_frames < 1 or frame_seq_length < 1 or query_length < 1 or block_size < 1:
        raise ValueError("teacher-forcing mask dimensions and block_size must be positive")

    clean_length = num_frames * frame_seq_length
    total_length = clean_length * 2
    if query_start < 0 or query_start + query_length > total_length:
        raise ValueError(
            "teacher-forcing local query range must lie within the clean/noisy sequence: "
            f"start={query_start}, length={query_length}, total={total_length}"
        )
    max_context_tokens = _frames_to_tokens(max_context_frames, frame_seq_length)
    sink_tokens = _frames_to_tokens(sink_frames, frame_seq_length) or 0
    _validate_context_tokens(max_context_tokens, sink_tokens)

    spans = _chunk_spans(
        num_frames,
        chunk_size,
        frame_seq_length,
        independent_first_frame,
        pack_first_frame,
    )
    atomic_regions: list[tuple[int, int, tuple[tuple[int, int], ...]]] = []
    for start, end in spans:
        clean_intervals = _merge_intervals(
            (
                (0, min(sink_tokens, end)),
                (_recent_context_start(end, max_context_tokens, sink_tokens, 0), end),
            )
        )
        atomic_regions.append((start, end, clean_intervals))

        noisy_start = clean_length + start
        noisy_end = clean_length + end
        noisy_intervals = _merge_intervals(
            (
                (0, min(sink_tokens, start)),
                (
                    _recent_context_start(
                        start,
                        max_context_tokens,
                        sink_tokens,
                        end - start,
                    ),
                    start,
                ),
                (noisy_start, noisy_end),
            )
        )
        atomic_regions.append((noisy_start, noisy_end, noisy_intervals))
    atomic_regions.sort(key=lambda item: item[0])

    num_q_blocks = math.ceil(query_length / block_size)
    num_kv_blocks = math.ceil(total_length / block_size)
    partial_rows: list[list[int]] = []
    full_rows: list[list[int]] = []
    for q_block in range(num_q_blocks):
        local_q_start = q_block * block_size
        local_q_end = min(local_q_start + block_size, query_length)
        global_q_start = query_start + local_q_start
        global_q_end = query_start + local_q_end

        any_blocks: set[int] = set()
        full_blocks: set[int] | None = None
        for region_start, region_end, intervals in atomic_regions:
            overlap_start = max(global_q_start, region_start)
            overlap_end = min(global_q_end, region_end)
            if overlap_start >= overlap_end:
                continue
            region_any = _interval_block_ids(intervals, block_size, require_full=False)
            region_full = _interval_block_ids(intervals, block_size, require_full=True)
            any_blocks.update(region_any)
            full_blocks = region_full if full_blocks is None else full_blocks & region_full

        # ``valid_eye`` is normally covered by the chunk intervals, but remains
        # part of the public mask semantics when a clean-context window is
        # shorter than its current chunk. Include its tiles as partial blocks.
        any_blocks.update(range(global_q_start // block_size, math.ceil(global_q_end / block_size)))

        # create_block_mask pads the final Q/KV tiles with false. Such a tile is
        # never a completely full rectangle, even if all of its real tokens are
        # visible, so retain it as partial for identical behavior.
        if local_q_end - local_q_start != block_size:
            full_blocks = set()
        else:
            full_blocks = full_blocks or set()
            full_blocks = {
                block
                for block in full_blocks
                if (block + 1) * block_size <= total_length
            }
        any_blocks = {block for block in any_blocks if 0 <= block < num_kv_blocks}
        full_blocks &= any_blocks
        partial_rows.append(sorted(any_blocks - full_blocks))
        full_rows.append(sorted(full_blocks))

    partial_counts, partial_indices = _ordered_block_rows(
        partial_rows,
        num_kv_blocks=num_kv_blocks,
        torch_module=torch,
    )
    full_counts, full_indices = _ordered_block_rows(
        full_rows,
        num_kv_blocks=num_kv_blocks,
        torch_module=torch,
    )

    mask_mod = _teacher_forcing_mask_mod(
        num_frames=num_frames,
        frame_seq_length=frame_seq_length,
        chunk_size=chunk_size,
        query_start=query_start,
        max_context_tokens=max_context_tokens,
        sink_tokens=sink_tokens,
        independent_first_frame=independent_first_frame,
        pack_first_frame=pack_first_frame,
        device=device,
        block_size=block_size,
        query_length=query_length,
        arithmetic=arithmetic,
    )
    block_mask = BlockMask.from_kv_blocks(
        partial_counts,
        partial_indices,
        full_counts,
        full_indices,
        BLOCK_SIZE=block_size,
        mask_mod=mask_mod,
        seq_lengths=(query_length, total_length),
    )
    return block_mask.to(device)


def _ordered_block_rows(rows: list[list[int]], *, num_kv_blocks: int, torch_module):
    """Return public BlockMask ordered-row tensors on CPU.

    The final dimension intentionally spans every KV block. PyTorch uses that
    dimension to infer the transposed Q metadata needed by backward; entries
    beyond each row's count are ignored.
    """

    torch = torch_module
    counts = torch.tensor([len(row) for row in rows], dtype=torch.int32).view(1, 1, -1)
    indices = torch.zeros((1, 1, len(rows), num_kv_blocks), dtype=torch.int32)
    for row_index, row in enumerate(rows):
        if row:
            indices[0, 0, row_index, : len(row)] = torch.tensor(row, dtype=torch.int32)
    return counts, indices


def _teacher_forcing_mask_mod(
    *,
    num_frames: int,
    frame_seq_length: int,
    chunk_size: int,
    query_start: int,
    max_context_tokens: int | None,
    sink_tokens: int,
    independent_first_frame: bool,
    pack_first_frame: bool,
    device: str,
    block_size: int,
    query_length: int,
    arithmetic: bool = False,
):
    import torch

    if arithmetic:
        # The FA4/CuTe path cannot index the per-token lookup tables used by
        # the generic mask below.  Keep the predicate purely arithmetic, but
        # derive the same sink + recent-window intervals from the query's
        # chunk position.  ``pack_first_frame`` gives us a uniform partition;
        # the final chunk is handled by the clamped ``chunk_end`` expression.
        if independent_first_frame and not pack_first_frame:
            raise ValueError(
                "Arithmetic teacher-forcing mask requires pack_first_frame=true"
            )
        return _arithmetic_teacher_forcing_mask_mod(
            num_frames * frame_seq_length,
            chunk_size * frame_seq_length,
            query_start=query_start,
            query_length=query_length,
            max_context_tokens=max_context_tokens,
            sink_tokens=sink_tokens,
        )

    clean_length = int(num_frames) * int(frame_seq_length)
    total_length = clean_length * 2
    padded_length = max(
        math.ceil(total_length / block_size) * block_size,
        int(query_start) + math.ceil(int(query_length) / block_size) * block_size,
    )
    context_ends = torch.zeros(padded_length, device=device, dtype=torch.long)
    clean_context_starts = torch.zeros(padded_length, device=device, dtype=torch.long)
    noise_context_starts = torch.zeros(padded_length, device=device, dtype=torch.long)
    noise_context_ends = torch.zeros(padded_length, device=device, dtype=torch.long)
    noise_noise_starts = torch.zeros(padded_length, device=device, dtype=torch.long)
    noise_noise_ends = torch.zeros(padded_length, device=device, dtype=torch.long)

    for start, end in _chunk_spans(
        num_frames,
        chunk_size,
        frame_seq_length,
        independent_first_frame,
        pack_first_frame,
    ):
        context_ends[start:end] = end
        clean_context_starts[start:end] = _recent_context_start(end, max_context_tokens, sink_tokens, 0)
        noisy_start, noisy_end = clean_length + start, clean_length + end
        noise_noise_starts[noisy_start:noisy_end] = noisy_start
        noise_noise_ends[noisy_start:noisy_end] = noisy_end
        noise_context_ends[noisy_start:noisy_end] = start
        noise_context_starts[noisy_start:noisy_end] = _recent_context_start(
            start,
            max_context_tokens,
            sink_tokens,
            end - start,
        )

    query_start_t = torch.tensor(int(query_start), device=device, dtype=torch.long)

    def teacher_forcing_mask(_b, _h, q_idx, kv_idx):
        q_global = q_idx + query_start_t
        clean_sink = (sink_tokens > 0) & (kv_idx < sink_tokens) & (kv_idx < context_ends[q_global])
        clean_recent = (kv_idx >= clean_context_starts[q_global]) & (kv_idx < context_ends[q_global])
        clean_mask = (q_global < clean_length) & (clean_sink | clean_recent)
        same_noisy_chunk = (kv_idx >= noise_noise_starts[q_global]) & (kv_idx < noise_noise_ends[q_global])
        noise_sink = (sink_tokens > 0) & (kv_idx < sink_tokens) & (kv_idx < noise_context_ends[q_global])
        noise_recent = (kv_idx >= noise_context_starts[q_global]) & (kv_idx < noise_context_ends[q_global])
        noise_mask = (
            (q_global >= clean_length)
            & (q_global < total_length)
            & (same_noisy_chunk | noise_sink | noise_recent)
        )
        valid_eye = (q_global == kv_idx) & (q_global < total_length)
        return valid_eye | clean_mask | noise_mask

    return teacher_forcing_mask


def _uniform_teacher_forcing_mask_mod(clean_length, chunk_tokens, *, query_start, query_length):
    """CuTe-compatible scalar arithmetic; explicit bounds handle partial tiles/chunks."""
    if clean_length <= 0 or chunk_tokens <= 0:
        raise ValueError("Teacher-forcing sequence and chunk lengths must be positive")
    total_length = 2 * clean_length

    def mask(_b, _h, q_idx, kv_idx):
        q = q_idx + query_start
        start = ((q % clean_length) // chunk_tokens) * chunk_tokens
        end = start + chunk_tokens
        valid = (q_idx < query_length) & (q < total_length) & (kv_idx < total_length)
        clean = (q < clean_length) & (kv_idx < clean_length) & (kv_idx < end)
        noisy = (q >= clean_length) & (
            (kv_idx < start)
            | ((kv_idx >= clean_length + start) & (kv_idx < clean_length + end))
        )
        return valid & (clean | noisy)

    return mask


def _arithmetic_teacher_forcing_mask_mod(
    clean_length,
    chunk_tokens,
    *,
    query_start,
    query_length,
    max_context_tokens: int | None,
    sink_tokens: int,
):
    """CuTe-compatible arithmetic predicate for finite context + sink masks.

    The indexed implementation stores one start/end pair per query token.
    In packed mode those values are a function of ``q % clean_length`` only,
    so they can be reconstructed with integer arithmetic.  ``torch.where`` is
    deliberately used instead of Python branching: FlexAttention invokes the
    predicate with tensor scalar indices while tracing the FA4 kernel.
    """

    if clean_length <= 0 or chunk_tokens <= 0:
        raise ValueError("Teacher-forcing sequence and chunk lengths must be positive")
    unlimited_context = max_context_tokens is None
    if unlimited_context and sink_tokens == 0:
        # Preserve the small, well-tested unlimited-context expression.
        return _uniform_teacher_forcing_mask_mod(
            clean_length, chunk_tokens,
            query_start=query_start,
            query_length=query_length,
        )
    if not unlimited_context and (int(sink_tokens) < 0 or int(sink_tokens) >= int(max_context_tokens)):
        raise ValueError("sink_tokens must be smaller than max_context_tokens")

    import torch

    total_length = 2 * int(clean_length)
    max_context_tokens = None if unlimited_context else int(max_context_tokens)
    sink_tokens = int(sink_tokens)

    def _nonnegative(value):
        return torch.where(value > 0, value, torch.zeros_like(value))

    def _at_least(value, lower):
        lower_t = torch.as_tensor(lower, device=value.device, dtype=value.dtype)
        return torch.where(value > lower_t, value, lower_t)

    def mask(_b, _h, q_idx, kv_idx):
        q = q_idx + int(query_start)
        # The modulo is also well-defined for padded rows.  ``valid`` below
        # masks those rows out before they can affect attention.
        position = q.remainder(int(clean_length))
        chunk_start = (position // int(chunk_tokens)) * int(chunk_tokens)
        raw_end = chunk_start + int(chunk_tokens)
        # Clamp the final partial chunk without data-dependent Python control
        # flow (required by the FA4/CuTe compiler).
        overrun = torch.where(
            raw_end > int(clean_length),
            raw_end - int(clean_length),
            torch.zeros_like(raw_end),
        )
        chunk_end = raw_end - overrun
        chunk_len = chunk_end - chunk_start

        # Clean queries include the current chunk in their recent interval;
        # noisy queries additionally reserve room for their own noisy chunk.
        if unlimited_context:
            clean_recent_start = torch.zeros_like(chunk_end)
            noisy_recent_start = torch.zeros_like(chunk_start)
        else:
            clean_recent_budget = max(0, int(max_context_tokens) - int(sink_tokens))
            noisy_recent_budget = _nonnegative(
                int(max_context_tokens) - int(sink_tokens) - chunk_len
            )
            clean_recent_start = _at_least(chunk_end - clean_recent_budget, int(sink_tokens))
            noisy_recent_start = _at_least(chunk_start - noisy_recent_budget, int(sink_tokens))

        clean_sink = (kv_idx < int(sink_tokens)) & (kv_idx < chunk_end)
        clean_recent = (kv_idx >= clean_recent_start) & (kv_idx < chunk_end)
        clean_mask = (q < int(clean_length)) & (kv_idx < int(clean_length)) & (
            clean_sink | clean_recent
        )

        noisy_own = (kv_idx >= int(clean_length) + chunk_start) & (
            kv_idx < int(clean_length) + chunk_end
        )
        noisy_sink = (kv_idx < int(sink_tokens)) & (kv_idx < chunk_start)
        noisy_recent = (kv_idx >= noisy_recent_start) & (kv_idx < chunk_start)
        noisy_mask = (q >= int(clean_length)) & (q < int(total_length)) & (
            noisy_own | noisy_sink | noisy_recent
        )
        valid = (q_idx < int(query_length)) & (q < int(total_length)) & (
            kv_idx < int(total_length)
        )
        valid_eye = (q == kv_idx) & (q < int(total_length))
        return valid & (valid_eye | clean_mask | noisy_mask)

    return mask


def _merge_intervals(intervals: tuple[tuple[int, int], ...]) -> tuple[tuple[int, int], ...]:
    merged: list[list[int]] = []
    for start, end in sorted((int(start), int(end)) for start, end in intervals if int(start) < int(end)):
        if merged and start <= merged[-1][1]:
            merged[-1][1] = max(merged[-1][1], end)
        else:
            merged.append([start, end])
    return tuple((start, end) for start, end in merged)


def _interval_block_ids(
    intervals: tuple[tuple[int, int], ...],
    block_size: int,
    *,
    require_full: bool,
) -> set[int]:
    blocks: set[int] = set()
    for start, end in intervals:
        if require_full:
            first = math.ceil(start / block_size)
            stop = end // block_size
        else:
            first = start // block_size
            stop = math.ceil(end / block_size)
        blocks.update(range(first, stop))
    return blocks


def _chunk_spans(
    num_frames: int,
    chunk_size: int,
    frame_seq_length: int,
    independent_first_frame: bool,
    pack_first_frame: bool = False,
) -> list[tuple[int, int]]:
    """Token-unit ``(start, end)`` spans for each attention chunk in the clean half.

    With ``independent_first_frame`` the first frame is a standalone 1-frame
    chunk followed by ``chunk_size`` blocks. When ``pack_first_frame`` is true,
    the partition is uniform from frame 0 even though algorithms still keep the
    first TI2V frame clean and exclude it from the loss.
    """

    num_frames = int(num_frames)
    chunk_size = max(1, int(chunk_size))
    frame_seq_length = int(frame_seq_length)
    spans: list[tuple[int, int]] = []
    frame = 0
    if independent_first_frame and not pack_first_frame and num_frames > 0:
        spans.append((0, frame_seq_length))
        frame = 1
    while frame < num_frames:
        end_frame = min(frame + chunk_size, num_frames)
        spans.append((frame * frame_seq_length, end_frame * frame_seq_length))
        frame = end_frame
    return spans


def _frames_to_tokens(frames: int | None, frame_seq_length: int) -> int | None:
    if frames is None or int(frames) <= 0:
        return None
    return int(frames) * int(frame_seq_length)


def _validate_context_tokens(max_context_tokens: int | None, sink_tokens: int) -> None:
    if int(sink_tokens) < 0:
        raise ValueError("sink_frames must be non-negative")
    if max_context_tokens is not None and int(sink_tokens) >= int(max_context_tokens):
        raise ValueError("sink_frames must be smaller than max_context_frames")


def _recent_context_start(
    context_end: int,
    max_context_tokens: int | None,
    sink_tokens: int,
    current_chunk_tokens: int,
) -> int:
    if max_context_tokens is None:
        return 0
    clean_recent_budget = max(
        0,
        int(max_context_tokens) - int(sink_tokens) - int(current_chunk_tokens),
    )
    return max(int(sink_tokens), int(context_end) - clean_recent_budget)
