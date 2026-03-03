'use client';

import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { Download, FileSpreadsheet, Globe } from 'lucide-react';

import { useSummary } from '@/lib/hooks/useAlerts';
import { apiUrl } from '@/lib/apiBase';

export default function ReportsPage() {
  const [startDate, setStartDate] = useState('2024-01-01');
  const [endDate, setEndDate] = useState('2025-12-31');
  const [regions, setRegions] = useState('');
  const [eventType, setEventType] = useState('');

  const summary = useSummary({ start_date: startDate, end_date: endDate }).data;

  const params = useMemo(() => {
    const out: Record<string, string> = {};
    if (startDate) out.start = startDate;
    if (endDate) out.end = endDate;
    if (regions) out.states = regions;
    if (eventType) out.event_type = eventType;
    return out;
  }, [startDate, endDate, regions, eventType]);

  const csvUrl = useMemo(() => {
    const url = new URL(apiUrl('/api/export/csv'), typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return url.toString();
  }, [params]);

  const excelUrl = useMemo(() => {
    const url = new URL(apiUrl('/api/export/excel'), typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
    return url.toString();
  }, [params]);

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#667eea] to-[#764ba2] rounded-xl p-4 text-white">
        <h1 className="text-lg font-bold">Reports & Export</h1>
        <p className="text-white/80 text-xs mt-1">Ethiopia conflict dataset downloads and geospatial boundary exports.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
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
            <label className="text-xs font-medium text-gray-600 block mb-1">Regions (comma-separated)</label>
            <input
              type="text"
              value={regions}
              onChange={(e) => setRegions(e.target.value)}
              placeholder="e.g. Oromia, Amhara"
              className="w-full border border-gray-200 rounded px-2 py-1.5 text-sm"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Event Type</label>
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

        <div className="lg:col-span-2 space-y-4">
          <ExportCard
            icon={<Download className="h-5 w-5 text-green-600" />}
            title="Events CSV"
            body="Download filtered ACLED conflict events as CSV."
            href={csvUrl}
            download="ethiopia_conflict_events.csv"
            buttonClass="bg-green-600 hover:bg-green-700"
            buttonLabel="Download CSV"
          />

          <ExportCard
            icon={<FileSpreadsheet className="h-5 w-5 text-emerald-600" />}
            title="Multi-Sheet Excel"
            body="Download events, admin summary, and woreda aggregates in one workbook."
            href={excelUrl}
            download="ethiopia_conflict_report.xlsx"
            buttonClass="bg-emerald-600 hover:bg-emerald-700"
            buttonLabel="Download Excel"
          />

          <div className="bg-white rounded-lg shadow-sm p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
                <Globe className="h-5 w-5 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold text-gray-900 mb-0.5">Boundary GeoJSON</h3>
                <p className="text-sm text-gray-500 mb-3">Ethiopia admin boundaries for mapping and GIS workflows.</p>
                <div className="flex flex-wrap gap-2">
                  <a
                    href={apiUrl('/api/spatial/boundaries/1')}
                    download="ethiopia_adm1_regions.geojson"
                    className="inline-block bg-blue-600 text-white text-sm px-4 py-2 rounded hover:bg-blue-700 transition-colors"
                  >
                    ADM1 Regions
                  </a>
                  <a
                    href={apiUrl('/api/spatial/boundaries/2')}
                    download="ethiopia_adm2_zones.geojson"
                    className="inline-block bg-blue-500 text-white text-sm px-4 py-2 rounded hover:bg-blue-600 transition-colors"
                  >
                    ADM2 Zones
                  </a>
                  <a
                    href={apiUrl('/api/spatial/boundaries/3')}
                    download="ethiopia_adm3_woredas.geojson"
                    className="inline-block bg-blue-400 text-white text-sm px-4 py-2 rounded hover:bg-blue-500 transition-colors"
                  >
                    ADM3 Woredas
                  </a>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ExportCard({
  icon,
  title,
  body,
  href,
  download,
  buttonClass,
  buttonLabel,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  href: string;
  download: string;
  buttonClass: string;
  buttonLabel: string;
}) {
  return (
    <div className="bg-white rounded-lg shadow-sm p-5">
      <div className="flex items-start gap-3">
        <div className="w-10 h-10 bg-gray-50 rounded-lg flex items-center justify-center shrink-0">{icon}</div>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900 mb-0.5">{title}</h3>
          <p className="text-sm text-gray-500 mb-3">{body}</p>
          <a
            href={href}
            download={download}
            className={`inline-block text-white text-sm px-4 py-2 rounded transition-colors ${buttonClass}`}
          >
            {buttonLabel}
          </a>
        </div>
      </div>
    </div>
  );
}
