'use client';

import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { AbsoluteSeriesResponse } from '@/lib/types';

export default function AbsoluteDataPage() {
  const [pcodes, setPcodes] = useState('');
  const [level, setLevel] = useState<'ADM1' | 'ADM2' | 'ADM3'>('ADM3');
  const [granularity, setGranularity] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<AbsoluteSeriesResponse | null>(null);

  const hasData = !!data && data.locations.length > 0;
  const totalDeaths = useMemo(
    () => (data ? data.locations.reduce((acc, loc) => acc + loc.total_deaths, 0) : 0),
    [data],
  );
  const totalEvents = useMemo(
    () => (data ? data.locations.reduce((acc, loc) => acc + loc.total_events, 0) : 0),
    [data],
  );

  async function onLoadSeries() {
    if (!pcodes.trim()) {
      setError('Enter at least one PCODE.');
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await api.absoluteSeries({
        pcodes,
        level,
        granularity,
      });
      setData(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch absolute series');
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="bg-white rounded-lg shadow-sm p-4">
        <h1 className="text-lg font-bold">Absolute Data</h1>
        <p className="text-sm text-gray-600 mt-1">
          Compare fatalities and events across up to 25 selected locations.
        </p>
      </div>

      <div className="bg-white rounded-lg shadow-sm p-4 grid grid-cols-1 md:grid-cols-4 gap-3">
        <div className="md:col-span-2">
          <label className="block text-xs font-medium text-gray-600 mb-1">Location PCODEs</label>
          <input
            value={pcodes}
            onChange={(e) => setPcodes(e.target.value)}
            placeholder="ET0404,ET0512"
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
          <label className="block text-xs font-medium text-gray-600 mb-1">Granularity</label>
          <select
            value={granularity}
            onChange={(e) => setGranularity(e.target.value as 'monthly' | 'quarterly' | 'yearly')}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
          >
            <option value="monthly">Monthly</option>
            <option value="quarterly">Quarterly</option>
            <option value="yearly">Yearly</option>
          </select>
        </div>
        <div className="md:col-span-4">
          <button
            type="button"
            onClick={onLoadSeries}
            disabled={loading}
            className="rounded-md bg-[#667eea] text-white px-4 py-2 text-sm font-medium disabled:opacity-60"
          >
            {loading ? 'Loading…' : 'Load Series'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-3 text-sm">
          {error}
        </div>
      )}

      {hasData && data && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="bg-white rounded-lg shadow-sm p-4">
              <p className="text-xs text-gray-500">Periods</p>
              <p className="text-lg font-semibold">{data.periods.length}</p>
              <p className="text-xs text-gray-500 mt-1">
                {data.period_start} to {data.period_end}
              </p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <p className="text-xs text-gray-500">Total Deaths</p>
              <p className="text-lg font-semibold">{Math.round(totalDeaths).toLocaleString()}</p>
            </div>
            <div className="bg-white rounded-lg shadow-sm p-4">
              <p className="text-xs text-gray-500">Total Events</p>
              <p className="text-lg font-semibold">{totalEvents.toLocaleString()}</p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-sm overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left">
                <tr>
                  <th className="px-4 py-2">Location</th>
                  <th className="px-4 py-2">PCODE</th>
                  <th className="px-4 py-2">Deaths</th>
                  <th className="px-4 py-2">Events</th>
                </tr>
              </thead>
              <tbody>
                {data.locations.map((loc) => (
                  <tr key={loc.pcode} className="border-t border-gray-100">
                    <td className="px-4 py-2">{loc.name}</td>
                    <td className="px-4 py-2 font-mono text-xs">{loc.pcode}</td>
                    <td className="px-4 py-2">{Math.round(loc.total_deaths).toLocaleString()}</td>
                    <td className="px-4 py-2">{loc.total_events.toLocaleString()}</td>
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
