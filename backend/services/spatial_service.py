"""Spatial and GeoJSON services for the Ethiopia dashboard."""

from __future__ import annotations

import calendar
import datetime as dt
import json
from typing import Optional

import geopandas as gpd
import numpy as np
import pandas as pd

from services.conflict_service import (
    DATA_DIR,
    _cache_key,
    _get_cached,
    _load_pickle,
    _save_pickle,
    _set_cached,
    classify_and_aggregate,
    classify_trajectory_data,
    generate_12_month_periods,
    get_period_by_id,
    load_conflict_data,
    load_population_data,
    load_raw_acled,
)

BOUNDARY_DIR = DATA_DIR / "eth_adm_csa_bofedb_2021_shp"


def _empty_fc() -> dict:
    return {"type": "FeatureCollection", "features": []}


def _simplify(gdf: gpd.GeoDataFrame, level: int) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    tol = {1: 0.01, 2: 0.005, 3: 0.002}.get(level, 0.005)
    out = gdf.copy()
    out["geometry"] = out["geometry"].simplify(tolerance=tol, preserve_topology=True)
    return out


def load_admin_boundaries() -> dict[int, gpd.GeoDataFrame]:
    """Load ADM1/ADM2/ADM3 boundaries from Ethiopia shapefiles."""
    key = _cache_key("eth_boundaries", "v1")
    cached = _get_cached(key)
    if cached is not None:
        return cached

    pkl = _load_pickle(key)
    if pkl is not None:
        _set_cached(key, pkl)
        return pkl

    adm1_path = BOUNDARY_DIR / "eth_admbnda_adm1_csa_bofedb_2021.shp"
    adm2_path = BOUNDARY_DIR / "eth_admbnda_adm2_csa_bofedb_2021.shp"
    adm3_path = BOUNDARY_DIR / "eth_admbnda_adm3_csa_bofedb_2021.shp"

    empty = gpd.GeoDataFrame()
    if not adm3_path.exists():
        result = {1: empty, 2: empty, 3: empty}
        return result

    adm3 = gpd.read_file(adm3_path).to_crs("EPSG:4326")
    if adm2_path.exists():
        adm2 = gpd.read_file(adm2_path).to_crs("EPSG:4326")
    else:
        adm2 = adm3.dissolve(by=["ADM2_PCODE", "ADM2_EN", "ADM1_PCODE", "ADM1_EN"], as_index=False)
    if adm1_path.exists():
        adm1 = gpd.read_file(adm1_path).to_crs("EPSG:4326")
    else:
        adm1 = adm2.dissolve(by=["ADM1_PCODE", "ADM1_EN"], as_index=False)

    keep1 = [c for c in ["ADM1_PCODE", "ADM1_EN", "geometry"] if c in adm1.columns]
    keep2 = [c for c in ["ADM2_PCODE", "ADM2_EN", "ADM1_PCODE", "ADM1_EN", "geometry"] if c in adm2.columns]
    keep3 = [
        c
        for c in ["ADM3_PCODE", "ADM3_EN", "ADM2_PCODE", "ADM2_EN", "ADM1_PCODE", "ADM1_EN", "geometry"]
        if c in adm3.columns
    ]

    result = {1: adm1[keep1], 2: adm2[keep2], 3: adm3[keep3]}
    _set_cached(key, result)
    _save_pickle(key, result)
    return result


def _load_acled_ward_join() -> pd.DataFrame:
    """Compatibility helper used during startup warmup."""
    key = _cache_key("acled_adm3_events", "v1")
    cached = _get_cached(key)
    if cached is not None:
        return cached
    raw = load_raw_acled()
    df = raw[["event_id_cnty", "event_date", "fatalities", "admin1", "admin2", "admin3"]].copy()
    df = df[df["admin3"].notna() & (df["admin3"] != "")]
    df = df.rename(columns={"admin3": "ward_name"})
    _set_cached(key, df)
    return df


def get_by_ward(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    parent_lga: Optional[str] = None,
) -> list[dict]:
    """Compatibility helper for level-3 admin summaries from raw events."""
    df = load_raw_acled().copy()
    if start_date:
        df = df[df["event_date"] >= pd.to_datetime(start_date)]
    if end_date:
        df = df[df["event_date"] <= pd.to_datetime(end_date)]
    if parent_lga:
        df = df[df["admin2"] == parent_lga]
    df = df[df["admin3"].notna() & (df["admin3"] != "")]
    agg = (
        df.groupby(["admin1", "admin2", "admin3"], as_index=False)
        .agg(events=("event_id_cnty", "count"), deaths=("fatalities", "sum"))
        .sort_values("deaths", ascending=False)
    )
    return agg.to_dict(orient="records")


def get_boundaries_geojson(level: int) -> dict:
    boundaries = load_admin_boundaries()
    gdf = boundaries.get(level, gpd.GeoDataFrame())
    if gdf.empty:
        return _empty_fc()
    gdf = _simplify(gdf, level)
    return json.loads(gdf.to_json())


def _date_range_from_year_month(
    start_year: Optional[int],
    start_month: Optional[int],
    end_year: Optional[int],
    end_month: Optional[int],
) -> tuple[int, int, int, int]:
    now = dt.datetime.now()
    sy = start_year if start_year is not None else now.year - 1
    sm = start_month if start_month is not None else 1
    ey = end_year if end_year is not None else now.year
    em = end_month if end_month is not None else now.month
    return sy, sm, ey, em


def _filter_raw_by_ym(
    df: pd.DataFrame, start_year: int, start_month: int, end_year: int, end_month: int
) -> pd.DataFrame:
    start_date = dt.date(start_year, start_month, 1)
    end_day = calendar.monthrange(end_year, end_month)[1]
    end_date = dt.date(end_year, end_month, end_day)
    return df[(df["event_date"].dt.date >= start_date) & (df["event_date"].dt.date <= end_date)]


def _name_from_pcode(level: int, pcode: str) -> Optional[str]:
    if not pcode:
        return None
    pop = load_population_data()
    if pop.empty:
        return None
    if level == 1:
        m = pop.loc[pop["ADM1_PCODE"] == pcode, "ADM1_EN"]
    elif level == 2:
        m = pop.loc[pop["ADM2_PCODE"] == pcode, "ADM2_EN"]
    else:
        m = pop.loc[pop["ADM3_PCODE"] == pcode, "ADM3_EN"]
    if m.empty:
        return None
    return str(m.iloc[0])


def get_events_geojson(
    start_year: Optional[int] = None,
    start_month: Optional[int] = None,
    end_year: Optional[int] = None,
    end_month: Optional[int] = None,
    limit: int = 5000,
    period_id: Optional[str] = None,
    level: Optional[int] = None,
    pcode: str = "",
    name: str = "",
) -> dict:
    """Return raw ACLED events as GeoJSON with optional period/location filters."""
    if period_id:
        period = get_period_by_id(period_id)
        if period:
            start_year = period["start_year"]
            start_month = period["start_month"]
            end_year = period["end_year"]
            end_month = period["end_month"]

    sy, sm, ey, em = _date_range_from_year_month(start_year, start_month, end_year, end_month)
    df = _filter_raw_by_ym(load_raw_acled(), sy, sm, ey, em)
    df = df[df["longitude"].notna() & df["latitude"].notna()].copy()

    if level in (1, 2, 3):
        if not name and pcode:
            name = _name_from_pcode(level, pcode) or ""
        if name:
            if level == 1:
                df = df[df["admin1"] == name]
            elif level == 2:
                df = df[df["admin2"] == name]
            else:
                df = df[df["admin3"] == name]

    if len(df) > limit:
        df = df.nlargest(limit, "fatalities")

    features = []
    for _, row in df.iterrows():
        notes = str(row.get("notes", "") or "")
        if len(notes) > 350:
            notes = notes[:350] + "…"
        features.append(
            {
                "type": "Feature",
                "geometry": {
                    "type": "Point",
                    "coordinates": [float(row["longitude"]), float(row["latitude"])],
                },
                "properties": {
                    "event_id_cnty": str(row.get("event_id_cnty", "")),
                    "event_type": str(row.get("event_type", "")),
                    "sub_event_type": str(row.get("sub_event_type", "")),
                    "actor1": str(row.get("actor1", "")),
                    "actor2": str(row.get("actor2", "")),
                    "fatalities": float(row.get("fatalities", 0) or 0),
                    "event_date": row["event_date"].strftime("%Y-%m-%d"),
                    "location": str(row.get("location", "")),
                    "admin1": str(row.get("admin1", "")),
                    "admin2": str(row.get("admin2", "")),
                    "admin3": str(row.get("admin3", "")),
                    "notes": notes,
                },
            }
        )
    return {"type": "FeatureCollection", "features": features}


def get_unit_history(level: int, pcode: str = "", name: str = "") -> dict:
    """Return monthly timeline, event-type breakdown, and actor summaries."""
    raw = load_raw_acled().copy()
    if not name and pcode:
        name = _name_from_pcode(level, pcode) or ""

    if level == 1:
        unit_df = raw[raw["admin1"] == name]
    elif level == 2:
        unit_df = raw[raw["admin2"] == name]
    else:
        unit_df = raw[raw["admin3"] == name]

    if unit_df.empty:
        return {
            "unit": name or pcode,
            "pcode": pcode,
            "level": level,
            "monthly": [],
            "by_type": [],
            "top_actors": [],
            "actor_timelines": {},
            "total_deaths": 0,
            "total_events": 0,
        }

    monthly = (
        unit_df.groupby(["year", "month"], as_index=False)
        .agg(deaths=("fatalities", "sum"), events=("event_id_cnty", "count"))
        .sort_values(["year", "month"])
    )
    monthly["period"] = monthly["year"].astype(str) + "-" + monthly["month"].astype(str).str.zfill(2)

    by_type = (
        unit_df.groupby("event_type", as_index=False)
        .agg(deaths=("fatalities", "sum"), events=("event_id_cnty", "count"))
        .sort_values("deaths", ascending=False)
    )

    a1 = unit_df.groupby("actor1", as_index=False).agg(events=("event_id_cnty", "count"), deaths=("fatalities", "sum"))
    a1 = a1.rename(columns={"actor1": "actor"})
    a2 = unit_df.groupby("actor2", as_index=False).agg(events=("event_id_cnty", "count"), deaths=("fatalities", "sum"))
    a2 = a2.rename(columns={"actor2": "actor"})
    top_actors = (
        pd.concat([a1, a2], ignore_index=True)
        .groupby("actor", as_index=False)
        .agg(events=("events", "sum"), deaths=("deaths", "sum"))
    )
    top_actors = top_actors[top_actors["actor"].notna() & (top_actors["actor"] != "") & (top_actors["actor"] != "NA")]
    top_actors = top_actors.sort_values("deaths", ascending=False).head(10)

    actor_timelines: dict[str, list[dict]] = {}
    for actor in top_actors["actor"].head(5):
        af = unit_df[(unit_df["actor1"] == actor) | (unit_df["actor2"] == actor)]
        at = af.groupby(["year", "month"], as_index=False).agg(deaths=("fatalities", "sum"))
        at = at.sort_values(["year", "month"])
        at["period"] = at["year"].astype(str) + "-" + at["month"].astype(str).str.zfill(2)
        actor_timelines[str(actor)] = at[["period", "deaths"]].to_dict(orient="records")

    return {
        "unit": name or pcode,
        "pcode": pcode,
        "level": level,
        "monthly": monthly[["year", "month", "period", "deaths", "events"]].to_dict(orient="records"),
        "by_type": by_type.to_dict(orient="records"),
        "top_actors": top_actors.to_dict(orient="records"),
        "actor_timelines": actor_timelines,
        "total_deaths": int(unit_df["fatalities"].sum()),
        "total_events": int(len(unit_df)),
    }


def get_choropleth_data(
    level: int = 1,
    variable: str = "deaths",
    start_year: Optional[int] = None,
    start_month: Optional[int] = None,
    end_year: Optional[int] = None,
    end_month: Optional[int] = None,
    rate_thresh: float = 2.0,
    abs_thresh: int = 10,
    agg_thresh: float = 0.2,
    affected_only: bool = False,
    parent_pcode: str = "",
) -> dict:
    """Compatibility choropleth endpoint used by existing map component."""
    sy, sm, ey, em = _date_range_from_year_month(start_year, start_month, end_year, end_month)
    pop = load_population_data()
    conflict = load_conflict_data()
    boundaries = load_admin_boundaries()

    if level == 3:
        _, ward_data = classify_and_aggregate(
            pop, conflict, sy, sm, ey, em, rate_thresh=rate_thresh, abs_thresh=abs_thresh, agg_thresh=agg_thresh, agg_level="ADM2"
        )
        gdf = boundaries.get(3, gpd.GeoDataFrame())
        if gdf.empty:
            return _empty_fc()
        merge_cols = [
            "ADM3_PCODE",
            "ADM3_EN",
            "ADM2_PCODE",
            "ADM2_EN",
            "ADM1_PCODE",
            "ADM1_EN",
            "pop_count",
            "ACLED_BRD_total",
            "event_count",
            "acled_total_death_rate",
            "violence_affected",
            "conflict_affected",
            "highly_conflict_affected",
        ]
        merge_cols = [c for c in merge_cols if c in ward_data.columns]
        merged = gdf.merge(ward_data[merge_cols], on="ADM3_PCODE", how="left")
        for col in ["ACLED_BRD_total", "event_count", "acled_total_death_rate", "pop_count"]:
            if col in merged.columns:
                merged[col] = merged[col].fillna(0)
        for col in ["violence_affected", "conflict_affected", "highly_conflict_affected"]:
            if col in merged.columns:
                merged[col] = merged[col].fillna(False)
        if parent_pcode and "ADM2_PCODE" in merged.columns:
            merged = merged[merged["ADM2_PCODE"] == parent_pcode]
        if affected_only and "ACLED_BRD_total" in merged.columns:
            merged = merged[merged["ACLED_BRD_total"] > 0]
        merged = _simplify(merged, 3)
        return json.loads(merged.to_json())

    agg_level = "ADM1" if level == 1 else "ADM2"
    aggregated, _ = classify_and_aggregate(
        pop, conflict, sy, sm, ey, em, rate_thresh=rate_thresh, abs_thresh=abs_thresh, agg_thresh=agg_thresh, agg_level=agg_level
    )
    gdf = boundaries.get(level, gpd.GeoDataFrame())
    if gdf.empty:
        return _empty_fc()

    pcode_col = "ADM1_PCODE" if level == 1 else "ADM2_PCODE"
    merged = gdf.merge(aggregated, on=pcode_col, how="left")
    if level == 2 and parent_pcode:
        merged = merged[merged["ADM1_PCODE"] == parent_pcode]

    for col in [
        "ACLED_BRD_total",
        "share_wards_affected",
        "share_population_affected",
        "above_threshold",
        "violence_affected",
        "total_woredas",
        "pop_count",
        "event_count",
    ]:
        if col in merged.columns:
            merged[col] = merged[col].fillna(0 if col != "above_threshold" else False)
    merged = _simplify(merged, level)
    return json.loads(merged.to_json())


def get_classification_geojson(
    period_id: str,
    map_view: str = "regions_zones",
    agg_level: str = "ADM2",
    analysis_type: str = "conflict_metrics",
    map_var: str = "share_woredas",
    conflict_metric: str = "conflict_affected",
    agg_thresh: float = 0.2,
    trajectory_categories: Optional[list[str]] = None,
) -> dict:
    """Return map-ready GeoJSON for conflict metrics or trajectory mode."""
    period = get_period_by_id(period_id)
    if not period:
        raise ValueError(f"Unknown period_id: {period_id}")

    pop = load_population_data()
    conflict = load_conflict_data()
    boundaries = load_admin_boundaries()
    categories = trajectory_categories or [
        "At-Risk",
        "Onset",
        "Recovery",
        "Turnaround",
        "Stable",
        "Fluctuating",
        "Insufficient Data",
    ]

    if conflict_metric == "highly_conflict_affected":
        rate_thresh, abs_thresh = 10.0, 40
    else:
        rate_thresh, abs_thresh = 2.0, 10

    aggregated, ward_data = classify_and_aggregate(
        pop,
        conflict,
        period["start_year"],
        period["start_month"],
        period["end_year"],
        period["end_month"],
        rate_thresh=rate_thresh,
        abs_thresh=abs_thresh,
        agg_thresh=agg_thresh,
        agg_level=agg_level,
    )

    if analysis_type == "conflict_metrics":
        if map_view == "woredas":
            gdf = boundaries.get(3, gpd.GeoDataFrame())
            if gdf.empty:
                return _empty_fc()
            cols = [
                "ADM3_PCODE",
                "ACLED_BRD_total",
                "event_count",
                "acled_total_death_rate",
                "conflict_affected",
                "highly_conflict_affected",
                "violence_affected",
                "pop_count",
            ]
            cols = [c for c in cols if c in ward_data.columns]
            merged = gdf.merge(ward_data[cols], on="ADM3_PCODE", how="left")
            for c in cols:
                if c != "ADM3_PCODE":
                    merged[c] = merged[c].fillna(0 if c not in ["conflict_affected", "highly_conflict_affected", "violence_affected"] else False)
            return json.loads(_simplify(merged, 3).to_json())

        level = 1 if agg_level == "ADM1" else 2
        gdf = boundaries.get(level, gpd.GeoDataFrame())
        if gdf.empty:
            return _empty_fc()
        pcode_col = "ADM1_PCODE" if level == 1 else "ADM2_PCODE"
        merged = gdf.merge(aggregated, on=pcode_col, how="left")
        if map_var == "share_population":
            merged["metric_value"] = merged["share_population_affected"].fillna(0)
        else:
            merged["metric_value"] = merged["share_wards_affected"].fillna(0)
        return json.loads(_simplify(merged, level).to_json())

    # Trajectory mode
    periods = generate_12_month_periods()
    traj = classify_trajectory_data(pop, conflict, periods)
    traj["trajectory_selected"] = traj["trajectory"].isin(categories)

    if map_view == "woredas":
        gdf = boundaries.get(3, gpd.GeoDataFrame())
        if gdf.empty:
            return _empty_fc()
        cols = ["ADM3_PCODE", "trajectory", "trajectory_selected", "current_classification", "current_deaths", "current_death_rate"]
        merged = gdf.merge(traj[cols], on="ADM3_PCODE", how="left")
        merged["trajectory"] = merged["trajectory"].fillna("Insufficient Data")
        merged["trajectory_selected"] = merged["trajectory_selected"].fillna(False)
        return json.loads(_simplify(merged, 3).to_json())

    level = 1 if agg_level == "ADM1" else 2
    pcode_col = "ADM1_PCODE" if level == 1 else "ADM2_PCODE"
    gdf = boundaries.get(level, gpd.GeoDataFrame())
    if gdf.empty:
        return _empty_fc()

    def _summarize(group: pd.DataFrame) -> pd.Series:
        total = len(group)
        counts = group["trajectory"].value_counts()
        predominant = counts.index[0] if not counts.empty else "Insufficient Data"
        selected_count = int(group["trajectory_selected"].sum())
        selected_share = selected_count / total if total else 0
        return pd.Series(
            {
                "total_units": total,
                "predominant_trajectory": predominant,
                "selected_count": selected_count,
                "selected_share": selected_share,
            }
        )

    summary = traj.groupby(pcode_col).apply(_summarize).reset_index()
    merged = gdf.merge(summary, on=pcode_col, how="left")
    merged["selected_share"] = merged["selected_share"].fillna(0)
    merged["selected_count"] = merged["selected_count"].fillna(0)
    merged["predominant_trajectory"] = merged["predominant_trajectory"].fillna("Insufficient Data")
    return json.loads(_simplify(merged, level).to_json())
