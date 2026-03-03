#!/usr/bin/env python3
"""Verify Ethiopia runtime datasets required by the backend."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys

import geopandas as gpd
import pandas as pd


def fail(msg: str) -> None:
    print(f"[verify] ERROR: {msg}", file=sys.stderr)
    raise SystemExit(1)


def check_required_files(data_dir: Path) -> dict[str, Path]:
    files = {
        "acled_raw": data_dir / "acled_Ethiopia.csv",
        "acled_light": data_dir / "acled_Ethiopia_light.csv",
        "population_json": data_dir / "population_data.json",
        "processed_intersection": data_dir / "processed" / "intersection_result_acled.csv",
        "adm3_shp": data_dir
        / "eth_adm_csa_bofedb_2021_shp"
        / "eth_admbnda_adm3_csa_bofedb_2021.shp",
    }
    for key, path in files.items():
        if not path.exists():
            fail(f"Missing required file `{key}` at {path}")
    print("[verify] required files exist")
    return files


def check_csv_columns(path: Path, required_cols: list[str], label: str) -> pd.DataFrame:
    try:
        df = pd.read_csv(path)
    except Exception as exc:
        fail(f"Could not read {label} CSV at {path}: {exc}")

    if df.empty:
        fail(f"{label} CSV is empty: {path}")

    missing = [c for c in required_cols if c not in df.columns]
    if missing:
        fail(f"{label} missing required columns {missing} at {path}")

    print(f"[verify] {label} columns OK ({len(df):,} rows)")
    return df


def check_dates(df: pd.DataFrame, column: str, label: str) -> None:
    parsed = pd.to_datetime(df[column], errors="coerce")
    invalid = int(parsed.isna().sum())
    if invalid > 0:
        fail(f"{label} has {invalid} unparseable `{column}` values")
    print(f"[verify] {label} date parsing OK for `{column}`")


def check_population_json(path: Path) -> None:
    try:
        pop_df = pd.read_json(path)
    except Exception as exc:
        fail(f"Could not read population JSON at {path}: {exc}")

    required = [
        "ADM3_PCODE",
        "ADM3_EN",
        "ADM2_PCODE",
        "ADM2_EN",
        "ADM1_PCODE",
        "ADM1_EN",
        "pop_count",
        "pop_count_millions",
    ]
    missing = [c for c in required if c not in pop_df.columns]
    if missing:
        fail(f"population_data.json missing required columns {missing}")
    if pop_df.empty:
        fail("population_data.json has no rows")
    if (pop_df["pop_count"] < 0).any():
        fail("population_data.json has negative pop_count values")
    print(f"[verify] population JSON OK ({len(pop_df):,} rows)")


def check_adm_shapefile(path: Path) -> None:
    try:
        gdf = gpd.read_file(path)
    except Exception as exc:
        fail(f"Could not read ADM3 shapefile at {path}: {exc}")

    required = ["ADM3_PCODE", "ADM3_EN", "ADM2_PCODE", "ADM2_EN", "ADM1_PCODE", "ADM1_EN", "geometry"]
    missing = [c for c in required if c not in gdf.columns]
    if missing:
        fail(f"ADM3 shapefile missing required columns {missing}")
    if gdf.empty:
        fail("ADM3 shapefile has no rows")
    print(f"[verify] ADM3 shapefile OK ({len(gdf):,} features)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Verify Ethiopia backend datasets.")
    parser.add_argument(
        "--data-dir",
        default=Path(__file__).resolve().parents[1] / "data",
        type=Path,
        help="Path to backend data directory (default: backend/data)",
    )
    args = parser.parse_args()
    data_dir: Path = args.data_dir

    if not data_dir.exists():
        fail(f"data dir does not exist: {data_dir}")

    files = check_required_files(data_dir)

    raw_df = check_csv_columns(
        files["acled_raw"],
        [
            "event_date",
            "event_type",
            "sub_event_type",
            "admin1",
            "admin2",
            "admin3",
            "latitude",
            "longitude",
            "fatalities",
        ],
        "acled_Ethiopia.csv",
    )
    check_dates(raw_df, "event_date", "acled_Ethiopia.csv")

    light_df = check_csv_columns(
        files["acled_light"],
        [
            "event_date",
            "year",
            "month",
            "event_type",
            "sub_event_type",
            "admin1",
            "admin2",
            "admin3",
            "location",
            "latitude",
            "longitude",
            "fatalities",
            "notes",
        ],
        "acled_Ethiopia_light.csv",
    )
    check_dates(light_df, "event_date", "acled_Ethiopia_light.csv")

    check_csv_columns(
        files["processed_intersection"],
        [
            "ADM3_PCODE",
            "ADM3_EN",
            "ADM2_PCODE",
            "ADM2_EN",
            "ADM1_PCODE",
            "ADM1_EN",
            "year",
            "month",
            "ACLED_BRD_total",
            "ACLED_BRD_state",
            "ACLED_BRD_nonstate",
        ],
        "intersection_result_acled.csv",
    )

    check_population_json(files["population_json"])
    check_adm_shapefile(files["adm3_shp"])

    print("[verify] all Ethiopia data checks passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
