"""Absolute-data analysis endpoints."""

from __future__ import annotations

from collections import OrderedDict

import pandas as pd
from fastapi import APIRouter, HTTPException, Query

from services.conflict_service import load_conflict_data, load_population_data

router = APIRouter(tags=["absolute"])


def _normalize_level(level: str) -> str:
    mapping = {
        "adm1": "ADM1",
        "region": "ADM1",
        "adm2": "ADM2",
        "zone": "ADM2",
        "adm3": "ADM3",
        "woreda": "ADM3",
    }
    val = level.strip().lower()
    if val not in mapping:
        raise ValueError("level must be one of: ADM1, ADM2, ADM3, region, zone, woreda")
    return mapping[val]


def _parse_pcodes(raw: str) -> list[str]:
    items = [v.strip() for v in raw.split(",") if v.strip()]
    if not items:
        raise ValueError("pcodes must include at least one comma-separated value")
    deduped = list(OrderedDict.fromkeys(items))
    if len(deduped) > 25:
        raise ValueError("pcodes supports at most 25 locations")
    return deduped


def _period_key(series: pd.Series, granularity: str) -> pd.Series:
    if granularity == "yearly":
        return series.dt.to_period("Y").astype(str)
    if granularity == "quarterly":
        return series.dt.to_period("Q").astype(str)
    return series.dt.to_period("M").astype(str)


def _full_period_range(start: pd.Timestamp, end: pd.Timestamp, granularity: str) -> list[str]:
    if granularity == "yearly":
        rng = pd.period_range(start=start, end=end, freq="Y")
    elif granularity == "quarterly":
        rng = pd.period_range(start=start, end=end, freq="Q")
    else:
        rng = pd.period_range(start=start, end=end, freq="M")
    return [str(p) for p in rng]


@router.get("/absolute/series")
def absolute_series(
    pcodes: str = Query(..., description="Comma-separated location PCODEs, max 25"),
    level: str = Query("ADM3", description="ADM1/ADM2/ADM3 or region/zone/woreda"),
    granularity: str = Query("monthly", pattern="^(monthly|quarterly|yearly)$"),
    start_year: int | None = Query(None),
    start_month: int | None = Query(None, ge=1, le=12),
    end_year: int | None = Query(None),
    end_month: int | None = Query(None, ge=1, le=12),
):
    """Return aligned zero-filled fatalities/events time-series for selected locations."""
    try:
        normalized_level = _normalize_level(level)
        selected = _parse_pcodes(pcodes)
        code_col = f"{normalized_level}_PCODE"
        name_col = f"{normalized_level}_EN"

        conflict = load_conflict_data().copy()
        pop = load_population_data()
        if code_col not in conflict.columns:
            raise ValueError(f"Conflict data does not include `{code_col}`")

        conflict["year"] = pd.to_numeric(conflict["year"], errors="coerce").fillna(0).astype(int)
        conflict["month"] = pd.to_numeric(conflict["month"], errors="coerce").fillna(0).astype(int)
        conflict = conflict[(conflict["year"] > 0) & (conflict["month"] >= 1) & (conflict["month"] <= 12)].copy()
        conflict["period_ts"] = pd.to_datetime(
            dict(year=conflict["year"], month=conflict["month"], day=1), errors="coerce"
        )
        conflict = conflict[conflict["period_ts"].notna()].copy()

        # If explicit bounds are provided, enforce them; otherwise infer from data.
        if start_year is not None:
            sm = start_month or 1
            start_ts = pd.Timestamp(year=start_year, month=sm, day=1)
        else:
            start_ts = conflict["period_ts"].min()
        if end_year is not None:
            em = end_month or 12
            end_ts = pd.Timestamp(year=end_year, month=em, day=1)
        else:
            end_ts = conflict["period_ts"].max()

        if pd.isna(start_ts) or pd.isna(end_ts):
            raise ValueError("No valid year/month records available in conflict dataset")
        if start_ts > end_ts:
            raise ValueError("start period must be <= end period")

        window = conflict[(conflict["period_ts"] >= start_ts) & (conflict["period_ts"] <= end_ts)].copy()

        monthly = (
            window[window[code_col].isin(selected)]
            .groupby([code_col, "period_ts"], as_index=False)
            .agg(
                deaths=("ACLED_BRD_total", "sum"),
                events=("event_count", "sum"),
            )
        )

        period_list = _full_period_range(start_ts, end_ts, granularity)
        if not period_list:
            raise ValueError("No periods available for selected filters")

        name_lookup = (
            pop[[code_col, name_col]]
            .dropna(subset=[code_col])
            .drop_duplicates(subset=[code_col])
            .set_index(code_col)[name_col]
            .to_dict()
            if code_col in pop.columns and name_col in pop.columns
            else {}
        )

        response_locations: list[dict] = []
        for pcode in selected:
            p_monthly = monthly[monthly[code_col] == pcode].copy()
            if p_monthly.empty:
                p_monthly = pd.DataFrame({"period_ts": pd.to_datetime([]), "deaths": [], "events": []})

            p_monthly["period"] = _period_key(p_monthly["period_ts"], granularity)
            grouped = p_monthly.groupby("period", as_index=False).agg(deaths=("deaths", "sum"), events=("events", "sum"))

            grouped = grouped.set_index("period").reindex(period_list, fill_value=0).reset_index()
            grouped["deaths"] = grouped["deaths"].astype(float)
            grouped["events"] = grouped["events"].astype(int)

            response_locations.append(
                {
                    "pcode": pcode,
                    "name": str(name_lookup.get(pcode, pcode)),
                    "total_deaths": float(grouped["deaths"].sum()),
                    "total_events": int(grouped["events"].sum()),
                    "series": grouped.to_dict(orient="records"),
                }
            )

        return {
            "level": normalized_level,
            "granularity": granularity,
            "period_start": period_list[0],
            "period_end": period_list[-1],
            "periods": period_list,
            "locations": response_locations,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
