from __future__ import annotations

import logging
import os
import sys
import threading

_LOCK = threading.RLock()
_CONFIGURED = False


class _RankFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.rank = int(os.environ.get("RANK", os.environ.get("LOCAL_RANK", "0")))
        return True


class _ColorFormatter(logging.Formatter):
    COLORS = {
        "DEBUG": "\033[36m",
        "INFO": "\033[32m",
        "WARNING": "\033[33m",
        "ERROR": "\033[31m",
        "CRITICAL": "\033[35m",
    }
    RESET = "\033[0m"

    def format(self, record: logging.LogRecord) -> str:
        original = record.levelname
        if sys.stderr.isatty() or sys.stdout.isatty():
            color = self.COLORS.get(record.levelname)
            if color:
                record.levelname = f"{color}{record.levelname:<7}{self.RESET}"
        else:
            record.levelname = f"{record.levelname:<7}"
        try:
            return super().format(record)
        finally:
            record.levelname = original


def setup_logging(*, level: int = logging.INFO) -> None:
    """Configure readable EdenLive logging on stdout."""

    global _CONFIGURED
    with _LOCK:
        if _CONFIGURED:
            return

        root = logging.getLogger("edenlive")
        root.setLevel(level)
        root.propagate = False
        root.handlers.clear()

        fmt = "%(asctime)s | %(levelname)s | r%(rank)02d | %(name)s:%(lineno)d | %(message)s"
        datefmt = "%m/%d %H:%M:%S"

        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(_ColorFormatter(fmt=fmt, datefmt=datefmt))
        console.addFilter(_RankFilter())
        root.addHandler(console)

        _CONFIGURED = True


def get_logger(name: str | None = None) -> logging.Logger:
    if name is None:
        name = "edenlive"
    if not _CONFIGURED:
        setup_logging()
    return logging.getLogger(name)


def info_rank0(self: logging.Logger, *args, **kwargs) -> None:
    if int(os.environ.get("RANK", os.environ.get("LOCAL_RANK", "0"))) == 0:
        kwargs["stacklevel"] = kwargs.get("stacklevel", 1) + 1
        self.info(*args, **kwargs)


logging.Logger.info_rank0 = info_rank0  # type: ignore[attr-defined]
