import type {
  SummaryKPIs,
  AlertStatus,
  AlertsSummary,
  ConflictIndex,
  ChangeDetection,
  TimeseriesPoint,
  AdminConflict,
  ConflictEvent,
  Actor,
  AbsoluteSeriesResponse,
  LocationTrendResponse,
  PeriodPreset,
} from './types';
import { apiUrl } from './apiBase';

function toUrlObject(path: string): URL {
  const resolved = apiUrl(path);
  if (resolved.startsWith('http://') || resolved.startsWith('https://')) {
    return new URL(resolved);
  }
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  return new URL(resolved, origin);
}

async function apiFetch<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = toUrlObject(path);
  if (params) {
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== null) url.searchParams.set(k, String(v));
    });
  }
  const res = await fetch(url.toString(), { next: { revalidate: 300 } });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`API error ${res.status}: ${err}`);
  }
  return res.json();
}

export const api = {
  summary: (params?: { start_date?: string; end_date?: string }) =>
    apiFetch<SummaryKPIs>('/api/summary', params),

  alertStatus: (params?: {
    ci_red?: number;
    ci_amber?: number;
    mom_red?: number;
    mom_amber?: number;
  }) => apiFetch<AlertStatus[]>('/api/alerts/status', params),

  alertsSummary: () => apiFetch<AlertsSummary>('/api/alerts/summary'),

  conflictIndex: (reference_days?: number) =>
    apiFetch<ConflictIndex[]>('/api/alerts/conflict-index', { reference_days }),

  changes: (comparison_days?: number) =>
    apiFetch<ChangeDetection[]>('/api/alerts/changes', { comparison_days }),

  timeseries: (params: {
    frequency?: string;
    dimension?: string;
    start?: string;
    end?: string;
    states?: string;
    event_type?: string;
  }) => apiFetch<TimeseriesPoint[]>('/api/conflicts/timeseries', params),

  byAdmin: (params: { level?: number; start?: string; end?: string; parent?: string }) =>
    apiFetch<AdminConflict[]>('/api/conflicts/by-admin', params),

  conflicts: (params: {
    start?: string;
    end?: string;
    states?: string;
    event_type?: string;
    limit?: number;
  }) => apiFetch<ConflictEvent[]>('/api/conflicts', params),

  actors: (params?: { start?: string; end?: string; top_n?: number; event_types?: string; actor_types?: string }) =>
    apiFetch<Actor[]>('/api/actors', params),

  actorTimeline: (actorName: string, frequency?: string, event_types?: string) =>
    apiFetch<{ period: string; events: number; deaths: number }[]>(
      `/api/actors/${encodeURIComponent(actorName)}/timeline`,
      { frequency, event_types },
    ),

  actorGeography: (actorName: string, event_types?: string) =>
    apiFetch<{ admin1: string; admin2: string; events: number; deaths: number }[]>(
      `/api/actors/${encodeURIComponent(actorName)}/geography`,
      { event_types },
    ),

  actorProfile: (actorName: string) =>
    apiFetch<{ profile: string; generated_at: string; event_count: number }>(
      `/api/actors/${encodeURIComponent(actorName)}/profile`,
    ),

  choropleth: (params: {
    level?: number;
    variable?: string;
    start_year?: number;
    start_month?: number;
    end_year?: number;
    end_month?: number;
  }) => apiFetch<object>('/api/spatial/choropleth', params),

  boundaries: (level: number) =>
    apiFetch<object>(`/api/spatial/boundaries/${level}`),

  periods: () =>
    apiFetch<{ periods: PeriodPreset[] }>('/api/meta/periods'),

  spatialClassification: (params: {
    period_id: string;
    map_view?: 'regions_zones' | 'woredas';
    agg_level?: 'ADM1' | 'ADM2' | 'ADM3';
    analysis_type?: 'conflict_metrics' | 'trajectory';
    map_var?: 'share_woredas' | 'share_population';
    conflict_metric?: 'conflict_affected' | 'highly_conflict_affected';
    agg_thresh?: number;
    trajectory_categories?: string;
  }) => apiFetch<object>('/api/spatial/classification', params),

  trendsLocation: (params: {
    pcode: string;
    level?: 'ADM1' | 'ADM2' | 'ADM3' | 'region' | 'zone' | 'woreda';
    lookback_periods?: number;
  }) => apiFetch<LocationTrendResponse>('/api/trends/location', params),

  absoluteSeries: (params: {
    pcodes: string;
    level?: 'ADM1' | 'ADM2' | 'ADM3' | 'region' | 'zone' | 'woreda';
    granularity?: 'monthly' | 'quarterly' | 'yearly';
    start_year?: number;
    start_month?: number;
    end_year?: number;
    end_month?: number;
  }) => apiFetch<AbsoluteSeriesResponse>('/api/absolute/series', params),

  unitSummary: (params: {
    level: number;
    name: string;
    start_year?: number;
    start_month?: number;
    end_year?: number;
    end_month?: number;
  }) =>
    apiFetch<{ summary: string; generated_at: string; event_count: number }>(
      '/api/spatial/unit-summary',
      params,
    ),

  exportCsvUrl: (params: Record<string, string | undefined>) => {
    const url = toUrlObject('/api/export/csv');
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
    return url.toString();
  },

  exportExcelUrl: (params: Record<string, string | undefined>) => {
    const url = toUrlObject('/api/export/excel');
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
    return url.toString();
  },
};
