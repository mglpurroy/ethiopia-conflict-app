"""Shared pytest setup for backend tests."""

from __future__ import annotations

import os
import sys
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]

os.environ.setdefault("DATA_PATH", str(BACKEND_ROOT / "data"))
os.environ.setdefault("ACLED_DATA_PATH", str(BACKEND_ROOT / "data" / "acled_Ethiopia.csv"))
os.environ.setdefault("CACHE_DIR", str(BACKEND_ROOT / "cache"))

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))
