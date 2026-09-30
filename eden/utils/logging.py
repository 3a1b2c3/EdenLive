from __future__ import annotations

import logging
import os
import sys
import threading
from functools import lru_cache
from pathlib import Path
from typing import TextIO

_LOCK = threading.RLock()
_CONFIGURED = False
_TEE_INSTALLED = False
_LOG_FILE: Path | None = None


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


class _TeeStream:
    def __init__(self, stream: TextIO, file: TextIO) -> None:
        self.stream = stream
        self.file = file

    def write(self, data: str) -> int:
        self.stream.write(data)
        self.stream.flush()
        self.file.write(data)
        self.file.flush()
        return len(data)

    def flush(self) -> None:
        self.stream.flush()
        self.file.flush()

    def isatty(self) -> bool:
        return self.stream.isatty()


def setup_logging(log_file: str | Path | None = None, *, rank: int = 0, level: int = logging.INFO) -> None:
    """Configure readable eden logging and optional rank-0 stdout tee."""

    global _CONFIGURED, _TEE_INSTALLED, _LOG_FILE
    with _LOCK:
        if _CONFIGURED:
            if log_file is not None and _LOG_FILE is None:
                path = Path(log_file)
                path.parent.mkdir(parents=True, exist_ok=True)
                fmt = "%(asctime)s | %(levelname)s | r%(rank)02d | %(name)s:%(lineno)d | %(message)s"
                datefmt = "%m/%d %H:%M:%S"
                file_handler = logging.FileHandler(path, mode="a", encoding="utf-8")
                file_handler.setFormatter(logging.Formatter(fmt=fmt, datefmt=datefmt))
                file_handler.addFilter(_RankFilter())
                logging.getLogger("eden").addHandler(file_handler)
                _LOG_FILE = path
                if rank == 0 and not _TEE_INSTALLED:
                    tee_handle = path.open("a", encoding="utf-8", buffering=1)
                    sys.stdout = _TeeStream(sys.stdout, tee_handle)  # type: ignore[assignment]
                    sys.stderr = _TeeStream(sys.stderr, tee_handle)  # type: ignore[assignment]
                    _TEE_INSTALLED = True
            return

        root = logging.getLogger("eden")
        root.setLevel(level)
        root.propagate = False
        root.handlers.clear()

        fmt = "%(asctime)s | %(levelname)s | r%(rank)02d | %(name)s:%(lineno)d | %(message)s"
        datefmt = "%m/%d %H:%M:%S"

        console = logging.StreamHandler(sys.stdout)
        console.setFormatter(_ColorFormatter(fmt=fmt, datefmt=datefmt))
        console.addFilter(_RankFilter())
        root.addHandler(console)

        if log_file is not None:
            path = Path(log_file)
            path.parent.mkdir(parents=True, exist_ok=True)
            file_handler = logging.FileHandler(path, mode="a", encoding="utf-8")
            file_handler.setFormatter(logging.Formatter(fmt=fmt, datefmt=datefmt))
            file_handler.addFilter(_RankFilter())
            root.addHandler(file_handler)
            _LOG_FILE = path

            if rank == 0 and not _TEE_INSTALLED:
                tee_handle = path.open("a", encoding="utf-8", buffering=1)
                sys.stdout = _TeeStream(sys.stdout, tee_handle)  # type: ignore[assignment]
                sys.stderr = _TeeStream(sys.stderr, tee_handle)  # type: ignore[assignment]
                _TEE_INSTALLED = True

        _CONFIGURED = True


def get_logger(name: str | None = None) -> logging.Logger:
    if name is None:
        name = "eden"
    if not _CONFIGURED:
        setup_logging()
    return logging.getLogger(name)


def info_rank0(self: logging.Logger, *args, **kwargs) -> None:
    if int(os.environ.get("RANK", os.environ.get("LOCAL_RANK", "0"))) == 0:
        kwargs["stacklevel"] = kwargs.get("stacklevel", 1) + 1
        self.info(*args, **kwargs)


def warning_rank0(self: logging.Logger, *args, **kwargs) -> None:
    if int(os.environ.get("RANK", os.environ.get("LOCAL_RANK", "0"))) == 0:
        kwargs["stacklevel"] = kwargs.get("stacklevel", 1) + 1
        self.warning(*args, **kwargs)


def debug_rank0(self: logging.Logger, *args, **kwargs) -> None:
    if int(os.environ.get("RANK", os.environ.get("LOCAL_RANK", "0"))) == 0:
        kwargs["stacklevel"] = kwargs.get("stacklevel", 1) + 1
        self.debug(*args, **kwargs)


@lru_cache(maxsize=None)
def warning_once(self: logging.Logger, *args, **kwargs) -> None:
    self.warning_rank0(*args, **kwargs)


logging.Logger.info_rank0 = info_rank0  # type: ignore[attr-defined]
logging.Logger.warning_rank0 = warning_rank0  # type: ignore[attr-defined]
logging.Logger.debug_rank0 = debug_rank0  # type: ignore[attr-defined]
logging.Logger.warning_once = warning_once  # type: ignore[attr-defined]
