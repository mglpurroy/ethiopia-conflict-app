import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export function useTimeseries(params: {
  frequency?: string;
  dimension?: string;
  start?: string;
  end?: string;
  states?: string;
  event_type?: string;
}) {
  return useQuery({
    queryKey: ['timeseries', params],
    queryFn: () => api.timeseries(params),
    staleTime: 5 * 60 * 1000,
  });
}

export function useByAdmin(params: { level?: number; start?: string; end?: string; parent?: string }, options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: ['by-admin', params],
    queryFn: () => api.byAdmin(params),
    staleTime: 5 * 60 * 1000,
    enabled: options?.enabled ?? true,
  });
}

export function useConflicts(params: {
  start?: string;
  end?: string;
  states?: string;
  event_type?: string;
  limit?: number;
}) {
  return useQuery({
    queryKey: ['conflicts', params],
    queryFn: () => api.conflicts(params),
    staleTime: 5 * 60 * 1000,
  });
}

export function useActors(params?: { start?: string; end?: string; top_n?: number; event_types?: string; actor_types?: string }) {
  return useQuery({
    queryKey: ['actors', params],
    queryFn: () => api.actors(params),
    staleTime: 5 * 60 * 1000,
  });
}
