"""Location trend analysis endpoints."""

from fastapi import APIRouter, HTTPException, Query

from services.conflict_service import (
    _get_event_ids_by_woreda_period,
    calculate_trajectory_classification,
    generate_12_month_periods,
    get_location_trend_data,
    load_conflict_data,
    load_population_data,
)

router = APIRouter(tags=["trends"])


def _normalize_level(level: str) -> str:
    val = level.strip().lower()
    mapping = {
        "adm1": "region",
        "region": "region",
        "adm2": "zone",
        "zone": "zone",
        "adm3": "woreda",
        "woreda": "woreda",
    }
    if val not in mapping:
        raise ValueError("level must be one of: ADM1, ADM2, ADM3, region, zone, woreda")
    return mapping[val]


def _location_meta(pop, level: str, pcode: str) -> dict:
    if level == "region":
        code_col, name_col = "ADM1_PCODE", "ADM1_EN"
    elif level == "zone":
        code_col, name_col = "ADM2_PCODE", "ADM2_EN"
    else:
        code_col, name_col = "ADM3_PCODE", "ADM3_EN"

    subset = pop[pop[code_col] == pcode]
    if subset.empty:
        raise ValueError(f"Unknown location pcode `{pcode}` for level `{level}`")

    row = subset.iloc[0]
    return {
        "level": level,
        "pcode": str(pcode),
        "name": str(row.get(name_col, "")),
        "adm1_pcode": str(row.get("ADM1_PCODE", "")),
        "adm1_name": str(row.get("ADM1_EN", "")),
        "adm2_pcode": str(row.get("ADM2_PCODE", "")),
        "adm2_name": str(row.get("ADM2_EN", "")),
    }


@router.get("/trends/location")
def trends_location(
    pcode: str = Query(..., description="Location PCODE"),
    level: str = Query("ADM3", description="ADM1/ADM2/ADM3 or region/zone/woreda"),
    lookback_periods: int = Query(10, ge=3, le=50),
):
    """Return location historical series plus computed trajectory class."""
    try:
        normalized_level = _normalize_level(level)
        pop = load_population_data()
        conflict = load_conflict_data()
        location = _location_meta(pop, normalized_level, pcode)
        periods = generate_12_month_periods()
        series_df = get_location_trend_data(conflict, pop, pcode, level=normalized_level, periods_list=periods)
        event_ids_by_period = None
        if normalized_level == "woreda":
            event_ids_map = _get_event_ids_by_woreda_period(periods, max_periods=6)
            event_ids_by_period = {
                pid: event_ids_map.get((pcode, pid), set())
                for pid in (series_df["period_id"].tolist() if not series_df.empty else [])
            }
        trajectory = calculate_trajectory_classification(
            series_df, lookback_periods=min(lookback_periods, 6), event_ids_by_period=event_ids_by_period
        )

        records = series_df.to_dict(orient="records")
        latest = records[-1] if records else None

        return {
            "location": location,
            "trajectory": trajectory,
            "lookback_periods": lookback_periods,
            "latest": latest,
            "series": records,
        }
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
