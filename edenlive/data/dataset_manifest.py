from __future__ import annotations

import csv
import json
from pathlib import Path
from typing import Any

from torch.utils.data import Dataset

from edenlive.data.loaders import LoadedCondition, load_condition


class ManifestDataset(Dataset):
    """Manifest-backed inference dataset.

    Each configured column (``columns``) becomes a condition, read with the
    loader the column names.
    """

    def __init__(
        self,
        path: str,
        root: str | None = None,
        columns: dict[str, Any] | None = None,
        id_column: str | None = "id",
        repeat: int = 1,
        metadata_columns: list[str] | tuple[str, ...] | None = None,
    ) -> None:
        self.path = Path(path)
        self.root = root
        self.columns_cfg = columns
        self.id_column = id_column
        self.repeat = int(repeat)
        self.metadata_columns = tuple(metadata_columns or ())
        self.rows = self._read_rows(self.path)
        if not self.rows:
            raise ValueError(f"Manifest {path} is empty")
        self.columns = self._build_columns()

    def __len__(self) -> int:
        return len(self.rows) * self.repeat

    def __getitem__(self, index: int) -> dict[str, Any]:
        row = self.rows[index % len(self.rows)]
        conditions: dict[str, Any] = {}
        condition_metadata: dict[str, dict[str, Any]] = {}
        metadata: dict[str, Any] = {
            "dataset": "manifest",
            "manifest": str(self.path),
            "row_index": index % len(self.rows),
        }
        if self.id_column and self.id_column in row:
            metadata["id"] = row[self.id_column]
        for key in self.metadata_columns:
            if key in row:
                metadata[key] = row[key]

        for source_column, spec in self.columns.items():
            if source_column not in row:
                if spec.get("required", False):
                    raise KeyError(f"Manifest {self.path} row is missing required column {source_column!r}")
                continue
            cfg = dict(spec.get("params", {}))
            cfg.setdefault("root", self.root)
            value = load_condition(row[source_column], str(spec.get("loader", "auto")), cfg)
            condition_name = str(spec["condition"])
            if isinstance(value, LoadedCondition):
                condition_metadata[condition_name] = dict(value.metadata)
                value = value.data
            if value is None and not spec.get("required", False):
                continue
            conditions[condition_name] = value

        if condition_metadata:
            metadata["condition_metadata"] = condition_metadata

        return {
            "conditions": conditions,
            "metadata": metadata,
        }

    @staticmethod
    def _read_rows(path: Path) -> list[dict[str, Any]]:
        suffix = path.suffix.lower()
        if suffix == ".csv":
            with path.open("r", encoding="utf-8", newline="") as handle:
                return list(csv.DictReader(handle))
        if suffix in {".jsonl", ".json"}:
            with path.open("r", encoding="utf-8") as handle:
                if suffix == ".jsonl":
                    return [json.loads(line) for line in handle if line.strip()]
                data = json.load(handle)
                if isinstance(data, list):
                    return data
                if isinstance(data, dict) and isinstance(data.get("items"), list):
                    return data["items"]
                raise TypeError(f"JSON manifest {path} must be a list or contain an items list")
        if suffix in {".parquet", ".pq"}:
            import pandas as pd

            return pd.read_parquet(path).to_dict("records")
        raise ValueError(f"Unsupported manifest format {path.suffix!r}; use csv, jsonl, json, or parquet")

    def _build_columns(self) -> dict[str, dict[str, Any]]:
        if not self.columns_cfg:
            raise ValueError(
                f"Manifest {self.path} needs data.dataset.params.columns: one entry per column "
                "naming its condition and loader (see the shipped configs)"
            )
        return {source: self._normalize_column_spec(source, spec) for source, spec in self.columns_cfg.items()}

    @staticmethod
    def _normalize_column_spec(source: str, spec: Any) -> dict[str, Any]:
        if not isinstance(spec, dict):
            raise TypeError(f"Column spec for {source!r} must be a mapping")
        out = dict(spec)
        out.setdefault("condition", source)
        if "loader" not in out:
            raise ValueError(f"Manifest column {source!r} needs a loader: one of text, image, video")
        out.setdefault("required", False)
        out.setdefault("params", {})
        return out
