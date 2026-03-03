'use client';

import { useState } from 'react';
import { useSummary, useAlertStatus } from '@/lib/hooks/useAlerts';
import { FileText, Download, FileSpreadsheet, Globe } from 'lucide-react';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export default function ReportsPage() {
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2025-12-31');
  const [states, setStates] = useState('');
  const [eventType, setEventType] = useState('');

  const { data: summary } = useSummary({ start_date: startDate, end_date: endDate });
  const { data: alerts } = useAlertStatus();

  const params: Record<string, string> = {};
  if (startDate) params.start = startDate;
  if (endDate) params.end = endDate;
  if (states) params.states = states;
  if (eventType) params.event_type = eventType;

  const csvUrl = (() => {
    const url = new URL(`${BASE_URL}/api/export/csv`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return url.toString();
  })();

  const excelUrl = (() => {
    const url = new URL(`${BASE_URL}/api/export/excel`);
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return url.toString();
  })();

  const geojsonUrl = (() => {
    const url = new URL(`${BASE_URL}/api/spatial/boundaries/1`);
    return url.toString();
  })();

  const red = alerts?.filter((a) => a.status === 'red') ?? [];
  const amber = alerts?.filter((a) => a.status === 'amber') ?? [];

  const handlePrint = () => {
    window.open(`${BASE_URL}/api/export/fcv-monitor`, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#667eea] to-[#764ba2] rounded-xl p-4 text-white flex items-center gap-3">
        <FileText className="h-5 w-5" />
        <div>
          <h1 className="text-lg font-bold">Reports & Export</h1>
          <p className="text-white/80 text-xs">Download conflict data and generate briefings</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Filter Panel */}
        <div className="bg-white rounded-lg shadow-sm p-4 space-y-4">
          <h3 className="font-semibold text-sm text-gray-900">Export Filters</h3>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Start Date</label>
            <input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">End Date</label>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              States (comma-separated, optional)
            </label>
            <input
              type="text"
              value={states}
              onChange={(e) => setStates(e.target.value)}
              placeholder="e.g. Borno, Zamfara"
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Event Type (optional)
            </label>
            <input
              type="text"
              value={eventType}
              onChange={(e) => setEventType(e.target.value)}
              placeholder="e.g. Battles"
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>

          {summary && (
            <div className="bg-gray-50 rounded p-3 text-xs text-gray-600 space-y-1">
              <p><strong>Matching events:</strong> {summary.total_events.toLocaleString()}</p>
              <p><strong>Total deaths:</strong> {summary.total_deaths.toLocaleString()}</p>
            </div>
          )}
        </div>

        {/* Export Cards */}
        <div className="lg:col-span-2 space-y-4">
          {/* Briefing / Print */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-indigo-50 rounded-lg flex items-center justify-center shrink-0">
                <FileText className="h-5 w-5 text-[#667eea]" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-0.5">FCV Risk Monitor — Q1 2025</h3>
                <p className="text-sm text-gray-500 mb-3">
                  World Bank Nigeria FCV Risk Monitor: 6-page briefing with conflict overview, incident summary, zone trends, analysis, and WB programming implications.
                </p>
                <button
                  onClick={handlePrint}
                  className="bg-[#667eea] text-white text-sm px-4 py-2 rounded hover:bg-[#5568d3] transition-colors"
                >
                  Open Report (Print / Save as PDF)
                </button>
              </div>
            </div>
          </div>

          {/* CSV */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-green-50 rounded-lg flex items-center justify-center shrink-0">
                <Download className="h-5 w-5 text-green-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-0.5">Events CSV</h3>
                <p className="text-sm text-gray-500 mb-3">
                  Download filtered conflict events as a flat CSV file. Includes all ACLED fields.
                </p>
                <a
                  href={csvUrl}
                  download="nigeria_conflict_events.csv"
                  className="inline-block bg-green-600 text-white text-sm px-4 py-2 rounded hover:bg-green-700 transition-colors"
                >
                  Download CSV
                </a>
              </div>
            </div>
          </div>

          {/* Excel */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-emerald-50 rounded-lg flex items-center justify-center shrink-0">
                <FileSpreadsheet className="h-5 w-5 text-emerald-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-0.5">Multi-Sheet Excel</h3>
                <p className="text-sm text-gray-500 mb-3">
                  Three sheets: Events, State Summary, and Ward Aggregates. Ideal for offline analysis.
                </p>
                <a
                  href={excelUrl}
                  download="nigeria_conflict_report.xlsx"
                  className="inline-block bg-emerald-600 text-white text-sm px-4 py-2 rounded hover:bg-emerald-700 transition-colors"
                >
                  Download Excel
                </a>
              </div>
            </div>
          </div>

          {/* GeoJSON */}
          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                <Globe className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-0.5">State Boundaries GeoJSON</h3>
                <p className="text-sm text-gray-500 mb-3">
                  Nigeria state boundaries in GeoJSON format, compatible with QGIS and web mapping.
                </p>
                <div className="flex gap-2">
                  <a
                    href={`${BASE_URL}/api/spatial/boundaries/1`}
                    download="nigeria_states.geojson"
                    className="inline-block bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700 transition-colors"
                  >
                    States GeoJSON
                  </a>
                  <a
                    href={`${BASE_URL}/api/spatial/boundaries/2`}
                    download="nigeria_lgas.geojson"
                    className="inline-block bg-blue-500 text-white text-sm px-4 py-2 rounded hover:bg-blue-600 transition-colors"
                  >
                    LGAs GeoJSON
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Print-only briefing */}
      <div className="hidden print:block space-y-4 p-8">
        <div className="text-center border-b pb-4">
          <h1 className="text-2xl font-bold">Nigeria Conflict Briefing</h1>
          <p className="text-gray-600">
            Period: {startDate} – {endDate} · Generated: {new Date().toLocaleDateString()}
          </p>
        </div>

        {summary && (
          <div>
            <h2 className="text-lg font-bold mb-2">Key Metrics</h2>
            <div className="grid grid-cols-3 gap-4 text-center">
              <div className="border rounded p-3">
                <div className="text-2xl font-bold">{summary.total_events.toLocaleString()}</div>
                <div className="text-sm text-gray-500">Total Events</div>
              </div>
              <div className="border rounded p-3">
                <div className="text-2xl font-bold">{summary.total_deaths.toLocaleString()}</div>
                <div className="text-sm text-gray-500">Total Deaths</div>
              </div>
              <div className="border rounded p-3">
                <div className="text-2xl font-bold">{summary.wards_affected.toLocaleString()}</div>
                <div className="text-sm text-gray-500">Wards Affected</div>
              </div>
            </div>
          </div>
        )}

        {alerts && (
          <div>
            <h2 className="text-lg font-bold mb-2">Alert Status</h2>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <h3 className="font-semibold text-red-600 mb-1">Red Alert ({red.length})</h3>
                {red.map((a) => <div key={a.state}>{a.state} — CI: {a.conflict_index.toFixed(1)}</div>)}
              </div>
              <div>
                <h3 className="font-semibold text-orange-600 mb-1">Elevated ({amber.length})</h3>
                {amber.map((a) => <div key={a.state}>{a.state} — CI: {a.conflict_index.toFixed(1)}</div>)}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
