"""Cheap screenshot-channel preflight used before visual analysis."""
import time


def preflight(page, *, retries=2, path=None):
    """Capture a known page and verify that Chromium returned a real PNG.

    This proves the capture channel, not that a reviewer saw or understood the
    image.  After the bounded retries the caller must preserve not_evaluated.
    """
    if type(retries) is not int or not 0 <= retries <= 2:
        raise ValueError("retries must be between 0 and 2 (at most three attempts)")
    last = None
    for attempt in range(retries + 1):
        try:
            data = page.screenshot(path=str(path) if path else None, timeout=5000)
            if not isinstance(data, bytes) or len(data) < 32 or not data.startswith(b"\x89PNG\r\n\x1a\n"):
                raise ValueError("screenshot did not return a PNG")
            return {"status": "channel_ready", "attempts": attempt + 1, "bytes": len(data), "review": "not_evaluated"}
        except Exception as exc:  # screenshot backends can fail transiently
            last = str(exc)
            if attempt < retries:
                time.sleep(0.03 * (attempt + 1))
    return {"status": "not_evaluated", "attempts": retries + 1, "reason": last or "screenshot channel unavailable", "review": "not_evaluated"}
