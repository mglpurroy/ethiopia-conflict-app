'use client';

import { useMemo, useState } from 'react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts';

import { api } from '@/lib/api';
import type { LocationTrendResponse } from '@/lib/types';

export default function ExplorerPage() {
  const [pcode, setPcode] = useState('');
  const [level, setLevel] = useState<'ADM1' | 'ADM2' | 'ADM3'>('ADM3');
  const [lookback, setLookback] = useState(10);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<LocationTrendResponse | null>(null);

  const chartData = useMemo(
    () => (data ? data.series.map((d) => ({ period: d.period, deaths: d.deaths, events: d.events, death_rate: d.death_rate })) : []),
    [data],
  );

  async function loadTrend() {
    if (!pcode.trim()) {
      setError('Enter a location PCODE.');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const res = await api.trendsLocation({
        pcode: pcode.trim(),
        level,
        lookback_periods: lookback,
      });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load trend data');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h1 className="text-lg font-bold">Trend Analysis</h1>
        <p className="text-sm text-gray-600 mt-1">
          Analyze a location trajectory across rolling 12-month periods.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">PCODE</label>
          <input
            value={pcode}
            onChange={(e) => setPcode(e.target.value)}
            placeholder="ET0404"
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Level</label>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value as 'ADM1' | 'ADM2' | 'ADM3')}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="ADM1">ADM1 (Region)</option>
            <option value="ADM2">ADM2 (Zone)</option>
            <option value="ADM3">ADM3 (Woreda)</option>
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Lookback Periods</label>
          <input
            type="number"
            min={3}
            max={50}
            value={lookback}
            onChange={(e) => setLookback(Number(e.target.value))}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          />
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={loadTrend}
            disabled={loading}
            className="rounded-md bg-[#667eea] text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Load Trend'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <p className="text-xs text-gray-500">Location</p>
              <p className="text-sm font-semibold text-gray-900 mt-1">{data.location.name}</p>
              <p className="text-xs text-gray-500 mt-1 font-mono">{data.location.pcode}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <p className="text-xs text-gray-500">Trajectory</p>
              <p className="text-lg font-semibold text-gray-900 mt-1">{data.trajectory}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <p className="text-xs text-gray-500">Latest Period</p>
              <p className="text-sm font-semibold text-gray-900 mt-1">{data.latest?.period ?? 'N/A'}</p>
              <p className="text-xs text-gray-500 mt-1">
                Deaths: {Math.round(data.latest?.deaths ?? 0).toLocaleString()} | Events: {(data.latest?.events ?? 0).toLocaleString()}
              </p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm p-4">
            <h2 className="text-sm font-semibold text-gray-900 mb-3">Deaths and Events by Period</h2>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="period" tick={{ fontSize: 11 }} interval="preserveStartEnd" />
                <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line yAxisId="left" type="monotone" dataKey="deaths" stroke="#dc2626" dot={false} strokeWidth={2} />
                <Line yAxisId="right" type="monotone" dataKey="events" stroke="#2563eb" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="bg-white rounded-lg shadow-sm overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-2">Period</th>
                  <th className="px-4 py-2">Class</th>
                  <th className="px-4 py-2">Deaths</th>
                  <th className="px-4 py-2">Events</th>
                  <th className="px-4 py-2">Death Rate /100k</th>
                </tr>
              </thead>
              <tbody>
                {data.series.map((row) => (
                  <tr key={row.period_id} className="border-t border-gray-100">
                    <td className="px-4 py-2">{row.period}</td>
                    <td className="px-4 py-2">{row.classification_label}</td>
                    <td className="px-4 py-2">{Math.round(row.deaths).toLocaleString()}</td>
                    <td className="px-4 py-2">{row.events.toLocaleString()}</td>
                    <td className="px-4 py-2">{row.death_rate.toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
