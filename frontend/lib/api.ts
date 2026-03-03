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
} from './types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

async function apiFetch<T>(path: string, params?: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
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

  wbProjects: (status?: string) =>
    apiFetch<object>('/api/wb-projects', status ? { status } : undefined),

  wbStateSummary: () =>
    apiFetch<Record<string, { active_count: number; total_commitment: number }>>('/api/wb-projects/state-summary'),

  wbProjectsByUnit: (level: number, name: string, status?: string) =>
    apiFetch<{
      proj_id: string;
      name: string;
      status: string;
      practice: string;
      approval_fy: number | null;
      commitment_amt: number | null;
      location_count: number;
      locations: string[];
      objective: string;
    }[]>('/api/wb-projects/by-unit', { level, name, status }),

  exportCsvUrl: (params: Record<string, string | undefined>) => {
    const url = new URL(`${BASE_URL}/api/export/csv`);
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
    return url.toString();
  },

  exportExcelUrl: (params: Record<string, string | undefined>) => {
    const url = new URL(`${BASE_URL}/api/export/excel`);
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
    });
    return url.toString();
  },
};
