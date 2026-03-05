"""AI-powered narrative summaries using Claude."""

import os
import datetime
import calendar
from typing import Optional

import pandas as pd
import anthropic

from services.conflict_service import load_raw_acled, _get_cached, _set_cached, _cache_key

SUMMARY_TTL = 3600  # 1 hour


def get_unit_summary(
    level: int,
    name: str,
    start_year: Optional[int] = None,
    start_month: Optional[int] = None,
    end_year: Optional[int] = None,
    end_month: Optional[int] = None,
) -> dict:
    """
    Generate an AI narrative summary for a region or zone.
    Returns {"summary": str, "generated_at": str, "event_count": int}.
    Only works for level 1 (region) or level 2 (zone).
    """
    now = datetime.datetime.now()
    if end_year is None:    end_year = now.year
    if end_month is None:   end_month = now.month
    if start_year is None:  start_year = end_year - 1
    if start_month is None: start_month = 1

    # Cache key includes all filter params
    key = _cache_key("ai_summary", f"L{level}_{name}_{start_year}{start_month:02d}_{end_year}{end_month:02d}")
    cached = _get_cached(key)
    if cached is not None:
        return cached

    # Filter raw ACLED to this unit + date range
    df = load_raw_acled()
    start_date = datetime.date(start_year, start_month, 1)
    end_date = datetime.date(end_year, end_month, calendar.monthrange(end_year, end_month)[1])
    df = df[df['event_date'].dt.date >= start_date]
    df = df[df['event_date'].dt.date <= end_date]

    if level == 1:
        df = df[df['admin1'] == name]
    elif level == 2:
        df = df[df['admin2'] == name]
    else:
        return {
            "summary": "AI summaries are available for region and zone levels only.",
            "generated_at": now.isoformat(),
            "event_count": 0,
        }

    if df.empty:
        return {
            "summary": "No events found for this location in the selected period.",
            "generated_at": now.isoformat(),
            "event_count": 0,
        }

    total_deaths = int(df['fatalities'].sum())
    total_events = int(len(df))
    date_range = f"{start_year}-{start_month:02d} to {end_year}-{end_month:02d}"

    # Event type breakdown
    by_type = (
        df.groupby('event_type')
        .agg(deaths=('fatalities', 'sum'), events=('event_id_cnty', 'count'))
        .sort_values('deaths', ascending=False)
    )
    type_lines = "\n".join(
        f"  - {row.name}: {int(row['deaths'])} deaths, {int(row['events'])} events"
        for _, row in by_type.iterrows()
    )

    # Top actors by fatalities (combined actor1 + actor2)
    a1 = (
        df.groupby('actor1')['fatalities'].sum()
        .reset_index()
        .rename(columns={'actor1': 'actor', 'fatalities': 'deaths'})
    )
    a2 = (
        df.groupby('actor2')['fatalities'].sum()
        .reset_index()
        .rename(columns={'actor2': 'actor', 'fatalities': 'deaths'})
    )
    top_actors = (
        pd.concat([a1, a2])
        .groupby('actor')['deaths']
        .sum()
        .reset_index()
        .sort_values('deaths', ascending=False)
        .head(5)
    )
    top_actors = top_actors[
        top_actors['actor'].notna()
        & (top_actors['actor'] != '')
        & (top_actors['actor'] != 'NA')
    ]
    actor_lines = "\n".join(
        f"  - {row['actor']}: {int(row['deaths'])} deaths"
        for _, row in top_actors.iterrows()
    )

    # Top events with notes (most lethal, up to 30)
    events_with_notes = df[df['notes'].notna() & (df['notes'] != '')].copy()
    events_with_notes = events_with_notes.nlargest(30, 'fatalities')
    event_lines = []
    for _, ev in events_with_notes.iterrows():
        date_str = ev['event_date'].strftime('%Y-%m-%d') if pd.notna(ev.get('event_date')) else ''
        notes_raw = str(ev.get('notes', ''))
        notes = notes_raw[:300] + ('…' if len(notes_raw) > 300 else '')
        event_lines.append(
            f"[{date_str} | {ev.get('event_type', '')} | {ev.get('actor1', '')} vs "
            f"{ev.get('actor2', '')} | {ev.get('location', '')} | "
            f"{int(ev.get('fatalities', 0))} fatalities]\n  Notes: \"{notes}\""
        )
    events_block = (
        "\n\n".join(event_lines) if event_lines else "No detailed event notes available."
    )

    level_label = "region" if level == 1 else "zone"
    prompt = f"""You are an FCV (Fragility, Conflict, and Violence) specialist on the Ethiopia country team preparing an intelligence brief for internal operational use.
Analyze the following ACLED conflict data for {name} ({level_label}), Ethiopia.

PERIOD: {date_range}
TOTAL DEATHS: {total_deaths}
TOTAL EVENTS: {total_events}

EVENT TYPE BREAKDOWN:
{type_lines}

TOP ARMED ACTORS (by fatalities):
{actor_lines}

NOTABLE EVENTS (most lethal, with source descriptions):
{events_block}

Write a concise intelligence brief (5–7 sentences) covering:
1. The dominant conflict dynamics and patterns
2. Key armed actors and their roles
3. Most affected areas and civilian impact within {name}
4. Any notable trends, escalation signals, or changes visible in this data

Be specific, factual, and objective. Reference concrete figures and actor names from the data."""

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key or api_key == "your-key-here":
        return {
            "summary": "AI summary unavailable: ANTHROPIC_API_KEY not configured.",
            "generated_at": now.isoformat(),
            "event_count": total_events,
        }

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=512,
        messages=[{"role": "user", "content": prompt}],
    )
    summary_text = message.content[0].text.strip()

    result = {
        "summary": summary_text,
        "generated_at": now.isoformat(),
        "event_count": total_events,
    }
    _set_cached(key, result)
    return result


def get_actor_profile(actor_name: str) -> dict:
    """
    Generate an AI intelligence profile for an armed actor based on their full ACLED history.
    Returns {"profile": str, "generated_at": str, "event_count": int}.
    """
    now = datetime.datetime.now()

    key = _cache_key("actor_profile", actor_name)
    cached = _get_cached(key)
    if cached is not None:
        return cached

    df = load_raw_acled()
    actor_df = df[(df['actor1'] == actor_name) | (df['actor2'] == actor_name)].copy()

    if actor_df.empty:
        return {
            "profile": "No events found for this actor in the dataset.",
            "generated_at": now.isoformat(),
            "event_count": 0,
        }

    total_events = int(len(actor_df))
    total_deaths = int(actor_df['fatalities'].sum())
    min_date = actor_df['event_date'].min().strftime('%Y-%m-%d')
    max_date = actor_df['event_date'].max().strftime('%Y-%m-%d')

    # Event type breakdown
    by_type = (
        actor_df.groupby('event_type')
        .agg(deaths=('fatalities', 'sum'), events=('event_id_cnty', 'count'))
        .sort_values('deaths', ascending=False)
    )
    type_lines = "\n".join(
        f"  - {row.name}: {int(row['deaths'])} deaths, {int(row['events'])} events"
        for _, row in by_type.iterrows()
    )

    # Top operational areas
    by_location = (
        actor_df.groupby(['admin1', 'admin2'])
        .agg(events=('event_id_cnty', 'count'), deaths=('fatalities', 'sum'))
        .reset_index()
        .sort_values('deaths', ascending=False)
        .head(8)
    )
    loc_lines = "\n".join(
        f"  - {row['admin2']}, {row['admin1']}: {int(row['deaths'])} deaths, {int(row['events'])} events"
        for _, row in by_location.iterrows()
    )

    # Key counterparties
    a1_rows = actor_df[actor_df['actor1'] == actor_name]
    a2_rows = actor_df[actor_df['actor2'] == actor_name]
    opp_frames = []
    if not a1_rows.empty:
        opp_frames.append(
            a1_rows.groupby('actor2')['fatalities'].sum()
            .reset_index().rename(columns={'actor2': 'opponent', 'fatalities': 'deaths'})
        )
    if not a2_rows.empty:
        opp_frames.append(
            a2_rows.groupby('actor1')['fatalities'].sum()
            .reset_index().rename(columns={'actor1': 'opponent', 'fatalities': 'deaths'})
        )
    if opp_frames:
        opponents = (
            pd.concat(opp_frames)
            .groupby('opponent')['deaths'].sum()
            .reset_index()
            .sort_values('deaths', ascending=False)
        )
        opponents = opponents[
            opponents['opponent'].notna()
            & (opponents['opponent'] != '')
            & (opponents['opponent'] != 'NA')
            & (opponents['opponent'] != actor_name)
        ].head(6)
        opp_lines = "\n".join(
            f"  - {row['opponent']}: {int(row['deaths'])} deaths in shared events"
            for _, row in opponents.iterrows()
        )
    else:
        opp_lines = "No counterparty data available."

    # Notable incidents — most lethal events with notes
    events_with_notes = actor_df[actor_df['notes'].notna() & (actor_df['notes'] != '')].copy()
    events_with_notes = events_with_notes.nlargest(30, 'fatalities')
    event_lines = []
    for _, ev in events_with_notes.iterrows():
        date_str = ev['event_date'].strftime('%Y-%m-%d') if pd.notna(ev.get('event_date')) else ''
        notes_raw = str(ev.get('notes', ''))
        notes = notes_raw[:300] + ('…' if len(notes_raw) > 300 else '')
        opponent = ev.get('actor2', '') if ev.get('actor1', '') == actor_name else ev.get('actor1', '')
        event_lines.append(
            f"[{date_str} | {ev.get('event_type', '')} | vs {opponent} | "
            f"{ev.get('location', '')}, {ev.get('admin1', '')} | {int(ev.get('fatalities', 0))} fatalities]\n"
            f"  Notes: \"{notes}\""
        )
    events_block = "\n\n".join(event_lines) if event_lines else "No detailed event notes available."

    prompt = f"""You are an FCV (Fragility, Conflict, and Violence) specialist on the Ethiopia country team. Write a structured intelligence profile for the following armed actor in Ethiopia based on ACLED data, for internal operational use.

ACTOR: {actor_name}
RECORD PERIOD: {min_date} to {max_date}
TOTAL EVENTS: {total_events} | TOTAL DEATHS: {total_deaths}

EVENT TYPE BREAKDOWN:
{type_lines}

TOP OPERATIONAL AREAS (by fatalities):
{loc_lines}

KEY COUNTERPARTIES IN CONFLICT:
{opp_lines}

NOTABLE INCIDENTS (most lethal, with field notes):
{events_block}

Write a concise actor profile (5–8 sentences) covering:
1. Who this actor is and their role in Ethiopia's conflict landscape
2. Their main operational territories and geographic footprint
3. Dominant tactics and event types (battles, ambushes, civilian targeting, etc.)
4. Key adversaries and alliances visible in the data
5. Notable incidents or patterns from the field notes
6. Overall threat classification or strategic role

Be specific and factual. Reference concrete figures, locations, and dates. Use professional intelligence briefing style."""

    api_key = os.environ.get("ANTHROPIC_API_KEY")
    if not api_key or api_key == "your-key-here":
        return {
            "profile": "AI profile unavailable: ANTHROPIC_API_KEY not configured.",
            "generated_at": now.isoformat(),
            "event_count": total_events,
        }

    client = anthropic.Anthropic(api_key=api_key)
    message = client.messages.create(
        model="claude-sonnet-4-6",
        max_tokens=700,
        messages=[{"role": "user", "content": prompt}],
    )
    profile_text = message.content[0].text.strip()

    result = {
        "profile": profile_text,
        "generated_at": now.isoformat(),
        "event_count": total_events,
    }
    _set_cached(key, result)
    return result
