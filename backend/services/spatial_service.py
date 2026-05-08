"""Spatial and GeoJSON services for the Ethiopia dashboard."""

from __future__ import annotations

import calendar
import datetime as dt
import json
import re
import time
import warnings
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

BOUNDARY_DIR = DATA_DIR / "Woredas_FCVModified"
_LEGACY_BOUNDARY_DIR = DATA_DIR / "eth_adm_csa_bofedb_2021_shp"
STATUS_LABELS = {
    0: "Below threshold",
    1: "Below threshold",
    2: "Conflict-Affected",
    3: "Highly Conflict-Affected",
}


def _empty_fc() -> dict:
    return {"type": "FeatureCollection", "features": []}


def _status_from_share(share: float, has_violence: bool) -> tuple[int, str]:
    if not has_violence:
        return 0, STATUS_LABELS[0]
    if share >= 0.2:
        return 3, STATUS_LABELS[3]
    if share >= 0.1:
        return 2, STATUS_LABELS[2]
    return 1, STATUS_LABELS[1]


def _build_admin_status_aggregates(woreda_data: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Build zone and region aggregates from woreda-level classification output."""
    woredas = woreda_data.copy()
    if woredas.empty:
        return pd.DataFrame(), pd.DataFrame()

    woredas["has_reported_violence"] = (woredas["event_count"] > 0) | (woredas["ACLED_BRD_total"] > 0)
    woredas["is_conflict_or_high"] = woredas["conflict_affected"] | woredas["highly_conflict_affected"]
    woredas["conflict_affected_population"] = np.where(woredas["is_conflict_or_high"], woredas["pop_count"], 0)

    zone = (
        woredas.groupby(["ADM2_PCODE", "ADM2_EN", "ADM1_PCODE", "ADM1_EN"], as_index=False)
        .agg(
            pop_count=("pop_count", "sum"),
            total_woredas=("ADM3_PCODE", "count"),
            affected_woredas=("is_conflict_or_high", "sum"),
            conflict_affected_woredas=("conflict_affected", "sum"),
            highly_conflict_affected_woredas=("highly_conflict_affected", "sum"),
            conflict_affected_population=("conflict_affected_population", "sum"),
            event_count=("event_count", "sum"),
            ACLED_BRD_total=("ACLED_BRD_total", "sum"),
            has_reported_violence=("has_reported_violence", "max"),
        )
    )
    zone["share_woredas_conflict_affected"] = np.where(
        zone["total_woredas"] > 0, zone["affected_woredas"] / zone["total_woredas"], 0
    )
    zone["share_population_conflict_affected"] = np.where(
        zone["pop_count"] > 0, zone["conflict_affected_population"] / zone["pop_count"], 0
    )
    zone_status = zone.apply(
        lambda row: _status_from_share(float(row["share_woredas_conflict_affected"]), bool(row["has_reported_violence"])),
        axis=1,
    )
    zone["status_code"] = zone_status.map(lambda t: t[0])
    zone["status_label"] = zone_status.map(lambda t: t[1])
    zone["is_conflict_or_high_status"] = zone["status_code"] >= 2

    region = (
        zone.groupby(["ADM1_PCODE", "ADM1_EN"], as_index=False)
        .agg(
            pop_count=("pop_count", "sum"),
            total_zones=("ADM2_PCODE", "count"),
            affected_zones=("is_conflict_or_high_status", "sum"),
            total_woredas=("total_woredas", "sum"),
            affected_woredas=("affected_woredas", "sum"),
            conflict_affected_population=("conflict_affected_population", "sum"),
            event_count=("event_count", "sum"),
            ACLED_BRD_total=("ACLED_BRD_total", "sum"),
            has_reported_violence=("has_reported_violence", "max"),
        )
    )
    region["share_zones_conflict_affected"] = np.where(
        region["total_zones"] > 0, region["affected_zones"] / region["total_zones"], 0
    )
    region["share_woredas_conflict_affected"] = np.where(
        region["total_woredas"] > 0, region["affected_woredas"] / region["total_woredas"], 0
    )
    region["share_population_conflict_affected"] = np.where(
        region["pop_count"] > 0, region["conflict_affected_population"] / region["pop_count"], 0
    )
    region_status = region.apply(
        lambda row: _status_from_share(float(row["share_zones_conflict_affected"]), bool(row["has_reported_violence"])),
        axis=1,
    )
    region["status_code"] = region_status.map(lambda t: t[0])
    region["status_label"] = region_status.map(lambda t: t[1])
    return zone, region


def _simplify(gdf: gpd.GeoDataFrame, level: int) -> gpd.GeoDataFrame:
    if gdf.empty:
        return gdf
    tol = {1: 0.01, 2: 0.005, 3: 0.002}.get(level, 0.005)
    out = gdf.copy()
    out["geometry"] = out["geometry"].simplify(tolerance=tol, preserve_topology=True)
    return out


_FCV_COL_RENAME = {
    "MergeTEXT": "ADM3_PCODE",
    "admin3Name": "ADM3_EN",
    "admin2Name": "ADM2_EN",
    "admin2Pcod": "ADM2_PCODE",
    "admin1Name": "ADM1_EN",
    "admin1Pcod": "ADM1_PCODE",
}


def load_admin_boundaries() -> dict[int, gpd.GeoDataFrame]:
    """Load ADM1/ADM2/ADM3 boundaries from Ethiopia shapefiles.

    Prefers the Woredas_FCVModified shapefile (Eth_Admin3_v2.shp) and derives
    ADM2/ADM1 boundaries by dissolving.  Falls back to the legacy CSA/BoFEDB
    shapefiles if the new one is missing.
    """
    key = _cache_key("eth_boundaries", "v3_fcv")
    cached = _get_cached(key)
    if cached is not None:
        return cached

    pkl = _load_pickle(key)
    if pkl is not None:
        _set_cached(key, pkl)
        return pkl

    empty = gpd.GeoDataFrame()

    fcv_path = BOUNDARY_DIR / "Eth_Admin3_v2.shp"
    legacy_adm3 = _LEGACY_BOUNDARY_DIR / "eth_admbnda_adm3_csa_bofedb_2021.shp"

    if fcv_path.exists():
        adm3 = gpd.read_file(fcv_path).to_crs("EPSG:4326")
        adm3 = adm3.rename(columns=_FCV_COL_RENAME)
    elif legacy_adm3.exists():
        adm3 = gpd.read_file(legacy_adm3).to_crs("EPSG:4326")
    else:
        return {1: empty, 2: empty, 3: empty}

    for col in ["ADM3_PCODE", "ADM3_EN", "ADM2_PCODE", "ADM2_EN", "ADM1_PCODE", "ADM1_EN"]:
        if col not in adm3.columns:
            adm3[col] = ""

    adm2 = adm3.dissolve(
        by=["ADM2_PCODE", "ADM2_EN", "ADM1_PCODE", "ADM1_EN"], as_index=False
    )
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


def _load_acled_admin3_join() -> pd.DataFrame:
    """Compatibility helper used during startup warmup."""
    key = _cache_key("acled_adm3_events", "v1")
    cached = _get_cached(key)
    if cached is not None:
        return cached
    raw = load_raw_acled()
    df = raw[["event_id_cnty", "event_date", "fatalities", "admin1", "admin2", "admin3"]].copy()
    df = df[df["admin3"].notna() & (df["admin3"] != "")]
    df = df.rename(columns={"admin3": "adm3_name"})
    _set_cached(key, df)
    return df


def get_by_admin3(
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    parent_zone: Optional[str] = None,
) -> list[dict]:
    """Compatibility helper for level-3 admin summaries from raw events."""
    df = load_raw_acled().copy()
    if start_date:
        df = df[df["event_date"] >= pd.to_datetime(start_date)]
    if end_date:
        df = df[df["event_date"] <= pd.to_datetime(end_date)]
    if parent_zone:
        df = df[df["admin2"] == parent_zone]
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


def _normalize_admin_name(value: object) -> str:
    s = str(value or "").strip().lower()
    s = re.sub(r"[^a-z0-9]+", " ", s)
    s = " ".join(s.split())
    # Canonicalize common Ethiopia spelling variants seen across sources.
    s = s.replace("gumz", "gumuz")
    s = s.replace("benshangul", "benishangul")
    return s


def _filter_by_admin_scope(df: pd.DataFrame, level: int, name: str) -> pd.DataFrame:
    col = "admin1" if level == 1 else "admin2" if level == 2 else "admin3"
    if col not in df.columns or not name:
        return df

    # Exact match first (fast path).
    exact = df[df[col] == name]
    if not exact.empty:
        return exact

    # Normalized equality for punctuation/spelling differences.
    target_norm = _normalize_admin_name(name)
    norm_col = df[col].map(_normalize_admin_name)
    normalized = df[norm_col == target_norm]
    if not normalized.empty:
        return normalized

    if level == 1:
        # Alias fallback for known ADM1 naming drift between boundaries and ACLED.
        alias_map = {
            "snnp": ["south ethiopia region", "central ethiopia"],
            "south west ethiopia": ["south west"],
            "benishangul gumuz": ["benishangul gumuz", "benshangul gumuz"],
        }
        aliases = alias_map.get(target_norm, [])
        if aliases:
            alias_norms = {_normalize_admin_name(a) for a in aliases}
            aliased = df[norm_col.isin(alias_norms)]
            if not aliased.empty:
                return aliased

    return df.iloc[0:0]


def _filter_by_pcode_children(df: pd.DataFrame, level: int, pcode: str) -> pd.DataFrame:
    """Fallback scope filter using population hierarchy when admin-name matching fails.

    For level 1/2 filters, match raw events by normalized ADM3 names belonging to the
    target region/zone. This is robust to admin2 naming drift in ACLED.
    """
    if level not in (1, 2) or not pcode or df.empty:
        return df.iloc[0:0]

    pop = load_population_data()
    if pop.empty:
        return df.iloc[0:0]

    if level == 1:
        rows = pop.loc[pop["ADM1_PCODE"] == pcode]
    else:
        rows = pop.loc[pop["ADM2_PCODE"] == pcode]
    if rows.empty:
        return df.iloc[0:0]

    admin3_norms = {
        _normalize_admin_name(v)
        for v in rows["ADM3_EN"].dropna().astype(str).tolist()
        if _normalize_admin_name(v)
    }
    if admin3_norms:
        admin3_col = df["admin3"].map(_normalize_admin_name)
        by_admin3 = df[admin3_col.isin(admin3_norms)]
        if not by_admin3.empty:
            return by_admin3

    # Last fallback: normalized ADM2 name matching from the hierarchy rows.
    admin2_norms = {
        _normalize_admin_name(v)
        for v in rows["ADM2_EN"].dropna().astype(str).tolist()
        if _normalize_admin_name(v)
    }
    if admin2_norms:
        admin2_col = df["admin2"].map(_normalize_admin_name)
        by_admin2 = df[admin2_col.isin(admin2_norms)]
        if not by_admin2.empty:
            return by_admin2

    return df.iloc[0:0]


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
            scoped = _filter_by_admin_scope(df, level, name)
            if scoped.empty and pcode and level in (1, 2):
                scoped = _filter_by_pcode_children(df, level, pcode)
            df = scoped
        elif pcode and level in (1, 2):
            df = _filter_by_pcode_children(df, level, pcode)

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

    if level in (1, 2, 3):
        unit_df = _filter_by_admin_scope(raw, level, name)
        if unit_df.empty and pcode and level in (1, 2):
            unit_df = _filter_by_pcode_children(raw, level, pcode)
    else:
        unit_df = raw.iloc[0:0]

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
        "share_woredas_affected",
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
    parent_pcode: str = "",
    parent_level: Optional[int] = None,
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
        "LT Conflict",
        "Escalation",
        "LT High Conflict",
        "Decreasing Conflict",
        "Recovery",
        "Below threshold",
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
        agg_thresh=0.2,
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
                "status_code",
                "status_label",
            ]
            cols = [c for c in cols if c in ward_data.columns]
            merged = gdf.merge(ward_data[cols], on="ADM3_PCODE", how="left")
            for c in cols:
                if c != "ADM3_PCODE":
                    merged[c] = merged[c].fillna(0 if c not in ["conflict_affected", "highly_conflict_affected", "violence_affected"] else False)
            if "status_code" in merged.columns:
                merged["status_code"] = merged["status_code"].fillna(0).astype(int)
            if "status_label" in merged.columns:
                merged["status_label"] = merged["status_label"].fillna(STATUS_LABELS[0])
            if parent_pcode:
                if parent_level == 1 and "ADM1_PCODE" in merged.columns:
                    merged = merged[merged["ADM1_PCODE"] == parent_pcode]
                elif parent_level == 2 and "ADM2_PCODE" in merged.columns:
                    merged = merged[merged["ADM2_PCODE"] == parent_pcode]
            return json.loads(_simplify(merged, 3).to_json())

        zone_agg, region_agg = _build_admin_status_aggregates(ward_data)
        level = 1 if agg_level == "ADM1" else 2
        gdf = boundaries.get(level, gpd.GeoDataFrame())
        if gdf.empty:
            return _empty_fc()

        if level == 1:
            merged = gdf.merge(region_agg, on=["ADM1_PCODE", "ADM1_EN"], how="left")
        else:
            merged = gdf.merge(zone_agg, on=["ADM2_PCODE", "ADM2_EN", "ADM1_PCODE", "ADM1_EN"], how="left")
            if parent_pcode and "ADM1_PCODE" in merged.columns:
                merged = merged[merged["ADM1_PCODE"] == parent_pcode]

        if map_var == "share_population":
            merged["map_metric_value"] = merged["share_population_conflict_affected"].fillna(0)
            merged["map_metric_label"] = "Share of Population in Conflict-Affected Woredas"
        else:
            merged["map_metric_value"] = merged["share_woredas_conflict_affected"].fillna(0)
            merged["map_metric_label"] = "Share of Conflict-Affected Woredas"

        merged["status_code"] = merged["status_code"].fillna(0).astype(int)
        merged["status_label"] = merged["status_label"].fillna(STATUS_LABELS[0])
        for col in ["pop_count", "event_count", "ACLED_BRD_total", "affected_woredas", "total_woredas"]:
            if col in merged.columns:
                merged[col] = merged[col].fillna(0)
        if "share_population_conflict_affected" in merged.columns:
            merged["share_population_conflict_affected"] = merged["share_population_conflict_affected"].fillna(0)
        if "share_woredas_conflict_affected" in merged.columns:
            merged["share_woredas_conflict_affected"] = merged["share_woredas_conflict_affected"].fillna(0)
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
        merged["trajectory"] = merged["trajectory"].fillna("Below threshold")
        merged["trajectory_selected"] = merged["trajectory_selected"].fillna(False)
        if parent_pcode:
            if parent_level == 1 and "ADM1_PCODE" in merged.columns:
                merged = merged[merged["ADM1_PCODE"] == parent_pcode]
            elif parent_level == 2 and "ADM2_PCODE" in merged.columns:
                merged = merged[merged["ADM2_PCODE"] == parent_pcode]
        return json.loads(_simplify(merged, 3).to_json())

    level = 1 if agg_level == "ADM1" else 2
    pcode_col = "ADM1_PCODE" if level == 1 else "ADM2_PCODE"
    gdf = boundaries.get(level, gpd.GeoDataFrame())
    if gdf.empty:
        return _empty_fc()

    def _summarize(group: pd.DataFrame) -> pd.Series:
        total = len(group)
        counts = group["trajectory"].value_counts()
        predominant = counts.index[0] if not counts.empty else "Below threshold"
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
    if level == 2 and parent_pcode and "ADM1_PCODE" in merged.columns:
        merged = merged[merged["ADM1_PCODE"] == parent_pcode]
    merged["selected_share"] = merged["selected_share"].fillna(0)
    merged["selected_count"] = merged["selected_count"].fillna(0)
    merged["predominant_trajectory"] = merged["predominant_trajectory"].fillna("Below threshold")
    return json.loads(_simplify(merged, level).to_json())


# ---------------------------------------------------------------------------
# PSNP Woredas overlay
# ---------------------------------------------------------------------------

_PSNP_CACHE: dict = {}
_PSNP_TTL = 3600
_PSNP_FUZZY_THRESHOLD = 0.65
_PSNP_SKIP_SHEETS = {"Summary", "Special Woredas"}

# Region name corrections: xlsx value -> shapefile ADM1_EN
_PSNP_REGION_FIX: dict[str, str] = {
    "Centeral Ethiopia": "Central Ethiopia",
    "Diredawa": "Dire Dawa",
    "South West": "South West Ethiopia",
}

# Woreda name corrections: xlsx value -> shapefile admin3Name
_PSNP_NAME_FIX: dict[str, str] = {
    "Glomekeda": "Gulo Mekeda",
    "Seweha sasiea": "Sebuha Saesie",
    "Klte awulaelo": "Kilte Awulaelo",
    "Tanqa mlash": "Tanqua Melashe",
    "Keyh Tekeli": "Keyhe tekli",
    "Myknetal": "Endafelasi",
    "Emeba senieat": "Emba Sieneti",
    "Hahayele": "Hahayle",
    "Adewa": "Adwa",
    "Ahisae": "Ahsea",
    "Adi Arbate": "Rama Adi Arbaete",
    "L/maychwe": "Laelay Maychew",
    "T/Maichew": "Tahtay Maychew",
    "Naedire": "Naeder",
    "selekeleka": "Laelay Koraro",
    "T/koraro": "Tahtay Koraro",
    "Asegede": "Asgede",
    "Seyemet Addeyabo": "Seyemti Adyabo",
    "M/adeyabo": "Maekel Adiyabo",
    "T/adetyabo": "Tahtay Adiyabo",
    "AdiDaerop": "Adi Daero",
    "Abergele Yechila": "Abergele (TG)",
    "Tseda emba": "Tsaeda Emba",
    "Tsirea Wonberta": "Agulae",
    "Bezet": "Bizet",
    "Gerealeta": "Geraleta",
    "Sahereti": "Saharti",
    "Hntalo": "Hintalo",
    "Wajrat": "Wajirat",
    "Neqeseg": "Neqsege",
    "TSiemebela": "Tsimbla",
    "Raya chercher": "Chercher",
    "Enda Mehoni": "Endamehoni",
    "Kola Temben": "Kola Tembien",
}


def _normalize_name(s: object) -> str:
    if not s or isinstance(s, float):
        return ""
    return re.sub(r"[\s\-_/.()+]+", "", str(s).lower().strip())


def _fuzzy_match(norm_w: str, candidates: "gpd.GeoDataFrame") -> "gpd.GeoDataFrame":
    from difflib import SequenceMatcher
    scores = candidates["norm_ADM3_EN"].apply(
        lambda x: SequenceMatcher(None, norm_w, x).ratio()
    )
    best_idx = scores.idxmax()
    if scores[best_idx] >= _PSNP_FUZZY_THRESHOLD:
        return candidates.loc[[best_idx]]
    return candidates.iloc[0:0]


def get_psnp_woredas_geojson() -> dict:
    """Return a GeoJSON FeatureCollection of PSNP woreda centroids (all regions)."""
    now = time.time()
    if "psnp" in _PSNP_CACHE and now - _PSNP_CACHE.get("psnp_ts", 0) < _PSNP_TTL:
        return _PSNP_CACHE["psnp"]

    psnp_path = DATA_DIR / "EFY 2018 PSNP Woredas list..xlsx"
    if not psnp_path.exists():
        return {"type": "FeatureCollection", "features": []}

    try:
        import openpyxl  # noqa: F401
        xl = pd.ExcelFile(psnp_path)
        frames = []
        for sheet in xl.sheet_names:
            if sheet in _PSNP_SKIP_SHEETS:
                continue
            df_sheet = pd.read_excel(xl, sheet_name=sheet)
            df_sheet.columns = df_sheet.columns.str.strip()
            frames.append(df_sheet)
        df = pd.concat(frames, ignore_index=True)
        df.columns = df.columns.str.strip()
        df["Woreda"] = df["Woreda"].str.strip()
        df["Region"] = df["Region"].str.strip().replace(_PSNP_REGION_FIX)
        df["Zone"] = df["Zone"].str.strip()
        df = df.dropna(subset=["Region", "Woreda"])
    except Exception as e:
        print(f"PSNP load error: {e}")
        return {"type": "FeatureCollection", "features": []}

    boundaries = load_admin_boundaries()
    gdf = boundaries.get(3, gpd.GeoDataFrame())
    if gdf.empty:
        return {"type": "FeatureCollection", "features": []}

    warnings.filterwarnings("ignore")
    gdf_proj = gdf.to_crs("EPSG:32637")
    gdf = gdf.copy()
    centroids = gdf_proj.geometry.centroid.to_crs("EPSG:4326")
    gdf["centroid_lon"] = centroids.x
    gdf["centroid_lat"] = centroids.y

    for col in ["ADM3_EN", "ADM1_EN"]:
        gdf[f"norm_{col}"] = gdf[col].apply(_normalize_name)

    features = []
    for _, row in df.iterrows():
        region = row["Region"]
        woreda = row["Woreda"]
        zone = row.get("Zone", "")

        lookup_name = _PSNP_NAME_FIX.get(woreda, woreda)
        norm_w = _normalize_name(lookup_name)
        norm_r = _normalize_name(region)

        candidates = gdf[gdf["norm_ADM1_EN"] == norm_r]
        if candidates.empty:
            continue

        match = candidates[candidates["norm_ADM3_EN"] == norm_w]
        if match.empty:
            for col in ["norm_ADM3_EN", "norm_ADM1_EN"]:
                pass  # already checked
            # check alt/ref name columns if present
            for col in [c for c in gdf.columns if c.startswith("norm_") and c not in ("norm_ADM3_EN", "norm_ADM1_EN")]:
                match = candidates[candidates[col] == norm_w]
                if not match.empty:
                    break
        if match.empty and len(norm_w) >= 4:
            match = candidates[candidates["norm_ADM3_EN"].str.startswith(norm_w[:6], na=False)]
        if match.empty:
            match = _fuzzy_match(norm_w, candidates)
        if match.empty:
            continue

        hit = match.iloc[0]
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [float(hit["centroid_lon"]), float(hit["centroid_lat"])],
            },
            "properties": {
                "woreda": woreda,
                "region": region,
                "zone": str(zone) if pd.notna(zone) else "",
                "pcode": hit.get("ADM3_PCODE", ""),
            },
        })

    result = {"type": "FeatureCollection", "features": features}
    _PSNP_CACHE["psnp"] = result
    _PSNP_CACHE["psnp_ts"] = now
    return result


# ---------------------------------------------------------------------------
# 3R4CACE Woredas overlay
# ---------------------------------------------------------------------------

_R4C_CACHE: dict = {}
_R4C_TTL = 3600
_R4C_FUZZY_THRESHOLD = 0.65

# (Region, Woreda) pairs for the 3R4CACE project
_R4C_WOREDAS: list[tuple[str, str]] = [
    ("Benishangul Gumuz", "Mao-Komo"),
    ("Benishangul Gumuz", "Bullen"),
    ("Benishangul Gumuz", "Buldigilu wereda"),
    ("Benishangul Gumuz", "Mandura"),
    ("Benishangul Gumuz", "Sedal"),
    ("Afar", "Hadalela"),
    ("Afar", "Berahle"),
    ("Afar", "Konaba"),
    ("Afar", "Ewa"),
    ("Afar", "Adaar"),
    ("Amhara", "Jillie TImuga"),
    ("Amhara", "Kutaber"),
    ("Amhara", "Nefas Mewucha"),
    ("Amhara", "Telemt"),
    ("Amhara", "Worebabo"),
    ("Amhara", "Ziquala"),
    ("Amhara", "Weldia-Yejju"),
    ("Amhara", "Raya Kobo"),
    ("Amhara", "Efratanagidm"),
    ("Amhara", "Kombolcha-Borkena"),
    ("Amhara", "Dessie-Menafesha"),
    ("Amhara", "Giden"),
    ("Amhara", "Lay Gayint"),
    ("Amhara", "Debark"),
    ("Amhara", "Delanta"),
    ("Amhara", "Ataye"),
    ("Amhara", "Meket"),
    ("Amhara", "Kemessie"),
    ("Amhara", "Sekota"),
    ("Amhara", "Dessie Buanbuawuha"),
    ("Tigray", "Raya Azebo"),
    ("Tigray", "Neqsege"),
    ("Tigray", "Emba Alaje"),
    ("Tigray", "Egela"),
    ("Tigray", "Tsimbla"),
    ("Tigray", "Zana"),
    ("Tigray", "Adet"),
    ("Tigray", "Maekel Adiabo"),
    ("Tigray", "Bizet"),
    ("Tigray", "Gulomkada"),
    ("Tigray", "Hahaile"),
    ("Tigray", "Wejerat"),
    ("Tigray", "Seharti"),
    ("Tigray", "Embasneiti"),
    ("Tigray", "Hintalo"),
    ("Tigray", "Hawzen"),
    ("Tigray", "Enda Mohoni"),
    ("Tigray", "Asgede"),
    ("Tigray", "Abergele"),
    ("Oromia", "Sasiga"),
    ("Oromia", "Chobi"),
    ("Oromia", "Sibu Sire"),
    ("Oromia", "Bule Hora"),
    ("Oromia", "Degem"),
]

# Region name corrections: input value -> shapefile ADM1_EN (none needed; values match)
_R4C_REGION_FIX: dict[str, str] = {}

# Woreda name corrections: input value -> shapefile ADM3_EN
_R4C_NAME_FIX: dict[str, str] = {
    # Benishangul Gumuz
    "Buldigilu wereda": "Bilidigilu",
    # Afar
    "Hadalela": "Hadelela",
    "Konaba": "Kunneba",
    "Adaar": "Adar",
    "Berahle": "Berahile",
    "Ewa": "Euwa",
    # Amhara
    "Jillie TImuga": "Jilye Tumuga",
    "Nefas Mewucha": "Nefas Mewicha town",
    "Worebabo": "Worebabu",
    "Ziquala": "Zequala",
    "Weldia-Yejju": "Habru",  # Yejju = Habru woreda in N. Wollo
    "Efratanagidm": "Eferatana Gidem",
    "Kombolcha-Borkena": "Kombolcha town",
    "Dessie-Menafesha": "Dessie Zuria",
    "Giden": "Gidan",
    "Ataye": "Ataye town",
    "Kemessie": "Kemisie town",
    "Dessie Buanbuawuha": "Dessie town",
    # Tigray
    "Maekel Adiabo": "Maekel Adiyabo",
    "Gulomkada": "Gulo Mekeda",
    "Hahaile": "Hahayle",
    "Wejerat": "Wajirat",
    "Seharti": "Saharti",
    "Embasneiti": "Emba Sieneti",
    "Enda Mohoni": "Endamehoni",
    "Abergele": "Abergele (TG)",
    # Oromia
    "Chobi": "Cobi",
}


def get_r4c_woredas_geojson() -> dict:
    """Return a GeoJSON FeatureCollection of 3R4CACE woreda centroids."""
    now = time.time()
    if "r4c" in _R4C_CACHE and now - _R4C_CACHE.get("r4c_ts", 0) < _R4C_TTL:
        return _R4C_CACHE["r4c"]

    boundaries = load_admin_boundaries()
    gdf = boundaries.get(3, gpd.GeoDataFrame())
    if gdf.empty:
        return {"type": "FeatureCollection", "features": []}

    warnings.filterwarnings("ignore")
    gdf_proj = gdf.to_crs("EPSG:32637")
    gdf = gdf.copy()
    centroids = gdf_proj.geometry.centroid.to_crs("EPSG:4326")
    gdf["centroid_lon"] = centroids.x
    gdf["centroid_lat"] = centroids.y

    for col in ["ADM3_EN", "ADM1_EN"]:
        gdf[f"norm_{col}"] = gdf[col].apply(_normalize_name)

    features = []
    unmatched: list[tuple[str, str]] = []
    for region, woreda in _R4C_WOREDAS:
        region_lookup = _R4C_REGION_FIX.get(region, region)
        woreda_lookup = _R4C_NAME_FIX.get(woreda, woreda)
        norm_w = _normalize_name(woreda_lookup)
        norm_r = _normalize_name(region_lookup)

        candidates = gdf[gdf["norm_ADM1_EN"] == norm_r]
        if candidates.empty:
            unmatched.append((region, woreda))
            continue

        match = candidates[candidates["norm_ADM3_EN"] == norm_w]
        if match.empty and len(norm_w) >= 4:
            match = candidates[candidates["norm_ADM3_EN"].str.startswith(norm_w[:6], na=False)]
        if match.empty:
            match = _fuzzy_match(norm_w, candidates)
        if match.empty:
            unmatched.append((region, woreda))
            continue

        hit = match.iloc[0]
        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [float(hit["centroid_lon"]), float(hit["centroid_lat"])],
            },
            "properties": {
                "woreda": woreda,
                "region": region,
                "matched_name": str(hit.get("ADM3_EN", "")),
                "pcode": str(hit.get("ADM3_PCODE", "")),
            },
        })

    if unmatched:
        print(f"3R4CACE unmatched ({len(unmatched)}): {unmatched}")

    result = {"type": "FeatureCollection", "features": features, "unmatched": unmatched}
    _R4C_CACHE["r4c"] = result
    _R4C_CACHE["r4c_ts"] = now
    return result
