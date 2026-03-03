'use client';

import { useState, useMemo } from 'react';
import { useTimeseries, useByAdmin } from '@/lib/hooks/useConflicts';
import {
  LineChart,
  Line,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import { Search } from 'lucide-react';

type Frequency = 'monthly' | 'quarterly' | 'yearly';
type Dimension = 'event_type' | 'sub_event_type' | 'actor';
type ChartType = 'line' | 'area' | 'bar';

const COLORS = ['#667eea', '#764ba2', '#27ae60', '#d35400', '#c0392b', '#2196f3', '#e74c3c', '#1abc9c'];

export default function ExplorerPage() {
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [dimension, setDimension] = useState<Dimension>('event_type');
  const [chartType, setChartType] = useState<ChartType>('area');
  const [metricKey, setMetricKey] = useState<'deaths' | 'events'>('deaths');
  const [startYear, setStartYear] = useState('2015');
  const [endYear, setEndYear] = useState('2025');

  const { data: series, isLoading } = useTimeseries({
    frequency,
    dimension,
    start: `${startYear}-01-01`,
    end: `${endYear}-12-31`,
  });

  const { data: adminData, isLoading: adminLoading } = useByAdmin({
    level: 1,
    start: `${startYear}-01-01`,
    end: `${endYear}-12-31`,
  });

  // Pivot series data for Recharts
  const chartData = useMemo(() => {
    if (!series) return [];
    const periods = [...new Set(series.map((d) => d.period))].sort();
    const dims = [...new Set(series.map((d) => d.dimension))];
    return periods.map((period) => {
      const row: Record<string, string | number> = { period };
      dims.forEach((dim) => {
        const match = series.find((d) => d.period === period && d.dimension === dim);
        row[dim] = match ? match[metricKey] : 0;
      });
      return row;
    });
  }, [series, metricKey]);

  const dimensions = useMemo(
    () => [...new Set(series?.map((d) => d.dimension) ?? [])].slice(0, 8),
    [series],
  );

  const top10Admin = useMemo(
    () =>
      (adminData ?? [])
        .sort((a, b) => b[metricKey] - a[metricKey])
        .slice(0, 10)
        .map((d) => ({ state: d.admin1, value: d[metricKey] })),
    [adminData, metricKey],
  );

  const ChartComponent = chartType === 'bar' ? BarChart : chartType === 'line' ? LineChart : AreaChart;

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#667eea] to-[#764ba2] rounded-xl p-4 text-white flex items-center gap-3">
        <Search className="h-5 w-5" />
        <div>
          <h1 className="text-lg font-bold">Data Explorer</h1>
          <p className="text-white/80 text-xs">Time series analysis by event type, actor, and geography</p>
        </div>
      </div>

      {/* Controls */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="flex flex-wrap gap-4">
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Frequency</label>
            <div className="flex gap-1">
              {(['monthly', 'quarterly', 'yearly'] as Frequency[]).map((f) => (
                <button
                  key={f}
                  onClick={() => setFrequency(f)}
                  className={`text-xs px-2.5 py-1.5 rounded border capitalize transition-colors ${
                    frequency === f ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Dimension</label>
            <div className="flex gap-1">
              {([
                { v: 'event_type', l: 'Event Type' },
                { v: 'sub_event_type', l: 'Sub-Event' },
                { v: 'actor', l: 'Actor' },
              ] as { v: Dimension; l: string }[]).map(({ v, l }) => (
                <button
                  key={v}
                  onClick={() => setDimension(v)}
                  className={`text-xs px-2.5 py-1.5 rounded border transition-colors ${
                    dimension === v ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Chart Type</label>
            <div className="flex gap-1">
              {(['area', 'line', 'bar'] as ChartType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setChartType(t)}
                  className={`text-xs px-2.5 py-1.5 rounded border capitalize transition-colors ${
                    chartType === t ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Metric</label>
            <div className="flex gap-1">
              {(['deaths', 'events'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMetricKey(m)}
                  className={`text-xs px-2.5 py-1.5 rounded border capitalize transition-colors ${
                    metricKey === m ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-600'
                  }`}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-2">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Start Year</label>
              <input
                type="number"
                min="1997"
                max="2025"
                value={startYear}
                onChange={(e) => setStartYear(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1 text-xs w-20"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">End Year</label>
              <input
                type="number"
                min="1997"
                max="2025"
                value={endYear}
                onChange={(e) => setEndYear(e.target.value)}
                className="border border-gray-200 rounded px-2 py-1 text-xs w-20"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Time Series Chart */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h2 className="font-semibold text-sm text-gray-900 mb-4 capitalize">
          {metricKey} by {dimension.replace('_', ' ')} ({frequency})
        </h2>
        {isLoading ? (
          <div className="h-64 bg-gray-100 animate-pulse rounded" />
        ) : (
          <ResponsiveContainer width="100%" height={300}>
            <ChartComponent data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e1e4e8" />
              <XAxis
                dataKey="period"
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => String(v).slice(0, 7)}
                interval="preserveStartEnd"
              />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Legend />
              {dimensions.map((dim, i) =>
                chartType === 'bar' ? (
                  <Bar key={dim} dataKey={dim} fill={COLORS[i % COLORS.length]} stackId="a" />
                ) : chartType === 'area' ? (
                  <Area
                    key={dim}
                    type="monotone"
                    dataKey={dim}
                    fill={COLORS[i % COLORS.length]}
                    stroke={COLORS[i % COLORS.length]}
                    fillOpacity={0.4}
                    stackId="a"
                  />
                ) : (
                  <Line
                    key={dim}
                    type="monotone"
                    dataKey={dim}
                    stroke={COLORS[i % COLORS.length]}
                    dot={false}
                    strokeWidth={1.5}
                  />
                ),
              )}
            </ChartComponent>
          </ResponsiveContainer>
        )}
      </div>

      {/* Top States Bar Chart */}
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h2 className="font-semibold text-sm text-gray-900 mb-4 capitalize">
          Top 10 States by {metricKey}
        </h2>
        {adminLoading ? (
          <div className="h-48 bg-gray-100 animate-pulse rounded" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={top10Admin} layout="vertical" margin={{ left: 60, right: 16 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e1e4e8" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} />
              <YAxis type="category" dataKey="state" tick={{ fontSize: 11 }} width={80} />
              <Tooltip />
              <Bar dataKey="value" fill="#667eea" radius={[0, 3, 3, 0]} name={metricKey} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}
