"""Inference-only FA4 variable-length attention; same kernel as the reference."""


def varlen_fwd(q, k, v, cu_q, cu_k, max_q, max_k):
    from flash_attn.cute import flash_attn_varlen_func

    return flash_attn_varlen_func(
        q,
        k,
        v,
        cu_seqlens_q=cu_q,
        cu_seqlens_k=cu_k,
        max_seqlen_q=max_q,
        max_seqlen_k=max_k,
        causal=False,
        return_lse=True,
    )
