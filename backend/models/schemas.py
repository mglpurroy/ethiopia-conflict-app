"""Pydantic response models for the Ethiopia Conflict API."""

from __future__ import annotations
from typing import Any, Optional
from pydantic import BaseModel


class SummaryResponse(BaseModel):
    total_events: int
    total_deaths: int
    wards_affected: int
    total_wards: int
    last_update: Optional[str]
    data_start: Optional[str]


class TimeseriesPoint(BaseModel):
    period: str
    dimension: str
    events: int
    deaths: int


class AdminConflict(BaseModel):
    admin1: str
    admin2: Optional[str] = None
    admin3: Optional[str] = None
    events: int
    deaths: int


class AlertStatus(BaseModel):
    state: str
    status: str  # red | amber | green
    conflict_index: float
    mom_deaths_pct_change: float
    is_significant_escalation: bool
    total_deaths_30d: int


class ConflictIndex(BaseModel):
    state: str
    conflict_index: float
    dim_deadliness: float
    dim_diffusion: float
    dim_civilian_danger: float
    dim_actor_fragmentation: float
    total_deaths: int
    total_events: int
    distinct_actors: int


class ChangeDetection(BaseModel):
    state: str
    deaths_current_30d: int
    events_current_30d: int
    deaths_prior_30d: int
    events_prior_30d: int
    mom_deaths_pct_change: float
    mom_events_change: int
    is_significant_escalation: bool


class Actor(BaseModel):
    actor: str
    events: int
    deaths: int


class AlertsSummary(BaseModel):
    states_red: int
    states_amber: int
    states_green: int
    states_escalating: int
    total_states: int
