'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Map as MapIcon, Search, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

import { api } from '@/lib/api';
import { apiUrl } from '@/lib/apiBase';
import type { DrillEvent } from '@/components/map/ConflictMap';
import type { PeriodPreset } from '@/lib/types';

const ConflictMap = dynamic(() => import('@/components/map/ConflictMap'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-gray-100 rounded-lg">
      <div className="text-gray-500 text-sm">Loading map...</div>
    </div>
  ),
});

type AdminLevel = 1 | 2 | 3;
type MapView = 'regions_zones' | 'woredas';
type AnalysisType = 'conflict_metrics' | 'trajectory';
type ConflictMetric = 'conflict_affected' | 'highly_conflict_affected';
type MapVar = 'share_woredas' | 'share_population';

const TRAJECTORY_OPTIONS = [
  'At-Risk',
  'Onset',
  'Recovery',
  'Turnaround',
  'Stable',
  'Fluctuating',
  'Insufficient Data',
];

interface MonthlyPoint {
  period: string;
  deaths: number;
  events: number;
}

interface UnitHistory {
  unit: string;
  level: number;
  pcode: string;
  total_deaths: number;
  total_events: number;
  monthly: MonthlyPoint[];
}

function getUnitName(props: Record<string, any>, level: AdminLevel): string {
  if (level === 1) return props.ADM1_EN ?? props.ADM1_PCODE ?? 'Unknown';
  if (level === 2) return props.ADM2_EN ?? props.ADM2_PCODE ?? 'Unknown';
  return props.ADM3_EN ?? props.ADM3_PCODE ?? 'Unknown';
}

function getPcode(props: Record<string, any>, level: AdminLevel): string {
  if (level === 1) return props.ADM1_PCODE ?? '';
  if (level === 2) return props.ADM2_PCODE ?? '';
  return props.ADM3_PCODE ?? '';
}

function featureBbox(geometry: any): [[number, number], [number, number]] {
  const lngs: number[] = [];
  const lats: number[] = [];
  function walk(c: any) {
    if (typeof c?.[0] === 'number') {
      lngs.push(c[0]);
      lats.push(c[1]);
      return;
    }
    if (Array.isArray(c)) c.forEach(walk);
  }
  if (geometry?.type === 'GeometryCollection') {
    geometry.geometries.forEach((g: any) => walk(g.coordinates));
  } else {
    walk(geometry?.coordinates);
  }
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

export default function SpatialPage() {
  const [periods, setPeriods] = useState<PeriodPreset[]>([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [periodError, setPeriodError] = useState<string | null>(null);

  const [mapView, setMapView] = useState<MapView>('regions_zones');
  const [adminLevel, setAdminLevel] = useState<AdminLevel>(1);
  const [analysisType, setAnalysisType] = useState<AnalysisType>('conflict_metrics');
  const [conflictMetric, setConflictMetric] = useState<ConflictMetric>('conflict_affected');
  const [mapVar, setMapVar] = useState<MapVar>('share_woredas');
  const [aggThresh, setAggThresh] = useState(0.2);
  const [showEvents, setShowEvents] = useState(false);
  const [trajectoryCategories, setTrajectoryCategories] = useState<string[]>(TRAJECTORY_OPTIONS);

  const [drillState, setDrillState] = useState<{ pcode: string; name: string } | null>(null);
  const [drillLGA, setDrillLGA] = useState<{ pcode: string; name: string } | null>(null);

  const [selectedProps, setSelectedProps] = useState<Record<string, any> | null>(null);
  const [unitHistory, setUnitHistory] = useState<UnitHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [locationQuery, setLocationQuery] = useState('');
  const [locationStatus, setLocationStatus] = useState<string | null>(null);
  const [flyToCoords, setFlyToCoords] = useState<{ lng: number; lat: number } | null>(null);

  useEffect(() => {
    let mounted = true;
    api
      .periods()
      .then((res) => {
        if (!mounted) return;
        setPeriods(res.periods ?? []);
        if ((res.periods?.length ?? 0) > 0) setSelectedPeriodId(res.periods[0].id);
      })
      .catch((e) => {
        if (!mounted) return;
        setPeriodError(e instanceof Error ? e.message : 'Failed to load periods');
      });
    return () => {
      mounted = false;
    };
  }, []);

  const selectedPeriod = useMemo(
    () => periods.find((p) => p.id === selectedPeriodId) ?? null,
    [periods, selectedPeriodId],
  );

  const startYear = selectedPeriod?.start_year ?? 2025;
  const startMonth = selectedPeriod?.start_month ?? 1;
  const endYear = selectedPeriod?.end_year ?? 2025;
  const endMonth = selectedPeriod?.end_month ?? 12;

  useEffect(() => {
    if (mapView === 'woredas' && adminLevel !== 3) {
      setAdminLevel(3);
      setDrillState(null);
      setDrillLGA(null);
    }
    if (mapView === 'regions_zones' && adminLevel === 3) {
      setAdminLevel(1);
      setDrillState(null);
      setDrillLGA(null);
    }
  }, [mapView, adminLevel]);

  const parentPcode =
    adminLevel === 3 && drillLGA
      ? drillLGA.pcode
      : adminLevel === 2 && drillState
      ? drillState.pcode
      : '';

  const handleLevelChange = (level: AdminLevel) => {
    if (mapView === 'woredas') return;
    setAdminLevel(level);
    setDrillState(null);
    setDrillLGA(null);
    setSelectedProps(null);
  };

  const handleDrillDown = useCallback(
    ({ level, pcode, name }: DrillEvent) => {
      if (level === 1) {
        setDrillState({ pcode, name });
        setDrillLGA(null);
        setAdminLevel(2);
        return;
      }
      setDrillLGA({ pcode, name });
      setMapView('woredas');
      setAdminLevel(3);
    },
    [],
  );

  useEffect(() => {
    if (!selectedProps) {
      setUnitHistory(null);
      return;
    }
    const clickedLevel = (selectedProps._clickedLevel ?? adminLevel) as AdminLevel;
    const pcode = getPcode(selectedProps, clickedLevel);
    const name = getUnitName(selectedProps, clickedLevel);

    setHistoryLoading(true);
    setUnitHistory(null);
    fetch(
      apiUrl(`/api/spatial/unit-history?level=${clickedLevel}&pcode=${encodeURIComponent(pcode)}&name=${encodeURIComponent(name)}`),
    )
      .then((r) => r.json())
      .then((d) => setUnitHistory(d))
      .catch(() => setUnitHistory(null))
      .finally(() => setHistoryLoading(false));
  }, [selectedProps, adminLevel]);

  const toggleTrajectoryCategory = (value: string, checked: boolean) => {
    setTrajectoryCategories((prev) => {
      if (checked) return Array.from(new Set([...prev, value]));
      return prev.filter((v) => v !== value);
    });
  };

  const findLocation = async () => {
    const q = locationQuery.trim().toLowerCase();
    if (!q) return;

    setLocationStatus('Searching...');
    try {
      const boundary = (await api.boundaries(adminLevel)) as any;
      const features = boundary?.features ?? [];
      const nameKey = adminLevel === 1 ? 'ADM1_EN' : adminLevel === 2 ? 'ADM2_EN' : 'ADM3_EN';
      const pcodeKey = adminLevel === 1 ? 'ADM1_PCODE' : adminLevel === 2 ? 'ADM2_PCODE' : 'ADM3_PCODE';

      const match = features.find((f: any) => {
        const name = String(f?.properties?.[nameKey] ?? '').toLowerCase();
        const pcode = String(f?.properties?.[pcodeKey] ?? '').toLowerCase();
        return name.includes(q) || pcode.includes(q);
      });

      if (!match) {
        setLocationStatus('No matching location found for current level.');
        return;
      }

      const [[minLng, minLat], [maxLng, maxLat]] = featureBbox(match.geometry);
      setFlyToCoords({ lng: (minLng + maxLng) / 2, lat: (minLat + maxLat) / 2 });
      setSelectedProps({ ...(match.properties ?? {}), _clickedLevel: adminLevel });
      setLocationStatus(`Zoomed to ${match.properties?.[nameKey] ?? match.properties?.[pcodeKey] ?? 'location'}.`);
    } catch {
      setLocationStatus('Location search failed.');
    }
  };

  const historySeries = useMemo(
    () => (unitHistory?.monthly ?? []).map((m) => ({ period: m.period, deaths: m.deaths, events: m.events })),
    [unitHistory],
  );

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-[#667eea] to-[#764ba2] rounded-xl p-4 text-white flex items-center gap-3">
        <MapIcon className="h-5 w-5" />
        <div>
          <h1 className="text-lg font-bold">Interactive Maps</h1>
          <p className="text-white/80 text-xs">Period-based conflict and trajectory classification for Ethiopia.</p>
        </div>
      </div>

      {periodError && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{periodError}</div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        <div className="bg-white rounded-lg shadow-sm p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[#667eea]" />
            <h3 className="font-semibold text-sm">Map Controls</h3>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Period</label>
            <select
              value={selectedPeriodId}
              onChange={(e) => setSelectedPeriodId(e.target.value)}
              className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm"
            >
              {periods.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Map View</label>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setMapView('regions_zones')}
                className={`text-xs rounded border px-2 py-1.5 ${
                  mapView === 'regions_zones' ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-700'
                }`}
              >
                Regions/Zones
              </button>
              <button
                type="button"
                onClick={() => setMapView('woredas')}
                className={`text-xs rounded border px-2 py-1.5 ${
                  mapView === 'woredas' ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-700'
                }`}
              >
                Woredas
              </button>
            </div>
          </div>

          {mapView === 'regions_zones' && (
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Admin Level</label>
              <div className="grid grid-cols-2 gap-1">
                <button
                  type="button"
                  onClick={() => handleLevelChange(1)}
                  className={`text-xs rounded border px-2 py-1.5 ${
                    adminLevel === 1 ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-700'
                  }`}
                >
                  Regions
                </button>
                <button
                  type="button"
                  onClick={() => handleLevelChange(2)}
                  className={`text-xs rounded border px-2 py-1.5 ${
                    adminLevel === 2 ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-700'
                  }`}
                >
                  Zones
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Analysis Type</label>
            <div className="grid grid-cols-2 gap-1">
              <button
                type="button"
                onClick={() => setAnalysisType('conflict_metrics')}
                className={`text-xs rounded border px-2 py-1.5 ${
                  analysisType === 'conflict_metrics'
                    ? 'bg-[#667eea] text-white border-[#667eea]'
                    : 'border-gray-200 text-gray-700'
                }`}
              >
                Conflict Metrics
              </button>
              <button
                type="button"
                onClick={() => setAnalysisType('trajectory')}
                className={`text-xs rounded border px-2 py-1.5 ${
                  analysisType === 'trajectory' ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-700'
                }`}
              >
                Trajectory
              </button>
            </div>
          </div>

          {analysisType === 'conflict_metrics' && (
            <>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Conflict Metric</label>
                <select
                  value={conflictMetric}
                  onChange={(e) => setConflictMetric(e.target.value as ConflictMetric)}
                  className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm"
                >
                  <option value="conflict_affected">Conflict-Affected</option>
                  <option value="highly_conflict_affected">Highly Conflict-Affected</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Map Variable</label>
                <select
                  value={mapVar}
                  onChange={(e) => setMapVar(e.target.value as MapVar)}
                  className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm"
                >
                  <option value="share_woredas">Share of Woredas Affected</option>
                  <option value="share_population">Share of Population Affected</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">
                  Aggregation Threshold: {(aggThresh * 100).toFixed(0)}%
                </label>
                <input
                  type="range"
                  min="0.02"
                  max="0.8"
                  step="0.01"
                  value={aggThresh}
                  onChange={(e) => setAggThresh(Number(e.target.value))}
                  className="w-full accent-[#667eea]"
                />
              </div>
            </>
          )}

          {analysisType === 'trajectory' && (
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Trajectory Categories</label>
              <div className="grid grid-cols-1 gap-1 max-h-48 overflow-auto border border-gray-200 rounded p-2">
                {TRAJECTORY_OPTIONS.map((t) => (
                  <label key={t} className="text-xs text-gray-700 flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={trajectoryCategories.includes(t)}
                      onChange={(e) => toggleTrajectoryCategory(t, e.target.checked)}
                      className="accent-[#667eea]"
                    />
                    {t}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="pt-1 border-t border-gray-100 space-y-2">
            <div className="flex items-center gap-2">
              <input
                id="show-events"
                type="checkbox"
                checked={showEvents}
                onChange={(e) => setShowEvents(e.target.checked)}
                className="accent-[#667eea]"
              />
              <label htmlFor="show-events" className="text-xs font-medium text-gray-600 cursor-pointer">
                Show detailed incidents
              </label>
            </div>
          </div>

          <div className="pt-1 border-t border-gray-100 space-y-2">
            <label className="text-xs font-medium text-gray-600 flex items-center gap-1">
              <Search className="h-3.5 w-3.5" />
              Location Finder
            </label>
            <input
              value={locationQuery}
              onChange={(e) => setLocationQuery(e.target.value)}
              placeholder="Search name or PCODE"
              className="w-full rounded-md border border-gray-300 px-2.5 py-2 text-sm"
            />
            <button
              type="button"
              onClick={findLocation}
              className="w-full rounded-md bg-[#667eea] text-white px-3 py-2 text-xs font-medium"
            >
              Find and Zoom
            </button>
            {locationStatus && <p className="text-[11px] text-gray-500">{locationStatus}</p>}
          </div>
        </div>

        <div className="lg:col-span-3 bg-white rounded-lg shadow-sm overflow-hidden" style={{ height: '72vh' }}>
          <ConflictMap
            level={adminLevel}
            variable="ward_share"
            periodId={selectedPeriodId || undefined}
            mapView={mapView}
            analysisType={analysisType}
            conflictMetric={conflictMetric}
            classificationMapVar={mapVar}
            trajectoryCategories={trajectoryCategories}
            startYear={startYear}
            startMonth={startMonth}
            endYear={endYear}
            endMonth={endMonth}
            rateThresh={2}
            absThresh={10}
            aggThresh={aggThresh}
            parentPcode={parentPcode}
            showEvents={showEvents}
            onDrillDown={handleDrillDown}
            onUnitClick={(props) => setSelectedProps(props)}
            flyToCoords={flyToCoords}
          />
        </div>
      </div>

      {(selectedProps || historyLoading) && (
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <TrendingUp className="h-4 w-4 text-[#667eea]" />
            <h2 className="text-sm font-semibold text-gray-800">
              {selectedProps ? getUnitName(selectedProps, (selectedProps._clickedLevel ?? adminLevel) as AdminLevel) : 'Loading...'}
            </h2>
          </div>

          {historyLoading && <div className="h-40 bg-gray-100 animate-pulse rounded" />}

          {!historyLoading && unitHistory && (
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="rounded border border-gray-200 p-3">
                  <p className="text-xs text-gray-500">Total Deaths</p>
                  <p className="text-lg font-semibold text-gray-900">{unitHistory.total_deaths.toLocaleString()}</p>
                </div>
                <div className="rounded border border-gray-200 p-3">
                  <p className="text-xs text-gray-500">Total Events</p>
                  <p className="text-lg font-semibold text-gray-900">{unitHistory.total_events.toLocaleString()}</p>
                </div>
                <div className="rounded border border-gray-200 p-3">
                  <p className="text-xs text-gray-500">Timeline Points</p>
                  <p className="text-lg font-semibold text-gray-900">{historySeries.length.toLocaleString()}</p>
                </div>
              </div>

              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={historySeries}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#ececec" />
                    <XAxis dataKey="period" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                    <YAxis tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Line type="monotone" dataKey="deaths" stroke="#dc2626" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="events" stroke="#2563eb" strokeWidth={2} dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
