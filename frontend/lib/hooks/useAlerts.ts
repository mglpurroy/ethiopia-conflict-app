import { useQuery } from '@tanstack/react-query';
import { api } from '../api';

export function useAlertStatus(params?: {
  ci_red?: number;
  ci_amber?: number;
  mom_red?: number;
  mom_amber?: number;
}) {
  return useQuery({
    queryKey: ['alert-status', params],
    queryFn: () => api.alertStatus(params),
    staleTime: 5 * 60 * 1000,
  });
}

export function useAlertsSummary() {
  return useQuery({
    queryKey: ['alerts-summary'],
    queryFn: () => api.alertsSummary(),
    staleTime: 5 * 60 * 1000,
  });
}

export function useConflictIndex(referenceDays?: number) {
  return useQuery({
    queryKey: ['conflict-index', referenceDays],
    queryFn: () => api.conflictIndex(referenceDays),
    staleTime: 5 * 60 * 1000,
  });
}

export function useChanges(comparisonDays?: number) {
  return useQuery({
    queryKey: ['changes', comparisonDays],
    queryFn: () => api.changes(comparisonDays),
    staleTime: 5 * 60 * 1000,
  });
}

export function useSummary(params?: { start_date?: string; end_date?: string }) {
  return useQuery({
    queryKey: ['summary', params],
    queryFn: () => api.summary(params),
    staleTime: 5 * 60 * 1000,
  });
}
