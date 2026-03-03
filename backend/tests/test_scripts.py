from __future__ import annotations

import subprocess
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = BACKEND_ROOT / "scripts"


def test_sync_script_includes_required_mapping_and_tif_skip():
    script = (SCRIPTS_DIR / "sync_ethiopia_source_data.sh").read_text(encoding="utf-8")

    required_fragments = [
        "acled_Ethiopia.csv",
        "acled_Ethiopia_light.csv",
        "population_data.json",
        "processed/intersection_result_acled.csv",
        "eth_adm_csa_bofedb_2021_shp",
        "skip",
        "eth_ppp_2020.tif",
    ]
    for fragment in required_fragments:
        assert fragment in script


def test_verify_script_fails_with_missing_required_files(tmp_path: Path):
    script = SCRIPTS_DIR / "verify_ethiopia_data.py"
    result = subprocess.run(
        [sys.executable, str(script), "--data-dir", str(tmp_path)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 1
    assert "Missing required file" in (result.stderr + result.stdout)


def test_verify_script_passes_on_repo_dataset():
    script = SCRIPTS_DIR / "verify_ethiopia_data.py"
    data_dir = BACKEND_ROOT / "data"
    result = subprocess.run(
        [sys.executable, str(script), "--data-dir", str(data_dir)],
        capture_output=True,
        text=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "all Ethiopia data checks passed" in result.stdout
