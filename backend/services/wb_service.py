"""World Bank project sites service (legacy module, currently not mounted)."""

import os
import glob
import time
import warnings
import pandas as pd
import geopandas as gpd
from pathlib import Path

warnings.filterwarnings("ignore")

SCRIPT_DIR = Path(__file__).parent.parent.resolve()
DATA_DIR = Path(os.getenv("DATA_PATH", str(SCRIPT_DIR / "data")))
BOUNDARIES_PATH = Path(
    os.getenv(
        "WB_BOUNDARIES_PATH",
        str(DATA_DIR / "eth_adm_csa_bofedb_2021_shp" / "eth_admbnda_adm2_csa_bofedb_2021.shp"),
    )
)
CENTER_COUNTRY_ISO = os.getenv("WB_COUNTRY_ISO", "ETH")
CENTER_COUNTRY_NAME = os.getenv("WB_COUNTRY_NAME", "Ethiopia")
CACHE_TTL = 3600

_cache: dict = {}

_MASTER_COLS = [
    "PROJ_ID", "PROJ_SHORT_NAME", "PROJ_STAT_NAME", "LEAD_GP_NAME",
    "PROJ_APPRVL_FY", "TOT_CMT_AMT", "PROJ_DEV_OBJECTIVE_DESC",
]


def _find_csv(pattern: str) -> Path | None:
    matches = sorted(glob.glob(str(DATA_DIR / pattern)))
    return Path(matches[-1]) if matches else None


def _load_merged() -> pd.DataFrame:
    """Load, merge, and spatially enrich WB geo + master CSVs for configured country. Cached."""
    now = time.time()
    if "merged" in _cache and now - _cache.get("merged_ts", 0) < CACHE_TTL:
        return _cache["merged"]

    geo_path = _find_csv("PROJECT_GEOGRAPHIC_LOCATION_V*.csv")
    master_path = _find_csv("PROJECT_MASTER_V*.csv")
    if not geo_path or not master_path:
        return pd.DataFrame()

    geo = pd.read_csv(geo_path, skiprows=4, encoding="latin-1", on_bad_lines="skip", low_memory=False)
    master = pd.read_csv(master_path, skiprows=4, encoding="latin-1", on_bad_lines="skip", low_memory=False)

    country_geo = geo[geo["ISO_CNTRY_CODE"] == CENTER_COUNTRY_ISO].copy()
    country_geo["GEO_LATITUDE_NBR"] = pd.to_numeric(country_geo["GEO_LATITUDE_NBR"], errors="coerce")
    country_geo["GEO_LONGITUDE_NBR"] = pd.to_numeric(country_geo["GEO_LONGITUDE_NBR"], errors="coerce")
    country_geo = country_geo.dropna(subset=["GEO_LATITUDE_NBR", "GEO_LONGITUDE_NBR"])

    country_master = (
        master[master["CNTRY_SHORT_NAME"].str.contains(CENTER_COUNTRY_NAME, case=False, na=False)][_MASTER_COLS]
        .drop_duplicates("PROJ_ID")
    )

    merged = country_geo.merge(country_master, on="PROJ_ID", how="left")

    # Spatial join: assign admin-1 + admin-2 from boundary polygons based on coordinates.
    # This is necessary because active projects often have no ADMIN_UNIT1/2_NAME filled in.
    try:
        boundaries = gpd.read_file(BOUNDARIES_PATH)
        admin1_col = "ADM1_EN" if "ADM1_EN" in boundaries.columns else "statename"
        admin2_col = "ADM2_EN" if "ADM2_EN" in boundaries.columns else "lganame"
        boundaries = boundaries[[admin1_col, admin2_col, "geometry"]].rename(
            columns={admin1_col: "admin1_name", admin2_col: "admin2_name"}
        )
        points_gdf = gpd.GeoDataFrame(
            merged.reset_index(drop=True),
            geometry=gpd.points_from_xy(merged["GEO_LONGITUDE_NBR"], merged["GEO_LATITUDE_NBR"]),
            crs="EPSG:4326",
        )
        joined = gpd.sjoin(points_gdf, boundaries, how="left", predicate="within")
        # sjoin can produce duplicate rows when a point touches multiple polygons — keep first match
        joined = joined[~joined.index.duplicated(keep="first")]
        merged = merged.reset_index(drop=True)
        merged["matched_admin1"] = joined["admin1_name"].values
        merged["matched_admin2"] = joined["admin2_name"].values
    except Exception as e:
        print(f"WB spatial join warning: {e}")
        merged["matched_admin1"] = merged["ADMIN_UNIT1_NAME"]
        merged["matched_admin2"] = merged["ADMIN_UNIT2_NAME"]

    _cache["merged"] = merged
    _cache["merged_ts"] = now
    return merged


def load_wb_projects(status_filter: str | None = None) -> dict:
    """Return a GeoJSON FeatureCollection of WB project sites in the configured country."""
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

        props = {
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
        }

        features.append({
            "type": "Feature",
            "geometry": {
                "type": "Point",
                "coordinates": [float(row["GEO_LONGITUDE_NBR"]), float(row["GEO_LATITUDE_NBR"])],
            },
            "properties": props,
        })

    geojson = {"type": "FeatureCollection", "features": features}
    _cache[cache_key] = geojson
    _cache[f"{cache_key}_ts"] = now
    return geojson


def get_projects_by_unit(level: int, name: str, status_filter: str | None = None) -> list[dict]:
    """Return WB projects whose sites fall within the given admin unit.

    Uses spatially-derived matched_admin1/matched_admin2 columns so that active
    projects (which often have no ADMIN_UNIT1_NAME in the raw CSV) are included.
    """
    merged = _load_merged()
    if merged.empty:
        return []

    # Strip common suffixes so "Amhara Region" -> "Amhara" for matching
    name_clean = name.replace(" Region", "").replace(" Zone", "").strip()

    if level == 2:
        mask = merged["matched_admin2"].str.contains(name_clean, case=False, na=False)
        if not mask.any():
            mask = merged["matched_admin1"].str.contains(name_clean, case=False, na=False)
    else:
        # level 1 (admin-1) or level 3 (admin-3 — match to parent admin-1)
        mask = merged["matched_admin1"].str.contains(name_clean, case=False, na=False)

    subset = merged[mask].copy()

    if status_filter:
        subset = subset[subset["PROJ_STAT_NAME"].str.contains(status_filter, case=False, na=False)]

    if subset.empty:
        return []

    def _str(val: object) -> str:
        return str(val) if pd.notna(val) else ""

    groups = subset.groupby("PROJ_ID")
    results = []
    for proj_id, grp in groups:
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


def get_wb_state_summary() -> dict[str, dict]:
    """Return per-admin1 aggregated WB project stats.

    Returns a dict keyed by admin-1 name with:
    - active_count: number of distinct active projects
    - total_commitment: sum of commitments for active projects (USD)
    """
    now = time.time()
    if "state_summary" in _cache and now - _cache.get("state_summary_ts", 0) < CACHE_TTL:
        return _cache["state_summary"]

    merged = _load_merged()
    if merged.empty:
        return {}

    result: dict[str, dict] = {}
    for state, grp in merged.groupby("matched_admin1"):
        if not state or pd.isna(state):
            continue
        unique = grp.drop_duplicates("PROJ_ID")
        active = unique[unique["PROJ_STAT_NAME"].str.contains("Active", case=False, na=False)]
        total_comm = active["TOT_CMT_AMT"].dropna().sum()
        result[str(state)] = {
            "active_count": int(len(active)),
            "total_commitment": float(total_comm) if total_comm else 0.0,
        }

    _cache["state_summary"] = result
    _cache["state_summary_ts"] = now
    return result
