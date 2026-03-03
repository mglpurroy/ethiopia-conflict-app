"""Conflict and period services for the Ethiopia dashboard."""

from __future__ import annotations

import datetime as dt
import hashlib
import os
import pickle
import time
from pathlib import Path
from typing import Optional

import geopandas as gpd
import numpy as np
import pandas as pd

# ---------------------------------------------------------------------------
# Paths and cache helpers
# ---------------------------------------------------------------------------

SCRIPT_DIR = Path(__file__).parent.parent.resolve()
DATA_DIR = Path(os.getenv("DATA_PATH", str(SCRIPT_DIR / "data")))
PROCESSED_DIR = DATA_DIR / "processed"
CACHE_DIR = Path(os.getenv("CACHE_DIR", str(SCRIPT_DIR / "cache")))
CACHE_DIR.mkdir(exist_ok=True, parents=True)

START_YEAR = int(os.getenv("START_YEAR", "2009"))
END_YEAR = int(os.getenv("END_YEAR", str(dt.datetime.now().year)))

_ACLED_PATHS = [
    DATA_DIR / "acled_Ethiopia.csv",
    SCRIPT_DIR / "acled_Ethiopia.csv",
    Path(os.getenv("ACLED_DATA_PATH", str(DATA_DIR / "acled_Ethiopia.csv"))),
]

_cache: dict[str, tuple[object, float]] = {}
_CACHE_TTL = int(os.getenv("CACHE_TTL", "3600"))


def _cache_key(*args) -> str:
    return hashlib.md5(str(args).encode()).hexdigest()


def _get_cached(key: str):
    if key in _cache:
        value, ts = _cache[key]
        if time.time() - ts < _CACHE_TTL:
            return value
    return None


def _set_cached(key: str, value) -> None:
    _cache[key] = (value, time.time())


def _save_pickle(key: str, value) -> None:
    try:
        with open(CACHE_DIR / f"{key}.pkl", "wb") as f:
            pickle.dump(value, f)
    except Exception:
        pass


def _load_pickle(key: str):
    try:
        p = CACHE_DIR / f"{key}.pkl"
        if p.exists():
            with open(p, "rb") as f:
                return pickle.load(f)
    except Exception:
        pass
    return None


def _find_acled() -> Path:
    for p in _ACLED_PATHS:
        try:
            rp = p.resolve()
            if rp.exists():
                return rp
        except Exception:
            pass
    return _ACLED_PATHS[0]


ACLED_DATA = _find_acled()


# ---------------------------------------------------------------------------
# Period helpers
# ---------------------------------------------------------------------------

def generate_12_month_periods(start_year: int = START_YEAR) -> list[dict]:
    """Generate Jan-Dec and Jul-Jun periods (latest first)."""
    key = _cache_key("periods", start_year)
    cached = _get_cached(key)
    if cached is not None:
        return cached

    max_year = END_YEAR
    max_month = 12
    try:
        raw = load_raw_acled()
        if not raw.empty:
            max_year = int(raw["year"].max())
            max_month = int(raw.loc[raw["year"] == max_year, "month"].max())
    except Exception:
        pass

    periods: list[dict] = []
    for year in range(start_year, max_year + 1):
        # Include current-year Jan-Dec even if incomplete (latest operational window).
        if year < max_year or max_month >= 1:
            periods.append(
                {
                    "id": f"{year:04d}01_{year:04d}12",
                    "label": f"Jan {year} - Dec {year}",
                    "start_year": year,
                    "start_month": 1,
                    "end_year": year,
                    "end_month": 12,
                    "type": "calendar",
                    "sort_index": year * 100 + 1,
                }
            )
        # Include Jul-Jun only when the end year is available.
        if year < max_year:
            periods.append(
                {
                    "id": f"{year:04d}07_{year + 1:04d}06",
                    "label": f"Jul {year} - Jun {year + 1}",
                    "start_year": year,
                    "start_month": 7,
                    "end_year": year + 1,
                    "end_month": 6,
                    "type": "mid_year",
                    "sort_index": year * 100 + 7,
                }
            )

    periods.sort(key=lambda p: p["sort_index"], reverse=True)
    _set_cached(key, periods)
    return periods


def get_period_by_id(period_id: str) -> Optional[dict]:
    for period in generate_12_month_periods():
        if period["id"] == period_id:
            return period
    return None


# ---------------------------------------------------------------------------
# Data loaders
# ---------------------------------------------------------------------------

def load_raw_acled() -> pd.DataFrame:
    """Load raw Ethiopia ACLED events."""
    key = _cache_key("raw_acled", "ethiopia_v1", str(ACLED_DATA))
    cached = _get_cached(key)
    if cached is not None:
        return cached

    if not ACLED_DATA.exists():
        raise FileNotFoundError(f"ACLED data not found at {ACLED_DATA}")

    df = pd.read_csv(ACLED_DATA)
    if "event_date" not in df.columns:
        raise ValueError(f"`event_date` column missing in {ACLED_DATA}")

    df["event_date"] = pd.to_datetime(df["event_date"], errors="coerce")
    df = df[df["event_date"].notna()].copy()
    df["year"] = df["event_date"].dt.year
    df["month"] = df["event_date"].dt.month

    if "fatalities" not in df.columns:
        df["fatalities"] = 0
    df["fatalities"] = pd.to_numeric(df["fatalities"], errors="coerce").fillna(0)

    # Ensure keys used by existing endpoints exist.
    for col in ["admin1", "admin2", "admin3", "event_type", "sub_event_type", "actor1", "actor2", "location"]:
        if col not in df.columns:
            df[col] = ""
    for col in ["latitude", "longitude"]:
        if col not in df.columns:
            df[col] = np.nan
        df[col] = pd.to_numeric(df[col], errors="coerce")
    if "event_id_cnty" not in df.columns:
        df["event_id_cnty"] = (df.index + 1).astype(str)

    _set_cached(key, df)
    return df


def load_population_data() -> pd.DataFrame:
    """Load ADM3 population data from JSON with shapefile fallback."""
    key = _cache_key("population", "ethiopia_v1")
    cached = _get_cached(key)
    if cached is not None:
        return cached

    pkl = _load_pickle(key)
    if pkl is not None:
        _set_cached(key, pkl)
        return pkl

    json_path = DATA_DIR / "population_data.json"
    if json_path.exists():
        pop = pd.read_json(json_path)
    else:
        shp = DATA_DIR / "eth_adm_csa_bofedb_2021_shp" / "eth_admbnda_adm3_csa_bofedb_2021.shp"
        if not shp.exists():
            pop = pd.DataFrame(
                columns=[
                    "ADM3_PCODE",
                    "ADM3_EN",
                    "ADM2_PCODE",
                    "ADM2_EN",
                    "ADM1_PCODE",
                    "ADM1_EN",
                    "ADM0_PCODE",
                    "pop_count",
                    "pop_count_millions",
                ]
            )
        else:
            gdf = gpd.read_file(shp)
            pop = pd.DataFrame(
                {
                    "ADM3_PCODE": gdf.get("ADM3_PCODE", ""),
                    "ADM3_EN": gdf.get("ADM3_EN", ""),
                    "ADM2_PCODE": gdf.get("ADM2_PCODE", ""),
                    "ADM2_EN": gdf.get("ADM2_EN", ""),
                    "ADM1_PCODE": gdf.get("ADM1_PCODE", ""),
                    "ADM1_EN": gdf.get("ADM1_EN", ""),
                    "ADM0_PCODE": gdf.get("ADM0_PCODE", "ETH"),
                    "pop_count": 0,
                    "pop_count_millions": 0.0,
                }
            )

    for col in ["ADM3_PCODE", "ADM3_EN", "ADM2_PCODE", "ADM2_EN", "ADM1_PCODE", "ADM1_EN"]:
        if col not in pop.columns:
            pop[col] = ""
        pop[col] = pop[col].astype(str)

    if "ADM0_PCODE" not in pop.columns:
        pop["ADM0_PCODE"] = "ETH"
    if "pop_count" not in pop.columns:
        pop["pop_count"] = 0

    pop["pop_count"] = pd.to_numeric(pop["pop_count"], errors="coerce").fillna(0).astype(int)
    pop["pop_count_millions"] = pop["pop_count"] / 1e6

    _set_cached(key, pop)
    _save_pickle(key, pop)
    return pop


def load_conflict_data() -> pd.DataFrame:
    """Load processed intersection data with fallback aggregation from raw ACLED."""
    key = _cache_key("conflict_data", "ethiopia_v1")
    cached = _get_cached(key)
    if cached is not None:
        return cached

    pkl = _load_pickle(key)
    if pkl is not None:
        _set_cached(key, pkl)
        return pkl

    path = PROCESSED_DIR / "intersection_result_acled.csv"
    if path.exists():
        conflict = pd.read_csv(path)
    else:
        raw = load_raw_acled()
        conflict = (
            raw.groupby(["admin3", "year", "month"], as_index=False)
            .agg(ACLED_BRD_total=("fatalities", "sum"), event_count=("event_id_cnty", "count"))
            .rename(columns={"admin3": "ADM3_EN"})
        )
        pop = load_population_data()
        conflict = conflict.merge(
            pop[["ADM3_PCODE", "ADM3_EN", "ADM2_PCODE", "ADM2_EN", "ADM1_PCODE", "ADM1_EN"]].drop_duplicates("ADM3_PCODE"),
            on="ADM3_EN",
            how="left",
        )

    # Normalize expected columns.
    rename_map = {
        "wardcode": "ADM3_PCODE",
        "wardname": "ADM3_EN",
        "lganame": "ADM2_EN",
        "statename": "ADM1_EN",
    }
    conflict = conflict.rename(columns={k: v for k, v in rename_map.items() if k in conflict.columns})

    for col in ["ADM3_PCODE", "ADM3_EN", "ADM2_PCODE", "ADM2_EN", "ADM1_PCODE", "ADM1_EN"]:
        if col not in conflict.columns:
            conflict[col] = ""
        conflict[col] = conflict[col].fillna("").astype(str)

    for col in ["year", "month"]:
        if col not in conflict.columns:
            conflict[col] = 0
        conflict[col] = pd.to_numeric(conflict[col], errors="coerce").fillna(0).astype(int)

    if "ACLED_BRD_total" not in conflict.columns:
        conflict["ACLED_BRD_total"] = 0
    conflict["ACLED_BRD_total"] = pd.to_numeric(conflict["ACLED_BRD_total"], errors="coerce").fillna(0.0)

    if "ACLED_BRD_state" not in conflict.columns:
        conflict["ACLED_BRD_state"] = conflict["ACLED_BRD_total"] * 0.5
    if "ACLED_BRD_nonstate" not in conflict.columns:
        conflict["ACLED_BRD_nonstate"] = conflict["ACLED_BRD_total"] * 0.5

    if "event_count" not in conflict.columns:
        conflict["event_count"] = 0
    conflict["event_count"] = pd.to_numeric(conflict["event_count"], errors="coerce").fillna(0).astype(int)

    _set_cached(key, conflict)
    _save_pickle(key, conflict)
    return conflict


def create_admin_levels(pop_data: pd.DataFrame) -> dict:
    """Aggregate population to ADM1/ADM2/ADM3."""
    if pop_data.empty:
        return {"admin1": pd.DataFrame(), "admin2": pd.DataFrame(), "admin3": pop_data}

    admin2 = pop_data.groupby(
        ["ADM2_PCODE", "ADM2_EN", "ADM1_PCODE", "ADM1_EN", "ADM0_PCODE"], as_index=False
    ).agg({"pop_count": "sum", "pop_count_millions": "sum"})
    admin1 = pop_data.groupby(["ADM1_PCODE", "ADM1_EN", "ADM0_PCODE"], as_index=False).agg(
        {"pop_count": "sum", "pop_count_millions": "sum"}
    )
    return {"admin1": admin1, "admin2": admin2, "admin3": pop_data}


# ---------------------------------------------------------------------------
# Core analytics
# ---------------------------------------------------------------------------

def filter_data_by_period(
    data: pd.DataFrame, start_year: int, start_month: int, end_year: int, end_month: int
) -> pd.DataFrame:
    """Filter conflict data by inclusive year/month period."""
    if data.empty:
        return data

    if start_year == end_year:
        mask = (data["year"] == start_year) & (data["month"] >= start_month) & (data["month"] <= end_month)
    else:
        mask = (
            ((data["year"] == start_year) & (data["month"] >= start_month))
            | ((data["year"] > start_year) & (data["year"] < end_year))
            | ((data["year"] == end_year) & (data["month"] <= end_month))
        )
    return data[mask]


def classify_and_aggregate(
    pop_data: pd.DataFrame,
    conflict_data: pd.DataFrame,
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
    rate_thresh: float = 2.0,
    abs_thresh: int = 10,
    agg_thresh: float = 0.2,
    agg_level: str = "ADM2",
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """
    Classify ADM3 units and aggregate to ADM1 or ADM2.
    - conflict_affected: death_rate >= 2 and deaths >= 10
    - highly_conflict_affected: death_rate >= 10 and deaths >= 40
    """
    period_conflict = filter_data_by_period(conflict_data, start_year, start_month, end_year, end_month)
    if period_conflict.empty:
        merged = pop_data.copy()
        merged["ACLED_BRD_total"] = 0.0
        merged["ACLED_BRD_state"] = 0.0
        merged["ACLED_BRD_nonstate"] = 0.0
        merged["event_count"] = 0
    else:
        conflict_agg = (
            period_conflict.groupby("ADM3_PCODE", as_index=False)
            .agg(
                ACLED_BRD_state=("ACLED_BRD_state", "sum"),
                ACLED_BRD_nonstate=("ACLED_BRD_nonstate", "sum"),
                ACLED_BRD_total=("ACLED_BRD_total", "sum"),
                event_count=("event_count", "sum"),
            )
        )
        merged = pop_data.merge(conflict_agg, on="ADM3_PCODE", how="left")
        for col in ["ACLED_BRD_state", "ACLED_BRD_nonstate", "ACLED_BRD_total", "event_count"]:
            merged[col] = merged[col].fillna(0)

    merged["acled_total_death_rate"] = np.where(
        merged["pop_count"] > 0, (merged["ACLED_BRD_total"] / merged["pop_count"]) * 1e5, 0
    )
    merged["conflict_affected"] = (merged["acled_total_death_rate"] >= 2.0) & (merged["ACLED_BRD_total"] >= 10)
    merged["highly_conflict_affected"] = (merged["acled_total_death_rate"] >= 10.0) & (
        merged["ACLED_BRD_total"] >= 40
    )
    merged["violence_affected"] = (merged["acled_total_death_rate"] >= rate_thresh) & (
        merged["ACLED_BRD_total"] >= abs_thresh
    )

    if agg_level == "ADM1":
        group_cols = ["ADM1_PCODE", "ADM1_EN"]
    else:
        group_cols = ["ADM2_PCODE", "ADM2_EN", "ADM1_PCODE", "ADM1_EN"]

    aggregated = merged.groupby(group_cols, as_index=False).agg(
        pop_count=("pop_count", "sum"),
        violence_affected=("violence_affected", "sum"),
        conflict_affected=("conflict_affected", "sum"),
        highly_conflict_affected=("highly_conflict_affected", "sum"),
        total_woredas=("ADM3_PCODE", "count"),
        ACLED_BRD_total=("ACLED_BRD_total", "sum"),
        event_count=("event_count", "sum"),
    )

    aggregated["share_wards_affected"] = np.where(
        aggregated["total_woredas"] > 0, aggregated["violence_affected"] / aggregated["total_woredas"], 0
    )
    aggregated["share_woredas_conflict_affected"] = np.where(
        aggregated["total_woredas"] > 0, aggregated["conflict_affected"] / aggregated["total_woredas"], 0
    )
    aggregated["share_woredas_high_conflict"] = np.where(
        aggregated["total_woredas"] > 0, aggregated["highly_conflict_affected"] / aggregated["total_woredas"], 0
    )

    affected_pop = (
        merged[merged["violence_affected"]]
        .groupby(group_cols[0], as_index=False)["pop_count"]
        .sum()
        .rename(columns={"pop_count": "affected_population"})
    )
    conflict_pop = (
        merged[merged["conflict_affected"]]
        .groupby(group_cols[0], as_index=False)["pop_count"]
        .sum()
        .rename(columns={"pop_count": "conflict_affected_population"})
    )
    high_pop = (
        merged[merged["highly_conflict_affected"]]
        .groupby(group_cols[0], as_index=False)["pop_count"]
        .sum()
        .rename(columns={"pop_count": "high_conflict_population"})
    )

    aggregated = aggregated.merge(affected_pop, on=group_cols[0], how="left")
    aggregated = aggregated.merge(conflict_pop, on=group_cols[0], how="left")
    aggregated = aggregated.merge(high_pop, on=group_cols[0], how="left")

    for col in ["affected_population", "conflict_affected_population", "high_conflict_population"]:
        aggregated[col] = aggregated[col].fillna(0)

    aggregated["share_population_affected"] = np.where(
        aggregated["pop_count"] > 0, aggregated["affected_population"] / aggregated["pop_count"], 0
    )
    aggregated["above_threshold"] = aggregated["share_wards_affected"] > agg_thresh

    return aggregated, merged


# ---------------------------------------------------------------------------
# Existing route helpers
# ---------------------------------------------------------------------------

def get_summary_kpis(start_date: Optional[str] = None, end_date: Optional[str] = None) -> dict:
    raw = load_raw_acled()
    if start_date:
        raw = raw[raw["event_date"] >= pd.to_datetime(start_date)]
    if end_date:
        raw = raw[raw["event_date"] <= pd.to_datetime(end_date)]

    pop = load_population_data()
    conflict = load_conflict_data()
    wards_with_events = conflict[conflict["ACLED_BRD_total"] > 0]["ADM3_PCODE"].nunique()
    return {
        "total_events": int(len(raw)),
        "total_deaths": int(raw["fatalities"].sum()),
        "wards_affected": int(wards_with_events),
        "total_wards": int(len(pop)),
        "last_update": raw["event_date"].max().isoformat() if not raw.empty else None,
        "data_start": raw["event_date"].min().isoformat() if not raw.empty else None,
    }


def get_timeseries(
    frequency: str = "monthly",
    dimension: str = "event_type",
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    states: Optional[list[str]] = None,
    event_types: Optional[list[str]] = None,
) -> list[dict]:
    df = load_raw_acled().copy()
    if start_date:
        df = df[df["event_date"] >= pd.to_datetime(start_date)]
    if end_date:
        df = df[df["event_date"] <= pd.to_datetime(end_date)]
    if states:
        df = df[df["admin1"].isin(states)]
    if event_types:
        df = df[df["event_type"].isin(event_types)]

    if frequency == "yearly":
        df["period"] = df["event_date"].dt.to_period("Y").astype(str)
    elif frequency == "quarterly":
        df["period"] = df["event_date"].dt.to_period("Q").astype(str)
    else:
        df["period"] = df["event_date"].dt.to_period("M").astype(str)

    group_col = {"event_type": "event_type", "sub_event_type": "sub_event_type", "actor": "actor1"}.get(
        dimension, "event_type"
    )
    agg = (
        df.groupby(["period", group_col], as_index=False)
        .agg(events=("event_id_cnty", "count"), deaths=("fatalities", "sum"))
        .rename(columns={group_col: "dimension"})
    )
    return agg.to_dict(orient="records")


def get_by_admin(
    level: int = 1,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    parent: Optional[str] = None,
) -> list[dict]:
    df = load_raw_acled().copy()
    if start_date:
        df = df[df["event_date"] >= pd.to_datetime(start_date)]
    if end_date:
        df = df[df["event_date"] <= pd.to_datetime(end_date)]

    if level == 1:
        group_cols = ["admin1"]
    elif level == 2:
        group_cols = ["admin1", "admin2"]
    else:
        if parent:
            df = df[df["admin2"] == parent]
        group_cols = ["admin1", "admin2", "admin3"]

    agg = df.groupby(group_cols, as_index=False).agg(events=("event_id_cnty", "count"), deaths=("fatalities", "sum"))
    return agg.to_dict(orient="records")


def get_filtered_events(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    states: Optional[list[str]] = None,
    event_types: Optional[list[str]] = None,
    limit: int = 1000,
) -> list[dict]:
    df = load_raw_acled().copy()
    if start_date:
        df = df[df["event_date"] >= pd.to_datetime(start_date)]
    if end_date:
        df = df[df["event_date"] <= pd.to_datetime(end_date)]
    if states:
        df = df[df["admin1"].isin(states)]
    if event_types:
        df = df[df["event_type"].isin(event_types)]
    df = df.sort_values("fatalities", ascending=False).head(limit)
    df["event_date"] = df["event_date"].dt.strftime("%Y-%m-%d")
    return df.to_dict(orient="records")


def get_actors(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    top_n: int = 20,
    event_types: Optional[list[str]] = None,
    actor_types: Optional[list[str]] = None,
) -> list[dict]:
    df = load_raw_acled().copy()
    if start_date:
        df = df[df["event_date"] >= pd.to_datetime(start_date)]
    if end_date:
        df = df[df["event_date"] <= pd.to_datetime(end_date)]
    if event_types:
        df = df[df["event_type"].isin(event_types)]

    if actor_types and "inter1" in df.columns and "inter2" in df.columns:
        df_a1 = df[df["inter1"].astype(str).isin(actor_types)]
        df_a2 = df[df["inter2"].astype(str).isin(actor_types)]
    else:
        df_a1 = df
        df_a2 = df

    a1 = df_a1.groupby("actor1", as_index=False).agg(events=("event_id_cnty", "count"), deaths=("fatalities", "sum"))
    a1 = a1.rename(columns={"actor1": "actor"})
    a2 = df_a2.groupby("actor2", as_index=False).agg(events=("event_id_cnty", "count"), deaths=("fatalities", "sum"))
    a2 = a2.rename(columns={"actor2": "actor"})

    combined = pd.concat([a1, a2], ignore_index=True).groupby("actor", as_index=False).agg(
        events=("events", "sum"), deaths=("deaths", "sum")
    )
    combined = combined[combined["actor"].notna() & (combined["actor"] != "") & (combined["actor"] != "NA")]
    combined = combined.sort_values("deaths", ascending=False).head(top_n)
    return combined.to_dict(orient="records")


# ---------------------------------------------------------------------------
# Trajectory helpers
# ---------------------------------------------------------------------------

def get_location_trend_data(
    conflict_data: pd.DataFrame,
    pop_data: pd.DataFrame,
    location_pcode: str,
    level: str = "woreda",
    periods_list: Optional[list[dict]] = None,
) -> pd.DataFrame:
    if periods_list is None:
        periods_list = generate_12_month_periods()

    pop_col = {"woreda": "ADM3_PCODE", "zone": "ADM2_PCODE", "region": "ADM1_PCODE"}[level]
    conflict_col = pop_col

    rows: list[dict] = []
    for period in periods_list:
        period_conflict = filter_data_by_period(
            conflict_data,
            period["start_year"],
            period["start_month"],
            period["end_year"],
            period["end_month"],
        )
        unit = period_conflict[period_conflict[conflict_col] == location_pcode]
        deaths = float(unit["ACLED_BRD_total"].sum()) if not unit.empty else 0.0
        events = int(unit["event_count"].sum()) if "event_count" in unit.columns else int(len(unit))

        pop_unit = pop_data[pop_data[pop_col] == location_pcode]
        pop_count = float(pop_unit["pop_count"].sum()) if not pop_unit.empty else 0.0
        death_rate = (deaths / pop_count) * 1e5 if pop_count > 0 else 0.0

        if death_rate >= 10.0 and deaths >= 40:
            classification = 2
            classification_label = "Highly Conflict-Affected"
        elif death_rate >= 2.0 and deaths >= 10:
            classification = 1
            classification_label = "Conflict-Affected"
        else:
            classification = 0
            classification_label = "Below Threshold"

        rows.append(
            {
                "period_id": period["id"],
                "period": period["label"],
                "period_type": period["type"],
                "start_year": period["start_year"],
                "start_month": period["start_month"],
                "deaths": deaths,
                "events": events,
                "death_rate": death_rate,
                "classification": classification,
                "classification_label": classification_label,
            }
        )

    df = pd.DataFrame(rows)
    if not df.empty:
        df = df.sort_values(["start_year", "start_month"]).reset_index(drop=True)
    return df


def calculate_trajectory_classification(historical_data: pd.DataFrame, lookback_periods: int = 10) -> str:
    """Classify a location's trajectory over recent periods."""
    if len(historical_data) < 3:
        return "Insufficient Data"

    recent = historical_data.tail(lookback_periods)
    classifications = recent["classification"].values
    death_rates = recent["death_rate"].values
    deaths = recent["deaths"].values

    conflict_periods = int(np.sum(classifications >= 1))
    total_periods = len(recent)
    conflict_ratio = conflict_periods / total_periods if total_periods else 0

    if len(death_rates) > 1:
        x = np.arange(len(death_rates))
        slope = np.polyfit(x, death_rates, 1)[0]
    else:
        slope = 0

    if len(deaths) > 1:
        x = np.arange(len(deaths))
        death_slope = np.polyfit(x, deaths, 1)[0]
    else:
        death_slope = 0

    if conflict_ratio == 0:
        return "At-Risk" if (slope > 0.5 or death_slope > 5) else "Stable"
    if conflict_ratio < 0.3:
        if slope > 1.0 or death_slope > 10:
            return "At-Risk"
        if slope < -0.5 or death_slope < -5:
            return "Recovery"
        return "Stable"
    if conflict_ratio < 0.7:
        if slope > 1.0 or death_slope > 10:
            return "Onset"
        if slope < -1.0 or death_slope < -10:
            return "Recovery"
        return "Turnaround"
    if slope > 0.5 or death_slope > 5:
        return "Onset"
    if slope < -1.0 or death_slope < -10:
        return "Recovery"
    return "Fluctuating"


def classify_trajectory_data(
    pop_data: pd.DataFrame,
    conflict_data: pd.DataFrame,
    periods: list[dict],
) -> pd.DataFrame:
    """Calculate trajectory classes for every ADM3 unit."""
    key = _cache_key("trajectory_all", len(pop_data), len(conflict_data), periods[0]["id"] if periods else "none")
    cached = _get_cached(key)
    if cached is not None:
        return cached

    units = pop_data[["ADM1_PCODE", "ADM1_EN", "ADM2_PCODE", "ADM2_EN", "ADM3_PCODE", "ADM3_EN"]].drop_duplicates()
    out_rows: list[dict] = []
    for _, unit in units.iterrows():
        trend = get_location_trend_data(conflict_data, pop_data, unit["ADM3_PCODE"], level="woreda", periods_list=periods)
        trajectory = calculate_trajectory_classification(trend) if not trend.empty else "Insufficient Data"
        current = trend.iloc[-1] if not trend.empty else None
        out_rows.append(
            {
                "ADM1_PCODE": unit["ADM1_PCODE"],
                "ADM1_EN": unit["ADM1_EN"],
                "ADM2_PCODE": unit["ADM2_PCODE"],
                "ADM2_EN": unit["ADM2_EN"],
                "ADM3_PCODE": unit["ADM3_PCODE"],
                "ADM3_EN": unit["ADM3_EN"],
                "trajectory": trajectory,
                "current_classification": current["classification_label"] if current is not None else "Unknown",
                "current_deaths": float(current["deaths"]) if current is not None else 0.0,
                "current_death_rate": float(current["death_rate"]) if current is not None else 0.0,
                "conflict_periods": int((trend["classification"] >= 1).sum()) if not trend.empty else 0,
                "total_periods": int(len(trend)),
            }
        )

    result = pd.DataFrame(out_rows)
    _set_cached(key, result)
    return result
