'use client';

import { useState, useMemo } from 'react';
import { useAlertStatus, useChanges, useConflictIndex } from '@/lib/hooks/useAlerts';
import { RagBadge } from '@/components/ui/RagBadge';
import { TrendArrow } from '@/components/ui/TrendArrow';
import { KpiCard } from '@/components/ui/KpiCard';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { AlertTriangle, TrendingUp, Filter, SlidersHorizontal } from 'lucide-react';
import type { AlertStatus } from '@/lib/types';

type SortKey = 'conflict_index' | 'mom_deaths_pct_change' | 'total_deaths_30d' | 'state';
type SortDir = 'asc' | 'desc';
type Period = 30 | 90 | 365;

export default function EarlyWarningPage() {
  const [sortKey, setSortKey] = useState<SortKey>('conflict_index');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [comparisonDays, setComparisonDays] = useState<Period>(30);
  const [ciRedThreshold, setCiRedThreshold] = useState(6);
  const [ciAmberThreshold, setCiAmberThreshold] = useState(3);
  const [momRedThreshold, setMomRedThreshold] = useState(0.5);
  const [filterStatus, setFilterStatus] = useState<'all' | 'red' | 'amber' | 'green'>('all');

  const { data: alerts, isLoading } = useAlertStatus({
    ci_red: ciRedThreshold,
    ci_amber: ciAmberThreshold,
    mom_red: momRedThreshold,
    mom_amber: 0.2,
  });
  const { data: changes } = useChanges(comparisonDays);

  const changesMap = useMemo(() => {
    if (!changes) return {};
    return Object.fromEntries(changes.map((c) => [c.state, c]));
  }, [changes]);

  const sorted = useMemo(() => {
    if (!alerts) return [];
    let data = filterStatus === 'all' ? alerts : alerts.filter((a) => a.status === filterStatus);
    data = [...data].sort((a, b) => {
      let av: string | number = a[sortKey];
      let bv: string | number = b[sortKey];
      if (typeof av === 'string') return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av);
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number);
    });
    return data;
  }, [alerts, sortKey, sortDir, filterStatus]);

  const escalationChartData = useMemo(() => {
    if (!changes) return [];
    return changes
      .filter((c) => c.deaths_current_30d > 0 || c.deaths_prior_30d > 0)
      .sort((a, b) => b.deaths_current_30d - a.deaths_current_30d)
      .slice(0, 15)
      .map((c) => ({
        state: c.state.length > 12 ? c.state.slice(0, 12) + '…' : c.state,
        current: c.deaths_current_30d,
        prior: c.deaths_prior_30d,
      }));
  }, [changes]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSort(key, sortDir === 'asc' ? 'desc' : 'asc');
    else setSort(key, 'desc');
  };

  const setSort = (key: SortKey, dir: SortDir) => {
    setSortKey(key);
    setSortDir(dir);
  };

  const red = alerts?.filter((a) => a.status === 'red').length ?? 0;
  const amber = alerts?.filter((a) => a.status === 'amber').length ?? 0;
  const escalating = alerts?.filter((a) => a.is_significant_escalation).length ?? 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#667eea] to-[#764ba2] rounded-xl p-5 text-white">
        <h1 className="text-xl font-bold">Early Warning System</h1>
        <p className="text-white/80 text-sm mt-0.5">
          State-level alert status with configurable thresholds and change detection
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KpiCard title="States — Red Alert" value={red} variant="gradient" icon={<AlertTriangle className="h-6 w-6" />} />
        <KpiCard title="States — Elevated" value={amber} icon={<TrendingUp className="h-6 w-6" />} />
        <KpiCard title="Escalating" value={escalating} subtitle="statistically significant" />
        <KpiCard title="Comparison Period" value={`${comparisonDays}d`} subtitle="vs prior period" />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">
        {/* Threshold Settings Sidebar */}
        <div className="bg-white rounded-lg shadow-sm p-4 space-y-4">
          <div className="flex items-center gap-2 mb-2">
            <SlidersHorizontal className="h-4 w-4 text-[#667eea]" />
            <h3 className="font-semibold text-sm text-gray-900">Alert Thresholds</h3>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Comparison Period</label>
            <div className="flex gap-1">
              {([30, 90, 365] as Period[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setComparisonDays(d)}
                  className={`flex-1 text-xs py-1.5 rounded border transition-colors ${
                    comparisonDays === d
                      ? 'bg-[#667eea] text-white border-[#667eea]'
                      : 'border-gray-200 text-gray-600 hover:border-[#667eea]'
                  }`}
                >
                  {d}d
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Red — Conflict Index &gt; {ciRedThreshold}
            </label>
            <input
              type="range"
              min="3"
              max="9"
              step="0.5"
              value={ciRedThreshold}
              onChange={(e) => setCiRedThreshold(Number(e.target.value))}
              className="w-full accent-red-600"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Amber — Conflict Index &gt; {ciAmberThreshold}
            </label>
            <input
              type="range"
              min="1"
              max="6"
              step="0.5"
              value={ciAmberThreshold}
              onChange={(e) => setCiAmberThreshold(Number(e.target.value))}
              className="w-full accent-orange-500"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              MoM Escalation Red &gt; {(momRedThreshold * 100).toFixed(0)}%
            </label>
            <input
              type="range"
              min="0.1"
              max="1.0"
              step="0.05"
              value={momRedThreshold}
              onChange={(e) => setMomRedThreshold(Number(e.target.value))}
              className="w-full accent-red-600"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Filter by Status</label>
            <div className="space-y-1">
              {(['all', 'red', 'amber', 'green'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setFilterStatus(s)}
                  className={`w-full text-left text-xs py-1.5 px-2 rounded border capitalize transition-colors ${
                    filterStatus === s
                      ? 'bg-[#667eea] text-white border-[#667eea]'
                      : 'border-gray-200 text-gray-600 hover:border-[#667eea]'
                  }`}
                >
                  {s === 'all' ? 'All States' : `${s.charAt(0).toUpperCase() + s.slice(1)} Only`}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="xl:col-span-3 space-y-5">
          {/* State Alert Table */}
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b bg-gray-50 flex items-center justify-between">
              <h2 className="font-semibold text-sm text-gray-900">State Alert Table</h2>
              <span className="text-xs text-gray-500">{sorted.length} states</span>
            </div>
            {isLoading ? (
              <div className="p-8 text-center text-gray-400">Loading...</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b">
                    <tr>
                      {[
                        { key: 'state', label: 'State' },
                        { key: 'conflict_index', label: 'CI Score' },
                        { key: 'total_deaths_30d', label: `Deaths (${comparisonDays}d)` },
                        { key: 'mom_deaths_pct_change', label: 'MoM Change' },
                        { key: null, label: 'Status' },
                        { key: null, label: 'Escalating' },
                      ].map(({ key, label }) => (
                        <th
                          key={label}
                          onClick={() => key && handleSort(key as SortKey)}
                          className={`px-4 py-2.5 text-left font-semibold text-gray-600 whitespace-nowrap ${
                            key ? 'cursor-pointer hover:text-[#667eea] select-none' : ''
                          }`}
                        >
                          {label}
                          {key && sortKey === key && (sortDir === 'desc' ? ' ↓' : ' ↑')}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((a) => {
                      const ch = changesMap[a.state];
                      return (
                        <tr key={a.state} className="border-b last:border-0 hover:bg-gray-50">
                          <td className="px-4 py-2.5 font-medium text-gray-900">{a.state}</td>
                          <td className="px-4 py-2.5">
                            <div className="flex items-center gap-2">
                              <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden w-16">
                                <div
                                  className={`h-full rounded-full ${
                                    a.conflict_index > ciRedThreshold
                                      ? 'bg-red-500'
                                      : a.conflict_index > ciAmberThreshold
                                        ? 'bg-orange-500'
                                        : 'bg-green-500'
                                  }`}
                                  style={{ width: `${Math.min(a.conflict_index * 10, 100)}%` }}
                                />
                              </div>
                              <span className="font-mono text-xs">{a.conflict_index.toFixed(1)}</span>
                            </div>
                          </td>
                          <td className="px-4 py-2.5 font-mono">
                            {ch ? ch.deaths_current_30d.toLocaleString() : a.total_deaths_30d.toLocaleString()}
                          </td>
                          <td className="px-4 py-2.5">
                            <TrendArrow value={a.mom_deaths_pct_change} invert />
                          </td>
                          <td className="px-4 py-2.5">
                            <RagBadge status={a.status} size="sm" />
                          </td>
                          <td className="px-4 py-2.5 text-center">
                            {a.is_significant_escalation ? (
                              <span className="text-red-600 font-bold">⚠</span>
                            ) : (
                              <span className="text-gray-300">–</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Escalation Chart */}
          <div className="bg-white rounded-lg shadow-sm p-4">
            <h2 className="font-semibold text-sm text-gray-900 mb-4">
              Deaths: Current vs Prior {comparisonDays} days (Top 15 States)
            </h2>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={escalationChartData} margin={{ top: 4, right: 8, left: 0, bottom: 40 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e1e4e8" />
                <XAxis
                  dataKey="state"
                  tick={{ fontSize: 10 }}
                  angle={-35}
                  textAnchor="end"
                  interval={0}
                />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ paddingTop: 8 }} />
                <Bar dataKey="current" name={`Current ${comparisonDays}d`} fill="#667eea" radius={[2, 2, 0, 0]} />
                <Bar dataKey="prior" name={`Prior ${comparisonDays}d`} fill="#764ba2" opacity={0.6} radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}
