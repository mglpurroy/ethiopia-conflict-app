"""Early Warning & Alert service — new module implementing RAG + Conflict Index logic."""

import datetime
import numpy as np
import pandas as pd
from typing import Optional

from services.conflict_service import (
    load_raw_acled,
    load_population_data,
    _get_cached,
    _set_cached,
    _cache_key,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _latest_date(df: pd.DataFrame) -> datetime.date:
    """Use the most recent event_date in the dataset as the reference anchor."""
    return df['event_date'].max().date()


def _get_period(df: pd.DataFrame, days_ago_start: int, days_ago_end: int = 0) -> pd.DataFrame:
    anchor = _latest_date(df)
    end = anchor - datetime.timedelta(days=days_ago_end)
    start = anchor - datetime.timedelta(days=days_ago_start)
    return df[(df['event_date'].dt.date >= start) & (df['event_date'].dt.date <= end)]


def _state_population(pop: pd.DataFrame) -> dict[str, int]:
    agg = pop.groupby('ADM1_EN')['pop_count'].sum()
    return agg.to_dict()


# ---------------------------------------------------------------------------
# Conflict Index
# ---------------------------------------------------------------------------

def compute_conflict_index(reference_days: int = 365) -> list[dict]:
    """
    Compute per-state Conflict Index (0–10) based on 4 dimensions:
      1. Deadliness: deaths per 100k population
      2. Geographic diffusion: % woredas with any events
      3. Civilian danger: share of Violence against Civilians events
      4. Actor fragmentation: count of distinct actors
    """
    key = _cache_key("conflict_index", reference_days)
    cached = _get_cached(key)
    if cached is not None:
        return cached

    df = load_raw_acled()
    pop = load_population_data()
    state_pop = _state_population(pop)
    total_woredas_by_state = pop.groupby('ADM1_EN')['ADM3_PCODE'].count().to_dict()

    period_df = _get_period(df, reference_days)

    states = sorted(df['admin1'].dropna().unique())
    results = []

    for state in states:
        sdf = period_df[period_df['admin1'] == state]
        pop_count = state_pop.get(state, 1_000_000)
        total_woredas = total_woredas_by_state.get(state, 1)

        # 1. Deadliness (0–10): deaths per 100k, capped at 100
        deaths = float(sdf['fatalities'].sum())
        death_rate = (deaths / pop_count) * 100_000
        dim_deadliness = min(death_rate / 10.0, 10.0)

        # 2. Geographic diffusion (0–10): % woredas with events, scaled
        if 'admin3' in sdf.columns:
            woredas_with_events = sdf['admin3'].dropna().nunique()
        else:
            woredas_with_events = sdf['admin2'].dropna().nunique()
        pct_woredas = min(woredas_with_events / max(total_woredas, 1), 1.0)
        dim_diffusion = pct_woredas * 10.0

        # 3. Civilian danger (0–10): share of non-state violence
        total_events = len(sdf)
        nonstate_events = len(sdf[sdf['event_type'].isin([
            'Violence against civilians', 'Explosions/Remote violence'
        ])])
        pct_civilian = nonstate_events / max(total_events, 1)
        dim_civilian = pct_civilian * 10.0

        # 4. Actor fragmentation (0–10): distinct actors, capped at 20
        actors = pd.concat([
            sdf['actor1'].dropna(), sdf['actor2'].dropna()
        ]).nunique()
        dim_fragmentation = min(actors / 2.0, 10.0)

        score = (dim_deadliness + dim_diffusion + dim_civilian + dim_fragmentation) / 4.0

        results.append({
            'state': state,
            'conflict_index': round(score, 2),
            'dim_deadliness': round(dim_deadliness, 2),
            'dim_diffusion': round(dim_diffusion, 2),
            'dim_civilian_danger': round(dim_civilian, 2),
            'dim_actor_fragmentation': round(dim_fragmentation, 2),
            'total_deaths': int(deaths),
            'total_events': int(total_events),
            'distinct_actors': int(actors),
        })

    results.sort(key=lambda x: x['conflict_index'], reverse=True)
    _set_cached(key, results)
    return results


# ---------------------------------------------------------------------------
# RAG Status
# ---------------------------------------------------------------------------

def compute_rag_status(
    conflict_index_threshold_red: float = 6.0,
    conflict_index_threshold_amber: float = 3.0,
    mom_escalation_red: float = 0.5,
    mom_escalation_amber: float = 0.2,
) -> list[dict]:
    """
    Compute Red/Amber/Green status per state.
      Red:   Conflict Index > 6 OR MoM deaths change > +50%
      Amber: Conflict Index 3–6 OR MoM change > +20%
      Green: Conflict Index < 3 AND no escalation
    """
    key = _cache_key("rag_status", conflict_index_threshold_red, conflict_index_threshold_amber,
                     mom_escalation_red, mom_escalation_amber)
    cached = _get_cached(key)
    if cached is not None:
        return cached

    ci_list = compute_conflict_index()
    changes = compute_changes()
    changes_map = {c['state']: c for c in changes}
    ci_map = {c['state']: c for c in ci_list}

    results = []
    all_states = set(list(ci_map.keys()) + list(changes_map.keys()))

    for state in all_states:
        ci = ci_map.get(state, {}).get('conflict_index', 0.0)
        mom_change = changes_map.get(state, {}).get('mom_deaths_pct_change', 0.0)
        is_significant = changes_map.get(state, {}).get('is_significant_escalation', False)

        if ci > conflict_index_threshold_red or mom_change > mom_escalation_red:
            status = 'red'
        elif ci > conflict_index_threshold_amber or mom_change > mom_escalation_amber:
            status = 'amber'
        else:
            status = 'green'

        results.append({
            'state': state,
            'status': status,
            'conflict_index': round(ci, 2),
            'mom_deaths_pct_change': round(mom_change, 3),
            'is_significant_escalation': is_significant,
            'total_deaths_30d': changes_map.get(state, {}).get('deaths_current_30d', 0),
        })

    results.sort(key=lambda x: ('green', 'amber', 'red').index(x['status']), reverse=True)
    _set_cached(key, results)
    return results


# ---------------------------------------------------------------------------
# Change Detection (MoM, YoY)
# ---------------------------------------------------------------------------

def compute_changes(comparison_days: int = 30) -> list[dict]:
    """
    Compare last N days vs prior N days.
    Flag states with > 2 std deviations above 12-month baseline.
    """
    key = _cache_key("changes", comparison_days)
    cached = _get_cached(key)
    if cached is not None:
        return cached

    df = load_raw_acled()

    current = _get_period(df, comparison_days)
    prior = _get_period(df, comparison_days * 2, comparison_days)
    baseline = _get_period(df, 365)

    states = sorted(df['admin1'].dropna().unique())
    results = []

    # Baseline monthly stats per state for significance testing
    if not baseline.empty:
        baseline = baseline.copy()
        baseline['period'] = baseline['event_date'].dt.to_period('M')
        baseline_monthly = baseline.groupby(['admin1', 'period'])['fatalities'].sum().reset_index()
        baseline_stats = baseline_monthly.groupby('admin1')['fatalities'].agg(['mean', 'std']).reset_index()
        baseline_stats.columns = ['admin1', 'baseline_mean', 'baseline_std']
        baseline_std_map = dict(zip(baseline_stats['admin1'],
                                    zip(baseline_stats['baseline_mean'], baseline_stats['baseline_std'])))
    else:
        baseline_std_map = {}

    for state in states:
        curr_deaths = int(current[current['admin1'] == state]['fatalities'].sum())
        curr_events = int(len(current[current['admin1'] == state]))
        prior_deaths = int(prior[prior['admin1'] == state]['fatalities'].sum())
        prior_events = int(len(prior[prior['admin1'] == state]))

        if prior_deaths > 0:
            pct_change = (curr_deaths - prior_deaths) / prior_deaths
        elif curr_deaths > 0:
            pct_change = 1.0
        else:
            pct_change = 0.0

        # Significance: > 2 std above baseline monthly mean
        is_significant = False
        if state in baseline_std_map:
            b_mean, b_std = baseline_std_map[state]
            if b_std is not None and b_std > 0:
                monthly_current = curr_deaths / max(comparison_days / 30, 1)
                z_score = (monthly_current - b_mean) / b_std
                is_significant = z_score > 2.0

        results.append({
            'state': state,
            'deaths_current_30d': curr_deaths,
            'events_current_30d': curr_events,
            'deaths_prior_30d': prior_deaths,
            'events_prior_30d': prior_events,
            'mom_deaths_pct_change': round(pct_change, 4),
            'mom_events_change': curr_events - prior_events,
            'is_significant_escalation': is_significant,
        })

    results.sort(key=lambda x: x['mom_deaths_pct_change'], reverse=True)
    _set_cached(key, results)
    return results


def get_alerts_summary() -> dict:
    """Aggregated alert summary counts."""
    rag = compute_rag_status()
    red = sum(1 for r in rag if r['status'] == 'red')
    amber = sum(1 for r in rag if r['status'] == 'amber')
    green = sum(1 for r in rag if r['status'] == 'green')
    escalating = sum(1 for r in rag if r['is_significant_escalation'])
    return {
        'states_red': red,
        'states_amber': amber,
        'states_green': green,
        'states_escalating': escalating,
        'total_states': len(rag),
    }
