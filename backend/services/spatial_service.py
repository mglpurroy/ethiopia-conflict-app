"""Spatial data service — ported from mapping_functions.py (Streamlit/Folium removed)"""

import json
import time
import geopandas as gpd
import pandas as pd
import numpy as np
from pathlib import Path
from typing import Optional

from services.conflict_service import (
    DATA_DIR,
    _get_cached,
    _set_cached,
    _cache_key,
    _load_pickle,
    _save_pickle,
    load_population_data,
    load_conflict_data,
    load_raw_acled,
    classify_and_aggregate,
)


def load_admin_boundaries() -> dict:
    """Load ward/LGA/state boundaries and return as GeoDataFrames."""
    key = _cache_key("boundaries", "v4")
    cached = _get_cached(key)
    if cached is not None:
        return cached

    pkl = _load_pickle(key)
    if pkl is not None:
        _set_cached(key, pkl)
        return pkl

    ward_file = DATA_DIR / "wards" / "wards.shp"
    if not ward_file.exists():
        empty = gpd.GeoDataFrame()
        result = {1: empty, 2: empty, 3: empty}
        return result

    ward_gdf = gpd.read_file(ward_file).to_crs("EPSG:4326")
    ward_gdf = ward_gdf.rename(columns={
        'ward_cd': 'ADM3_PCODE',
        'stat_cd': 'ADM1_PCODE',
        'lga_cod': 'ADM2_PCODE',
        'wrd_nm_x': 'ADM3_EN',
    })

    lga_file = DATA_DIR / "nga_lga_boundaries.geojson"
    if lga_file.exists():
        lga_gdf = gpd.read_file(lga_file)
        state_map = dict(zip(lga_gdf['statecode'], lga_gdf['statename']))
        lga_map = dict(zip(lga_gdf['lgacode'], lga_gdf['lganame']))
        ward_gdf['ADM1_EN'] = ward_gdf['ADM1_PCODE'].map(state_map).fillna(ward_gdf['ADM1_PCODE'])
        ward_gdf['ADM2_EN'] = ward_gdf['ADM2_PCODE'].map(lga_map).fillna(ward_gdf['ADM2_PCODE'])
    else:
        ward_gdf['ADM1_EN'] = ward_gdf['ADM1_PCODE']
        ward_gdf['ADM2_EN'] = ward_gdf['ADM2_PCODE']

    lga_dissolved = ward_gdf.dissolve(
        by=['ADM1_PCODE', 'ADM2_PCODE', 'ADM1_EN', 'ADM2_EN'], aggfunc='first'
    ).reset_index()
    state_dissolved = lga_dissolved.dissolve(
        by=['ADM1_PCODE', 'ADM1_EN'], aggfunc='first'
    ).reset_index()

    result = {1: state_dissolved, 2: lga_dissolved, 3: ward_gdf}
    _set_cached(key, result)
    _save_pickle(key, result)
    return result


def _load_acled_ward_join() -> "gpd.GeoDataFrame":
    """
    Spatially join ACLED events (lat/lon points) with ward polygons.
    Result is cached to pickle — ~0.05 s for 46 K events × 9 K wards.
    Cached columns: event_id_cnty, event_date, fatalities, admin1, admin2, ward_name (ADM3_EN)
    """
    key = _cache_key("acled_ward_join", "v1")
    cached = _get_cached(key)
    if cached is not None:
        return cached
    pkl = _load_pickle(key)
    if pkl is not None:
        _set_cached(key, pkl)
        return pkl

    acled = load_raw_acled()
    ward_file = DATA_DIR / "wards" / "wards.shp"
    if not ward_file.exists():
        return gpd.GeoDataFrame()

    ward_gdf = gpd.read_file(ward_file).to_crs("EPSG:4326")

    acled_gdf = gpd.GeoDataFrame(
        acled[["event_id_cnty", "event_date", "fatalities", "admin1", "admin2"]].copy(),
        geometry=gpd.points_from_xy(acled["longitude"], acled["latitude"]),
        crs="EPSG:4326",
    )

    ward_slim = ward_gdf[["wrd_nm_x", "geometry"]].copy()
    joined = gpd.sjoin(acled_gdf, ward_slim, how="left", predicate="within")
    # Drop unmatched events and geometry columns
    joined = joined[joined["wrd_nm_x"].notna()].copy()
    joined = joined[["event_id_cnty", "event_date", "fatalities", "admin1", "admin2", "wrd_nm_x"]]
    joined = joined.rename(columns={"wrd_nm_x": "ward_name"})
    joined = joined.reset_index(drop=True)

    _set_cached(key, joined)
    _save_pickle(key, joined)
    return joined


def get_by_ward(
    start_date: str | None = None,
    end_date: str | None = None,
    parent_lga: str | None = None,
) -> list[dict]:
    """
    Aggregate conflict deaths/events by ward using spatial join.
    parent_lga: filter to wards belonging to this ACLED admin2 name.
    """
    df = _load_acled_ward_join()
    if df.empty:
        return []

    if start_date:
        df = df[df["event_date"] >= pd.to_datetime(start_date)]
    if end_date:
        df = df[df["event_date"] <= pd.to_datetime(end_date)]
    if parent_lga:
        df = df[df["admin2"] == parent_lga]

    agg = (
        df.groupby(["admin1", "admin2", "ward_name"])
        .agg(events=("event_id_cnty", "count"), deaths=("fatalities", "sum"))
        .reset_index()
        .rename(columns={"ward_name": "admin3"})
    )
    return agg.sort_values("deaths", ascending=False).to_dict(orient="records")


def get_boundaries_geojson(level: int) -> dict:
    """Return GeoJSON for a given admin level (1=state, 2=LGA, 3=ward)."""
    boundaries = load_admin_boundaries()
    gdf = boundaries.get(level, gpd.GeoDataFrame())
    if gdf.empty:
        return {"type": "FeatureCollection", "features": []}

    # Simplify for performance (ward level especially)
    if level == 3:
        gdf = gdf.copy()
        gdf['geometry'] = gdf['geometry'].simplify(tolerance=0.005, preserve_topology=True)

    # Drop non-serialisable columns
    keep_cols = ['geometry']
    for col in ['ADM1_PCODE', 'ADM1_EN', 'ADM2_PCODE', 'ADM2_EN', 'ADM3_PCODE', 'ADM3_EN']:
        if col in gdf.columns:
            keep_cols.append(col)

    return json.loads(gdf[keep_cols].to_json())


def get_unit_history(level: int, pcode: str = '', name: str = '') -> dict:
    """Return monthly time-series + event-type breakdown for a single admin unit."""
    if level == 3:
        conflict = load_conflict_data()
        if pcode and 'ADM3_PCODE' in conflict.columns:
            df = conflict[conflict['ADM3_PCODE'] == pcode].copy()
        elif name and 'ADM3_EN' in conflict.columns:
            df = conflict[conflict['ADM3_EN'] == name].copy()
        else:
            df = pd.DataFrame()

        if not df.empty and 'year' in df.columns and 'month' in df.columns:
            monthly = df.groupby(['year', 'month'], as_index=False).agg(
                deaths=('ACLED_BRD_total', 'sum')
            )
            monthly['events'] = 0
            monthly['period'] = (
                monthly['year'].astype(str) + '-'
                + monthly['month'].astype(str).str.zfill(2)
            )
            monthly = monthly.sort_values(['year', 'month'])
            records = monthly[['year', 'month', 'period', 'deaths', 'events']].to_dict(orient='records')
            total_deaths = int(monthly['deaths'].sum())
        else:
            records, total_deaths = [], 0

        return {
            'unit': name or pcode,
            'pcode': pcode,
            'level': level,
            'monthly': records,
            'by_type': [],
            'top_actors': [],
            'actor_timelines': {},
            'total_deaths': total_deaths,
            'total_events': 0,
        }

    # State / LGA — use raw ACLED (has event_type, full fatalities)
    raw = load_raw_acled()
    if level == 1:
        filtered = raw[raw['admin1'] == name].copy()
    else:
        filtered = raw[raw['admin2'] == name].copy()

    if filtered.empty:
        return {
            'unit': name, 'pcode': pcode, 'level': level,
            'monthly': [], 'by_type': [],
            'total_deaths': 0, 'total_events': 0,
        }

    monthly = filtered.groupby(['year', 'month'], as_index=False).agg(
        deaths=('fatalities', 'sum'),
        events=('event_id_cnty', 'count'),
    )
    monthly['period'] = (
        monthly['year'].astype(str) + '-'
        + monthly['month'].astype(str).str.zfill(2)
    )
    monthly = monthly.sort_values(['year', 'month'])

    by_type = (
        filtered.groupby('event_type', as_index=False)
        .agg(deaths=('fatalities', 'sum'), events=('event_id_cnty', 'count'))
        .sort_values('deaths', ascending=False)
    )

    # Top actors — combine actor1 and actor2 appearances in this unit
    a1 = filtered.groupby('actor1').agg(
        events=('event_id_cnty', 'count'), deaths=('fatalities', 'sum')
    ).reset_index().rename(columns={'actor1': 'actor'})
    a2 = filtered.groupby('actor2').agg(
        events=('event_id_cnty', 'count'), deaths=('fatalities', 'sum')
    ).reset_index().rename(columns={'actor2': 'actor'})
    top_actors = (
        pd.concat([a1, a2])
        .groupby('actor', as_index=False)
        .agg(events=('events', 'sum'), deaths=('deaths', 'sum'))
    )
    top_actors = top_actors[top_actors['actor'].notna() & (top_actors['actor'] != '') & (top_actors['actor'] != 'NA')]
    top_actors = top_actors.sort_values('deaths', ascending=False).head(10)

    # Per-actor monthly timeline for top 5 (used for sparklines)
    top5 = top_actors['actor'].head(5).tolist()
    actor_timelines: dict = {}
    for actor in top5:
        af = filtered[(filtered['actor1'] == actor) | (filtered['actor2'] == actor)]
        at = af.groupby(['year', 'month'], as_index=False).agg(deaths=('fatalities', 'sum'))
        at['period'] = at['year'].astype(str) + '-' + at['month'].astype(str).str.zfill(2)
        at = at.sort_values(['year', 'month'])
        actor_timelines[actor] = at[['period', 'deaths']].to_dict(orient='records')

    return {
        'unit': name,
        'pcode': pcode,
        'level': level,
        'monthly': monthly[['year', 'month', 'period', 'deaths', 'events']].to_dict(orient='records'),
        'by_type': by_type.to_dict(orient='records'),
        'top_actors': top_actors.to_dict(orient='records'),
        'actor_timelines': actor_timelines,
        'total_deaths': int(filtered['fatalities'].sum()),
        'total_events': int(len(filtered)),
    }


def get_events_geojson(
    start_year: Optional[int] = None,
    start_month: Optional[int] = None,
    end_year: Optional[int] = None,
    end_month: Optional[int] = None,
    limit: int = 5000,
) -> dict:
    """Return a GeoJSON FeatureCollection of raw ACLED events (Point features)."""
    import datetime
    now = datetime.datetime.now()
    if end_year is None:
        end_year = now.year
    if end_month is None:
        end_month = now.month
    if start_year is None:
        start_year = end_year - 1
    if start_month is None:
        start_month = 1

    df = load_raw_acled().copy()

    start_date = datetime.date(start_year, start_month, 1)
    import calendar
    last_day = calendar.monthrange(end_year, end_month)[1]
    end_date = datetime.date(end_year, end_month, last_day)

    df = df[df['event_date'].dt.date >= start_date]
    df = df[df['event_date'].dt.date <= end_date]

    # Drop rows without coordinates
    for col in ('longitude', 'latitude'):
        if col in df.columns:
            df = df[df[col].notna()]

    if len(df) > limit:
        df = df.nlargest(limit, 'fatalities')

    features = []
    for _, row in df.iterrows():
        lon = float(row.get('longitude', 0))
        lat = float(row.get('latitude', 0))
        notes_raw = str(row.get('notes', '')) if pd.notna(row.get('notes', '')) else ''
        notes = notes_raw[:200] + ('…' if len(notes_raw) > 200 else '')
        event_date = row['event_date'].strftime('%Y-%m-%d') if pd.notna(row.get('event_date')) else ''
        props = {
            'event_type':    str(row.get('event_type', '')),
            'sub_event_type': str(row.get('sub_event_type', '')),
            'actor1':        str(row.get('actor1', '')),
            'fatalities':    int(row.get('fatalities', 0) or 0),
            'event_date':    event_date,
            'location':      str(row.get('location', '')),
            'admin1':        str(row.get('admin1', '')),
            'admin2':        str(row.get('admin2', '')),
            'notes':         notes,
        }
        features.append({
            'type': 'Feature',
            'geometry': {'type': 'Point', 'coordinates': [lon, lat]},
            'properties': props,
        })

    return {'type': 'FeatureCollection', 'features': features}


def get_choropleth_data(
    level: int = 1,
    variable: str = 'deaths',
    start_year: int | None = None,
    start_month: int | None = None,
    end_year: int | None = None,
    end_month: int | None = None,
    rate_thresh: float = 10.0,
    abs_thresh: int = 5,
    agg_thresh: float = 0.1,
    affected_only: bool = False,
    parent_pcode: str = '',
) -> dict:
    """
    Return GeoJSON with conflict attributes merged for choropleth rendering.
    level:       1=state, 2=LGA, 3=ward
    variable:    'deaths' | 'rate' | 'ward_share'
    parent_pcode: filter level-2 to one state, or level-3 to one LGA
    affected_only: (level 3 only) filter to wards with any conflict events
    """
    import datetime
    now = datetime.datetime.now()

    if end_year is None:
        end_year = now.year
    if end_month is None:
        end_month = now.month
    if start_year is None:
        start_year = end_year - 1
    if start_month is None:
        start_month = end_month

    pop = load_population_data()
    conflict = load_conflict_data()
    boundaries = load_admin_boundaries()

    # Ward level uses ward_data directly from classify_and_aggregate
    if level == 3:
        _, ward_data = classify_and_aggregate(
            pop, conflict,
            start_year, start_month, end_year, end_month,
            rate_thresh, abs_thresh, agg_thresh, 'ADM1',
        )

        gdf = boundaries.get(3, gpd.GeoDataFrame())
        if gdf.empty:
            return {"type": "FeatureCollection", "features": []}

        # Merge ward conflict data onto boundaries
        ward_cols = ['ADM3_PCODE']
        for col in ['ADM3_EN', 'ADM2_EN', 'ADM1_EN', 'pop_count',
                    'violence_affected', 'ACLED_BRD_total', 'acled_total_death_rate']:
            if col in ward_data.columns:
                ward_cols.append(col)

        # Include ADM2_PCODE from boundaries so we can filter by LGA
        gdf_cols = ['ADM3_PCODE', 'geometry']
        if 'ADM2_PCODE' in gdf.columns:
            gdf_cols = ['ADM3_PCODE', 'ADM2_PCODE', 'geometry']
        merged_gdf = gdf[gdf_cols].merge(
            ward_data[ward_cols], on='ADM3_PCODE', how='left'
        )

        # Fill missing values
        for col in ['ACLED_BRD_total', 'acled_total_death_rate', 'pop_count']:
            if col in merged_gdf.columns:
                merged_gdf[col] = merged_gdf[col].fillna(0)
        if 'violence_affected' in merged_gdf.columns:
            merged_gdf['violence_affected'] = (
                merged_gdf['violence_affected'].fillna(False).astype(bool)
            )
        for col in ['ADM3_EN', 'ADM2_EN', 'ADM1_EN']:
            if col in merged_gdf.columns:
                merged_gdf[col] = merged_gdf[col].fillna('Unknown')

        # Aggressive simplification — 9k+ polygons
        merged_gdf = merged_gdf.copy()
        merged_gdf['geometry'] = merged_gdf['geometry'].simplify(
            tolerance=0.01, preserve_topology=True
        )

        # Filter to wards with events when requested (default off — show full map)
        if affected_only:
            merged_gdf = merged_gdf[merged_gdf['ACLED_BRD_total'] > 0].copy()

        # Drill-down: restrict to wards in one LGA
        if parent_pcode and 'ADM2_PCODE' in merged_gdf.columns:
            merged_gdf = merged_gdf[merged_gdf['ADM2_PCODE'] == parent_pcode].copy()

        return json.loads(merged_gdf.to_json())

    # ── State / LGA level ────────────────────────────────────────────────────
    agg_level = 'ADM1' if level == 1 else 'ADM2'
    aggregated, _ = classify_and_aggregate(
        pop, conflict,
        start_year, start_month, end_year, end_month,
        rate_thresh, abs_thresh, agg_thresh, agg_level,
    )

    # Event count per admin unit (all ACLED event types, not just lethal BRD)
    raw = load_raw_acled()
    if start_year == end_year:
        raw_period = raw[
            (raw['year'] == start_year) &
            (raw['month'] >= start_month) &
            (raw['month'] <= end_month)
        ]
    else:
        raw_period = raw[
            ((raw['year'] == start_year) & (raw['month'] >= start_month)) |
            ((raw['year'] > start_year) & (raw['year'] < end_year)) |
            ((raw['year'] == end_year) & (raw['month'] <= end_month))
        ]
    name_col = 'admin1' if agg_level == 'ADM1' else 'admin2'
    en_col   = 'ADM1_EN' if agg_level == 'ADM1' else 'ADM2_EN'
    event_counts = (
        raw_period.groupby(name_col).size()
        .reset_index(name='event_count')
        .rename(columns={name_col: en_col})
    )
    if en_col in aggregated.columns:
        aggregated = aggregated.merge(event_counts, on=en_col, how='left')
        aggregated['event_count'] = aggregated['event_count'].fillna(0).astype(int)
    else:
        aggregated['event_count'] = 0

    gdf = boundaries.get(level, gpd.GeoDataFrame())
    if gdf.empty:
        return {"type": "FeatureCollection", "features": []}

    pcode_col = 'ADM1_PCODE' if level == 1 else 'ADM2_PCODE'
    merge_cols = [pcode_col, 'ACLED_BRD_total', 'share_wards_affected',
                  'share_population_affected', 'above_threshold', 'violence_affected',
                  'total_wards', 'pop_count', 'event_count']
    merge_cols = [c for c in merge_cols if c in aggregated.columns]
    merged_gdf = gdf.merge(aggregated[merge_cols], on=pcode_col, how='left')

    # Drill-down: restrict to LGAs in one state
    if parent_pcode and level == 2 and 'ADM1_PCODE' in merged_gdf.columns:
        merged_gdf = merged_gdf[merged_gdf['ADM1_PCODE'] == parent_pcode].copy()

    for col in ['ACLED_BRD_total', 'share_wards_affected', 'share_population_affected',
                'violence_affected', 'total_wards', 'pop_count', 'event_count']:
        if col in merged_gdf.columns:
            merged_gdf[col] = merged_gdf[col].fillna(0)
    if 'above_threshold' in merged_gdf.columns:
        merged_gdf['above_threshold'] = merged_gdf['above_threshold'].fillna(False)

    merged_gdf = merged_gdf.copy()
    merged_gdf['geometry'] = merged_gdf['geometry'].simplify(
        tolerance=0.01 if level == 1 else 0.005, preserve_topology=True
    )

    keep = ['geometry', pcode_col, 'ACLED_BRD_total', 'share_wards_affected',
            'share_population_affected', 'above_threshold', 'violence_affected',
            'total_wards', 'pop_count', 'event_count']
    if level == 1 and 'ADM1_EN' in merged_gdf.columns:
        keep.append('ADM1_EN')
    if level == 2:
        for c in ['ADM2_EN', 'ADM1_EN', 'ADM1_PCODE']:
            if c in merged_gdf.columns:
                keep.append(c)

    keep = [c for c in keep if c in merged_gdf.columns]
    return json.loads(merged_gdf[keep].to_json())
