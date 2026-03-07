"""World Bank project sites service for Ethiopia."""

import glob
import time
import warnings
import pandas as pd
import geopandas as gpd
from pathlib import Path

from services.conflict_service import DATA_DIR
from services.spatial_service import load_admin_boundaries

warnings.filterwarnings("ignore")

CACHE_TTL = 3600
_cache: dict = {}

ISO2 = "ET"

_MASTER_COLS = [
    "PROJ_ID", "PROJ_SHORT_NAME", "PROJ_STAT_NAME", "LEAD_GP_NAME",
    "PROJ_APPRVL_FY", "TOT_CMT_AMT", "PROJ_DEV_OBJECTIVE_DESC",
]


def _find_csv(pattern: str) -> Path | None:
    matches = sorted(glob.glob(str(DATA_DIR / pattern)))
    return Path(matches[-1]) if matches else None


def _load_merged() -> pd.DataFrame:
    now = time.time()
    if "merged" in _cache and now - _cache.get("merged_ts", 0) < CACHE_TTL:
        return _cache["merged"]

    geo_path = _find_csv("PROJECT_GEOGRAPHIC_LOCATION_V*.csv")
    master_path = _find_csv("PROJECT_MASTER_V*.csv")
    if not geo_path or not master_path:
        return pd.DataFrame()

    geo = pd.read_csv(geo_path, skiprows=4, encoding="latin-1", on_bad_lines="skip", low_memory=False)
    master = pd.read_csv(master_path, skiprows=4, encoding="latin-1", on_bad_lines="skip", low_memory=False)

    country_geo = geo[geo["ISO_CNTRY_CODE"] == ISO2].copy()
    country_geo["GEO_LATITUDE_NBR"] = pd.to_numeric(country_geo["GEO_LATITUDE_NBR"], errors="coerce")
    country_geo["GEO_LONGITUDE_NBR"] = pd.to_numeric(country_geo["GEO_LONGITUDE_NBR"], errors="coerce")
    country_geo = country_geo.dropna(subset=["GEO_LATITUDE_NBR", "GEO_LONGITUDE_NBR"])

    country_master = (
        master[master["CNTRY_CODE"] == ISO2][_MASTER_COLS]
        .drop_duplicates("PROJ_ID")
    )

    merged = country_geo.merge(country_master, on="PROJ_ID", how="left")

    try:
        boundaries = load_admin_boundaries()
        adm2 = boundaries.get(2, gpd.GeoDataFrame())
        if not adm2.empty:
            cols = [c for c in ["ADM1_EN", "ADM2_EN", "geometry"] if c in adm2.columns]
            points_gdf = gpd.GeoDataFrame(
                merged.reset_index(drop=True),
                geometry=gpd.points_from_xy(merged["GEO_LONGITUDE_NBR"], merged["GEO_LATITUDE_NBR"]),
                crs="EPSG:4326",
            )
            joined = gpd.sjoin(points_gdf, adm2[cols], how="left", predicate="within")
            joined = joined[~joined.index.duplicated(keep="first")]
            merged = merged.reset_index(drop=True)
            if "ADM1_EN" in joined.columns:
                merged["matched_admin1"] = joined["ADM1_EN"].values
            if "ADM2_EN" in joined.columns:
                merged["matched_admin2"] = joined["ADM2_EN"].values
    except Exception as e:
        print(f"WB spatial join warning: {e}")
        merged["matched_admin1"] = merged.get("ADMIN_UNIT1_NAME", "")
        merged["matched_admin2"] = merged.get("ADMIN_UNIT2_NAME", "")

    _cache["merged"] = merged
    _cache["merged_ts"] = now
    return merged


def load_wb_projects(status_filter: str | None = None) -> dict:
    """Return a GeoJSON FeatureCollection of WB project sites in Ethiopia."""
    now = time.time()
    cache_key = f"wb_geojson_{status_filter}"
    if cache_key in _cache and now - _cache.get(f"{cache_key}_ts", 0) < CACHE_TTL:
        return _cache[cache_key]

    merged = _load_merged()
    if merged.empty:
        return {"type": "FeatureCollection", "features": []}

    if status_filter:
        merged = merged[merged["PROJ_STAT_NAME"].str.contains(status_filter, case=False, na=False)]

    def _str(val: object) -> str:
        return str(val) if pd.notna(val) else ""

    features = []
    for _, row in merged.iterrows():
        commitment = row.get("TOT_CMT_AMT")
        commitment = None if pd.isna(commitment) else float(commitment)
        approval_fy = row.get("PROJ_APPRVL_FY")
        approval_fy = None if pd.isna(approval_fy) else int(approval_fy)

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [float(row["GEO_LONGITUDE_NBR"]), float(row["GEO_LATITUDE_NBR"])],
            },
            "properties": {
                "proj_id": _str(row["PROJ_ID"]),
                "name": _str(row.get("PROJ_SHORT_NAME")),
                "status": _str(row.get("PROJ_STAT_NAME")),
                "practice": _str(row.get("LEAD_GP_NAME")),
                "approval_fy": approval_fy,
                "commitment_amt": commitment,
                "location_name": _str(row.get("GEO_LOC_NME")),
                "admin1": _str(row.get("matched_admin1") or row.get("ADMIN_UNIT1_NAME")),
                "feat_class": _str(row.get("FEAT_CLASS_NAME")),
                "objective": _str(row.get("PROJ_DEV_OBJECTIVE_DESC"))[:300],
            },
        })

    geojson = {"type": "FeatureCollection", "features": features}
    _cache[cache_key] = geojson
    _cache[f"{cache_key}_ts"] = now
    return geojson


def get_projects_by_unit(level: int, name: str, status_filter: str | None = None) -> list[dict]:
    """Return WB projects whose sites fall within the given admin unit."""
    merged = _load_merged()
    if merged.empty:
        return []

    name_clean = name.replace(" Region", "").replace(" Zone", "").replace(" Woreda", "").strip()

    if level == 2:
        mask = merged.get("matched_admin2", pd.Series(dtype=str)).str.contains(name_clean, case=False, na=False)
        if not mask.any():
            mask = merged.get("matched_admin1", pd.Series(dtype=str)).str.contains(name_clean, case=False, na=False)
    else:
        mask = merged.get("matched_admin1", pd.Series(dtype=str)).str.contains(name_clean, case=False, na=False)

    subset = merged[mask].copy()
    if status_filter:
        subset = subset[subset["PROJ_STAT_NAME"].str.contains(status_filter, case=False, na=False)]

    if subset.empty:
        return []

    def _str(val: object) -> str:
        return str(val) if pd.notna(val) else ""

    results = []
    for proj_id, grp in subset.groupby("PROJ_ID"):
        row = grp.iloc[0]
        commitment = row.get("TOT_CMT_AMT")
        commitment = None if pd.isna(commitment) else float(commitment)
        approval_fy = row.get("PROJ_APPRVL_FY")
        approval_fy = None if pd.isna(approval_fy) else int(approval_fy)
        locations = grp["GEO_LOC_NME"].dropna().tolist()
        results.append({
            "proj_id": _str(proj_id),
            "name": _str(row.get("PROJ_SHORT_NAME")),
            "status": _str(row.get("PROJ_STAT_NAME")),
            "practice": _str(row.get("LEAD_GP_NAME")),
            "approval_fy": approval_fy,
            "commitment_amt": commitment,
            "location_count": len(grp),
            "locations": locations[:5],
            "objective": _str(row.get("PROJ_DEV_OBJECTIVE_DESC"))[:200],
        })

    results.sort(key=lambda r: (r["status"] != "Active", r["name"]))
    return results
