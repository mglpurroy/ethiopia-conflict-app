export interface SummaryKPIs {
  total_events: number;
  total_deaths: number;
  woredas_affected: number;
  total_woredas: number;
  last_update: string | null;
  data_start: string | null;
}

export interface AlertStatus {
  state: string;
  status: 'red' | 'amber' | 'green';
  conflict_index: number;
  mom_deaths_pct_change: number;
  is_significant_escalation: boolean;
  total_deaths_30d: number;
}

export interface AlertsSummary {
  states_red: number;
  states_amber: number;
  states_green: number;
  states_escalating: number;
  total_states: number;
}

export interface ConflictIndex {
  state: string;
  conflict_index: number;
  dim_deadliness: number;
  dim_diffusion: number;
  dim_civilian_danger: number;
  dim_actor_fragmentation: number;
  total_deaths: number;
  total_events: number;
  distinct_actors: number;
}

export interface ChangeDetection {
  state: string;
  deaths_current_30d: number;
  events_current_30d: number;
  deaths_prior_30d: number;
  events_prior_30d: number;
  mom_deaths_pct_change: number;
  mom_events_change: number;
  is_significant_escalation: boolean;
}

export interface TimeseriesPoint {
  period: string;
  dimension: string;
  events: number;
  deaths: number;
}

export interface AdminConflict {
  admin1: string;
  admin2?: string;
  admin3?: string;
  events: number;
  deaths: number;
}

export interface ConflictEvent {
  event_id_cnty: string;
  event_date: string;
  event_type: string;
  sub_event_type: string;
  actor1: string;
  actor2: string;
  admin1: string;
  admin2: string;
  admin3: string;
  location: string;
  latitude: number;
  longitude: number;
  fatalities: number;
  notes: string;
}

export interface Actor {
  actor: string;
  events: number;
  deaths: number;
}

export interface PeriodPreset {
  id: string;
  label: string;
  start_year: number;
  start_month: number;
  end_year: number;
  end_month: number;
  type: 'calendar' | 'mid_year' | 'rolling_latest';
  sort_index: number;
}

export interface LocationTrendPoint {
  period_id: string;
  period: string;
  period_type: string;
  start_year: number;
  start_month: number;
  deaths: number;
  events: number;
  death_rate: number;
  classification: 0 | 1 | 2;
  classification_label: string;
}

export interface LocationTrendResponse {
  location: {
    level: string;
    pcode: string;
    name: string;
    adm1_pcode: string;
    adm1_name: string;
    adm2_pcode: string;
    adm2_name: string;
  };
  trajectory: string;
  lookback_periods: number;
  latest: LocationTrendPoint | null;
  series: LocationTrendPoint[];
}

export interface AbsoluteSeriesPoint {
  period: string;
  deaths: number;
  events: number;
}

export interface AbsoluteLocationSeries {
  pcode: string;
  name: string;
  total_deaths: number;
  total_events: number;
  series: AbsoluteSeriesPoint[];
}

export interface AbsoluteSeriesResponse {
  level: 'ADM1' | 'ADM2' | 'ADM3';
  granularity: 'monthly' | 'quarterly' | 'yearly';
  period_start: string;
  period_end: string;
  periods: string[];
  locations: AbsoluteLocationSeries[];
}

export type RagStatus = 'red' | 'amber' | 'green';

export interface EarlyWarningFilters {
  comparisonDays: 30 | 90 | 365;
  ciRedThreshold: number;
  ciAmberThreshold: number;
  momEscalationRed: number;
  momEscalationAmber: number;
}
