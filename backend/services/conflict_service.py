"""Conflict data service — ported from dashboard_utils.py (Streamlit removed)"""

import pandas as pd
import numpy as np
import geopandas as gpd
from pathlib import Path
import pickle
import hashlib
import time
import os
import warnings
warnings.filterwarnings('ignore')

# ---------------------------------------------------------------------------
# Path configuration
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).parent.parent.resolve()
DATA_DIR = Path(os.getenv("DATA_PATH", str(SCRIPT_DIR / "data")))
PROCESSED_DIR = DATA_DIR / "processed"
CACHE_DIR = Path(os.getenv("CACHE_DIR", str(SCRIPT_DIR / "cache")))

CACHE_DIR.mkdir(exist_ok=True)

START_YEAR = 1997
END_YEAR = 2025

_ACLED_PATHS = [
    DATA_DIR / "acled_Nigeria.csv",
    SCRIPT_DIR / "acled_Nigeria.csv",
    Path(os.getenv("ACLED_DATA_PATH", "acled_Nigeria.csv")),
]

def _find_acled() -> Path:
    for p in _ACLED_PATHS:
        try:
            if p.resolve().exists():
                return p.resolve()
        except Exception:
            pass
    return _ACLED_PATHS[0]

ACLED_DATA = _find_acled()

# ---------------------------------------------------------------------------
# Simple module-level cache (replaces @st.cache_data)
# ---------------------------------------------------------------------------
_cache: dict = {}
_CACHE_TTL = 3600  # seconds


def _get_cached(key: str):
    if key in _cache:
        data, ts = _cache[key]
        if time.time() - ts < _CACHE_TTL:
            return data
    return None


def _set_cached(key: str, data):
    _cache[key] = (data, time.time())


def _cache_key(*args) -> str:
    return hashlib.md5(str(args).encode()).hexdigest()


def _save_pickle(key: str, data):
    try:
        with open(CACHE_DIR / f"{key}.pkl", "wb") as f:
            pickle.dump(data, f)
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


# ---------------------------------------------------------------------------
# Data loading
# ---------------------------------------------------------------------------

def load_conflict_data() -> pd.DataFrame:
    """Load and cache ACLED + ward conflict data."""
    key = _cache_key("conflict_data", "v5")
    cached = _get_cached(key)
    if cached is not None:
        return cached

    pkl = _load_pickle(key)
    if pkl is not None:
        _set_cached(key, pkl)
        return pkl

    if not ACLED_DATA.exists():
        raise FileNotFoundError(f"ACLED data not found at {ACLED_DATA}")

    nigeria_acled = pd.read_csv(ACLED_DATA)
    nigeria_acled['event_date'] = pd.to_datetime(nigeria_acled['event_date'])
    nigeria_acled['month'] = nigeria_acled['event_date'].dt.month
    nigeria_acled['year'] = nigeria_acled['event_date'].dt.year

    # Filter to lethal non-protest events
    brd = nigeria_acled[
        (~nigeria_acled['event_type'].isin(['Protests', 'Riots'])) &
        (nigeria_acled['fatalities'] > 0)
    ].copy()

    def _cat_violence(interaction):
        if pd.isna(interaction):
            return 'unknown', 'unknown'
        s = str(interaction).lower()
        if 'state forces' in s:
            return 'state', 'state'
        return 'nonstate', 'nonstate'

    brd[['violence_type', 'actor_type']] = brd['interaction'].apply(
        lambda x: pd.Series(_cat_violence(x))
    )

    def _build_lga_supplement(brd_df: pd.DataFrame) -> pd.DataFrame:
        """Aggregate raw ACLED to LGA level (used when ward geocoding is unavailable)."""
        agg = brd_df.groupby(['year', 'month', 'admin1', 'admin2', 'violence_type'],
                              as_index=False).agg({'fatalities': 'sum'})
        pivot = agg.pivot_table(
            index=['year', 'month', 'admin1', 'admin2'],
            columns='violence_type',
            values='fatalities',
            fill_value=0,
        ).reset_index()
        pivot.columns.name = None
        pivot['ACLED_BRD_state'] = pivot.get('state', pd.Series(0, index=pivot.index))
        pivot['ACLED_BRD_nonstate'] = pivot.get('nonstate', pd.Series(0, index=pivot.index))
        pivot['ACLED_BRD_total'] = pivot['ACLED_BRD_state'] + pivot['ACLED_BRD_nonstate']
        pivot['ADM1_PCODE'] = pivot['admin1'].astype(str)
        pivot['ADM2_PCODE'] = pivot['admin2'].astype(str)
        sup = pivot.rename(columns={'admin1': 'ADM1_EN', 'admin2': 'ADM2_EN'})
        sup['ADM3_PCODE'] = ''
        sup['ADM3_EN'] = ''
        return sup

    ward_file = PROCESSED_DIR / "ward_conflict_data.csv"
    if ward_file.exists():
        conflict = pd.read_csv(ward_file)
        conflict = conflict.rename(columns={
            'wardcode': 'ADM3_PCODE',
            'wardname': 'ADM3_EN',
            'lganame': 'ADM2_EN',
            'statename': 'ADM1_EN',
        })
        conflict['ADM1_PCODE'] = conflict['ADM1_EN'].astype(str)
        conflict['ADM2_PCODE'] = conflict['ADM2_EN'].astype(str)

        # Supplement with raw ACLED for any months beyond the ward file's coverage
        if 'year' in conflict.columns and 'month' in conflict.columns:
            max_ward_year = int(conflict['year'].max())
            max_ward_month = int(conflict.loc[conflict['year'] == max_ward_year, 'month'].max())
            # months strictly after the ward file's last month
            later = brd[
                (brd['year'] > max_ward_year) |
                ((brd['year'] == max_ward_year) & (brd['month'] > max_ward_month))
            ]
            if not later.empty:
                conflict = pd.concat([conflict, _build_lga_supplement(later)], ignore_index=True)
    else:
        conflict = _build_lga_supplement(brd)

    if 'ACLED_BRD_total' not in conflict.columns:
        conflict['ACLED_BRD_total'] = 0
    conflict = conflict[conflict['ACLED_BRD_total'] > 0]

    _set_cached(key, conflict)
    _save_pickle(key, conflict)
    return conflict


def load_raw_acled() -> pd.DataFrame:
    """Load raw ACLED events (all types, all fatality values)."""
    key = _cache_key("raw_acled", "v2")
    cached = _get_cached(key)
    if cached is not None:
        return cached

    df = pd.read_csv(ACLED_DATA)
    df['event_date'] = pd.to_datetime(df['event_date'])
    df['month'] = df['event_date'].dt.month
    df['year'] = df['event_date'].dt.year
    _set_cached(key, df)
    return df


def load_population_data() -> pd.DataFrame:
    """Load ward-level population data."""
    key = _cache_key("population", "v4")
    cached = _get_cached(key)
    if cached is not None:
        return cached

    pkl = _load_pickle(key)
    if pkl is not None:
        _set_cached(key, pkl)
        return pkl

    ward_file = DATA_DIR / "wards" / "wards.shp"
    if not ward_file.exists():
        return pd.DataFrame(columns=['ADM3_PCODE', 'ADM1_PCODE', 'ADM2_PCODE',
                                     'ADM3_EN', 'ADM0_PCODE', 'ADM1_EN', 'ADM2_EN',
                                     'pop_count', 'pop_count_millions'])

    ward_gdf = gpd.read_file(ward_file)
    result = pd.DataFrame({
        'ADM3_PCODE': ward_gdf['ward_cd'],
        'ADM1_PCODE': ward_gdf['stat_cd'],
        'ADM2_PCODE': ward_gdf['lga_cod'],
        'ADM3_EN': ward_gdf['wrd_nm_x'],
        'ADM0_PCODE': 'NGA',
        'pop_count': ward_gdf['total_pop'].fillna(0).astype(int),
        'pop_count_millions': ward_gdf['total_pop'].fillna(0) / 1e6,
    })

    lga_file = DATA_DIR / "nga_lga_boundaries.geojson"
    if lga_file.exists():
        lga_gdf = gpd.read_file(lga_file)
        state_map = dict(zip(lga_gdf['statecode'], lga_gdf['statename']))
        lga_map = dict(zip(lga_gdf['lgacode'], lga_gdf['lganame']))
        result['ADM1_EN'] = result['ADM1_PCODE'].map(state_map).fillna(result['ADM1_PCODE'])
        result['ADM2_EN'] = result['ADM2_PCODE'].map(lga_map).fillna(result['ADM2_PCODE'])
    else:
        result['ADM1_EN'] = result['ADM1_PCODE']
        result['ADM2_EN'] = result['ADM2_PCODE']

    _set_cached(key, result)
    _save_pickle(key, result)
    return result


def create_admin_levels(pop_data: pd.DataFrame) -> dict:
    """Aggregate population to admin levels 1 and 2."""
    if pop_data.empty:
        return {'admin1': pd.DataFrame(), 'admin2': pd.DataFrame(), 'admin3': pop_data}

    admin2 = pop_data.groupby(
        ['ADM2_PCODE', 'ADM2_EN', 'ADM1_PCODE', 'ADM1_EN', 'ADM0_PCODE'],
        as_index=False,
    ).agg({'pop_count': 'sum', 'pop_count_millions': 'sum'})

    admin1 = pop_data.groupby(
        ['ADM1_PCODE', 'ADM1_EN', 'ADM0_PCODE'], as_index=False
    ).agg({'pop_count': 'sum', 'pop_count_millions': 'sum'})

    return {'admin1': admin1, 'admin2': admin2, 'admin3': pop_data}


def filter_data_by_period(data: pd.DataFrame, start_year: int, start_month: int,
                          end_year: int, end_month: int) -> pd.DataFrame:
    """Filter conflict data to a date range."""
    if data.empty:
        return data

    if start_year == end_year:
        mask = (
            (data['year'] == start_year) &
            (data['month'] >= start_month) &
            (data['month'] <= end_month)
        )
    else:
        mask = (
            ((data['year'] == start_year) & (data['month'] >= start_month)) |
            ((data['year'] > start_year) & (data['year'] < end_year)) |
            ((data['year'] == end_year) & (data['month'] <= end_month))
        )
    return data[mask]


def classify_and_aggregate(
    pop_data: pd.DataFrame,
    conflict_data: pd.DataFrame,
    start_year: int,
    start_month: int,
    end_year: int,
    end_month: int,
    rate_thresh: float = 10.0,
    abs_thresh: int = 5,
    agg_thresh: float = 0.1,
    agg_level: str = 'ADM1',
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Classify wards and aggregate to admin level."""
    period_conflict = filter_data_by_period(conflict_data, start_year, start_month, end_year, end_month)

    # Rows with real ward PCODEs (geocoded from pre-processed file)
    # vs LGA-level rows (supplement from raw ACLED, ADM3_PCODE = '')
    has_ward_codes = (
        len(period_conflict) > 0
        and 'ADM3_PCODE' in period_conflict.columns
        and (period_conflict['ADM3_PCODE'].notna() & (period_conflict['ADM3_PCODE'] != '')).any()
    )
    if has_ward_codes:
        ward_rows = period_conflict[
            period_conflict['ADM3_PCODE'].notna() & (period_conflict['ADM3_PCODE'] != '')
        ]
        conflict_ward = ward_rows.groupby('ADM3_PCODE', as_index=False).agg({
            'ACLED_BRD_state': 'sum',
            'ACLED_BRD_nonstate': 'sum',
            'ACLED_BRD_total': 'sum',
        })
        merged = pd.merge(pop_data, conflict_ward, on='ADM3_PCODE', how='left')
        for col in ['ACLED_BRD_state', 'ACLED_BRD_nonstate', 'ACLED_BRD_total']:
            merged[col] = merged[col].fillna(0)
    else:
        merged = pop_data.copy()
        merged['ACLED_BRD_state'] = 0
        merged['ACLED_BRD_nonstate'] = 0
        merged['ACLED_BRD_total'] = 0

    merged['acled_total_death_rate'] = np.where(
        merged['pop_count_millions'] * 1e6 > 0,
        merged['ACLED_BRD_total'] / (merged['pop_count_millions'] * 1e6) * 1e5,
        0,
    )
    merged['violence_affected'] = (
        (merged['acled_total_death_rate'] > rate_thresh) &
        (merged['ACLED_BRD_total'] > abs_thresh)
    )

    group_cols = ['ADM1_PCODE', 'ADM1_EN'] if agg_level == 'ADM1' else [
        'ADM2_PCODE', 'ADM2_EN', 'ADM1_PCODE', 'ADM1_EN'
    ]
    agg = merged.groupby(group_cols, as_index=False).agg({
        'pop_count': 'sum',
        'violence_affected': 'sum',
        'ADM3_PCODE': 'count',
        'ACLED_BRD_total': 'sum',
    })
    agg.rename(columns={'ADM3_PCODE': 'total_wards'}, inplace=True)
    agg['share_wards_affected'] = agg['violence_affected'] / agg['total_wards']

    affected_pop = merged[merged['violence_affected']].groupby(
        group_cols[0], as_index=False
    )['pop_count'].sum().rename(columns={'pop_count': 'affected_population'})
    agg = pd.merge(agg, affected_pop, on=group_cols[0], how='left')
    agg['affected_population'] = agg['affected_population'].fillna(0)
    agg['share_population_affected'] = agg['affected_population'] / agg['pop_count']
    agg['above_threshold'] = agg['share_wards_affected'] > agg_thresh

    # Supplement state/LGA deaths from raw-ACLED rows (no ward geocoding, ADM3_PCODE == '')
    # These cover months beyond the ward_conflict_data.csv cutoff date.
    if 'ADM3_PCODE' in period_conflict.columns:
        lga_rows = period_conflict[period_conflict['ADM3_PCODE'].fillna('') == '']
    else:
        lga_rows = pd.DataFrame()
    if not lga_rows.empty and 'ACLED_BRD_total' in lga_rows.columns:
        join_col = 'ADM1_EN' if agg_level == 'ADM1' else 'ADM2_EN'
        if join_col in lga_rows.columns:
            sup = lga_rows.groupby(join_col, as_index=False)['ACLED_BRD_total'].sum()
            sup.rename(columns={'ACLED_BRD_total': '_sup_deaths'}, inplace=True)
            agg = agg.merge(sup, on=join_col, how='left')
            agg['ACLED_BRD_total'] += agg['_sup_deaths'].fillna(0)
            agg.drop(columns=['_sup_deaths'], inplace=True)

    return agg, merged


def get_summary_kpis(start_date: str | None = None, end_date: str | None = None) -> dict:
    """Return top-level KPIs."""
    raw = load_raw_acled()
    if start_date:
        raw = raw[raw['event_date'] >= pd.to_datetime(start_date)]
    if end_date:
        raw = raw[raw['event_date'] <= pd.to_datetime(end_date)]

    pop = load_population_data()
    conflict = load_conflict_data()

    total_wards = len(pop)
    wards_with_events = conflict['ADM3_PCODE'].nunique() if 'ADM3_PCODE' in conflict.columns else 0

    return {
        'total_events': int(len(raw)),
        'total_deaths': int(raw['fatalities'].sum()),
        'wards_affected': int(wards_with_events),
        'total_wards': int(total_wards),
        'last_update': raw['event_date'].max().isoformat() if not raw.empty else None,
        'data_start': raw['event_date'].min().isoformat() if not raw.empty else None,
    }


def get_timeseries(
    frequency: str = 'monthly',
    dimension: str = 'event_type',
    start_date: str | None = None,
    end_date: str | None = None,
    states: list[str] | None = None,
    event_types: list[str] | None = None,
) -> list[dict]:
    """Return time series aggregated by frequency and dimension."""
    df = load_raw_acled()

    if start_date:
        df = df[df['event_date'] >= pd.to_datetime(start_date)]
    if end_date:
        df = df[df['event_date'] <= pd.to_datetime(end_date)]
    if states:
        df = df[df['admin1'].isin(states)]
    if event_types:
        df = df[df['event_type'].isin(event_types)]

    if frequency == 'yearly':
        df['period'] = df['event_date'].dt.to_period('Y').astype(str)
    elif frequency == 'quarterly':
        df['period'] = df['event_date'].dt.to_period('Q').astype(str)
    else:
        df['period'] = df['event_date'].dt.to_period('M').astype(str)

    group_col = {
        'event_type': 'event_type',
        'sub_event_type': 'sub_event_type',
        'actor': 'actor1',
    }.get(dimension, 'event_type')

    agg = df.groupby(['period', group_col]).agg(
        events=('event_id_cnty', 'count'),
        deaths=('fatalities', 'sum'),
    ).reset_index()
    agg.rename(columns={group_col: 'dimension'}, inplace=True)
    return agg.to_dict(orient='records')


def get_by_admin(
    level: int = 1,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict]:
    """Return deaths/events aggregated by admin level."""
    df = load_raw_acled()
    if start_date:
        df = df[df['event_date'] >= pd.to_datetime(start_date)]
    if end_date:
        df = df[df['event_date'] <= pd.to_datetime(end_date)]

    if level == 1:
        group_cols = ['admin1']
        name_col = 'admin1'
    elif level == 2:
        group_cols = ['admin1', 'admin2']
        name_col = 'admin2'
    else:
        group_cols = ['admin1', 'admin2', 'admin3']
        name_col = 'admin3'

    agg = df.groupby(group_cols).agg(
        events=('event_id_cnty', 'count'),
        deaths=('fatalities', 'sum'),
    ).reset_index()
    return agg.to_dict(orient='records')


def get_filtered_events(
    start_date: str | None = None,
    end_date: str | None = None,
    states: list[str] | None = None,
    event_types: list[str] | None = None,
    limit: int = 1000,
) -> list[dict]:
    """Return filtered raw events."""
    df = load_raw_acled()
    if start_date:
        df = df[df['event_date'] >= pd.to_datetime(start_date)]
    if end_date:
        df = df[df['event_date'] <= pd.to_datetime(end_date)]
    if states:
        df = df[df['admin1'].isin(states)]
    if event_types:
        df = df[df['event_type'].isin(event_types)]
    df = df.sort_values('event_date', ascending=False).head(limit)
    df['event_date'] = df['event_date'].dt.isoformat() if hasattr(df['event_date'].dt, 'isoformat') else df['event_date'].astype(str)
    return df.to_dict(orient='records')


def get_actors(
    start_date: str | None = None,
    end_date: str | None = None,
    top_n: int = 20,
    event_types: list[str] | None = None,
    actor_types: list[str] | None = None,
) -> list[dict]:
    """Return top actors by fatalities."""
    df = load_raw_acled()
    if start_date:
        df = df[df['event_date'] >= pd.to_datetime(start_date)]
    if end_date:
        df = df[df['event_date'] <= pd.to_datetime(end_date)]
    if event_types:
        df = df[df['event_type'].isin(event_types)]

    # Filter each side independently by its own inter column
    df_a1 = df[df['inter1'].isin(actor_types)] if actor_types else df
    df_a2 = df[df['inter2'].isin(actor_types)] if actor_types else df

    a1 = df_a1.groupby('actor1').agg(
        events=('event_id_cnty', 'count'),
        deaths=('fatalities', 'sum'),
    ).reset_index().rename(columns={'actor1': 'actor'})

    a2 = df_a2.groupby('actor2').agg(
        events=('event_id_cnty', 'count'),
        deaths=('fatalities', 'sum'),
    ).reset_index().rename(columns={'actor2': 'actor'})

    combined = pd.concat([a1, a2]).groupby('actor').agg(
        events=('events', 'sum'),
        deaths=('deaths', 'sum'),
    ).reset_index()
    combined = combined[combined['actor'].notna() & (combined['actor'] != 'NA')]
    combined = combined.sort_values('deaths', ascending=False).head(top_n)
    return combined.to_dict(orient='records')
