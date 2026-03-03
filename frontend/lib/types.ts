export interface SummaryKPIs {
  total_events: number;
  total_deaths: number;
  wards_affected: number;
  total_wards: number;
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

export type RagStatus = 'red' | 'amber' | 'green';

export interface EarlyWarningFilters {
  comparisonDays: 30 | 90 | 365;
  ciRedThreshold: number;
  ciAmberThreshold: number;
  momEscalationRed: number;
  momEscalationAmber: number;
}
