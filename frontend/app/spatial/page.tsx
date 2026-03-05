'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Map as MapIcon, Search, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar } from 'recharts';

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
type AnalysisType = 'conflict_metrics' | 'trajectory';

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
  year: number;
  month: number;
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

type ClassificationCode = 0 | 1 | 2 | 3;

interface MonthlyChartPoint {
  period: string;
  deaths: number;
  events: number;
}

const STATUS_LABEL_BY_CODE: Record<ClassificationCode, string> = {
  0: 'No reported violence',
  1: 'Below threshold',
  2: 'Conflict-Affected',
  3: 'Highly Conflict-Affected',
};

const STATUS_COLOR_BY_CODE: Record<ClassificationCode, string> = {
  0: '#bfdbfe',
  1: '#f59e0b',
  2: '#ef4444',
  3: '#b91c1c',
};

function classifyFromCounts(deaths: number, events: number, population: number): ClassificationCode {
  const deathRate = population > 0 ? (deaths / population) * 1e5 : 0;

  if (events <= 0 && deaths <= 0) return 0;
  if (deathRate >= 10 && deaths >= 20 && events >= 3) return 3;
  if (deathRate >= 2 && deaths >= 5 && events >= 2) return 2;
  return 1;
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

  const [adminLevel, setAdminLevel] = useState<AdminLevel>(1);
  const [analysisType, setAnalysisType] = useState<AnalysisType>('conflict_metrics');
  const [showEvents, setShowEvents] = useState(false);
  const [trajectoryCategories, setTrajectoryCategories] = useState<string[]>(TRAJECTORY_OPTIONS);

  const [drillState, setDrillState] = useState<{ pcode: string; name: string } | null>(null);
  const [drillZone, setDrillZone] = useState<{ pcode: string; name: string } | null>(null);

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

  const parentPcode =
    adminLevel === 3
      ? drillZone?.pcode ?? drillState?.pcode ?? ''
      : adminLevel === 2 && drillState
      ? drillState.pcode
      : '';
  const parentLevel =
    adminLevel === 3
      ? drillZone
        ? 2
        : drillState
        ? 1
        : undefined
      : adminLevel === 2 && drillState
      ? 1
      : undefined;

  const handleLevelChange = (level: AdminLevel) => {
    setAdminLevel(level);
    setDrillState(null);
    setDrillZone(null);
    setSelectedProps(null);
  };

  const handleDrillDown = useCallback(
    ({ level, pcode, name }: DrillEvent) => {
      if (level === 1) {
        setDrillState({ pcode, name });
        setDrillZone(null);
        setAdminLevel(2);
        return;
      }
      if (level === 2) {
        setDrillZone({ pcode, name });
        setAdminLevel(3);
        setShowEvents(true);
        return;
      }
      // Level 3 double-click: keep level, just ensure detailed incidents are visible.
      setShowEvents(true);
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
    () => unitHistory?.monthly ?? [],
    [unitHistory],
  );

  const monthlyFromSelectedPeriod = useMemo(() => {
    if (!selectedPeriod) return [];
    const startValue = selectedPeriod.start_year * 100 + selectedPeriod.start_month;
    const now = new Date();
    const endYear = now.getFullYear();
    const endMonth = now.getMonth() + 1;
    const byPeriod = new Map<string, { deaths: number; events: number }>();

    historySeries.forEach((m) => {
      const periodKey = `${Number(m.year)}-${String(Number(m.month)).padStart(2, '0')}`;
      byPeriod.set(periodKey, {
        deaths: Number(m.deaths ?? 0),
        events: Number(m.events ?? 0),
      });
    });

    const filled: MonthlyChartPoint[] = [];
    let y = selectedPeriod.start_year;
    let m = selectedPeriod.start_month;

    while (y < endYear || (y === endYear && m <= endMonth)) {
      const ym = y * 100 + m;
      if (ym >= startValue) {
        const key = `${y}-${String(m).padStart(2, '0')}`;
        const existing = byPeriod.get(key);
        filled.push({
          period: key,
          deaths: existing?.deaths ?? 0,
          events: existing?.events ?? 0,
        });
      }

      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }

    return filled;
  }, [historySeries, selectedPeriod]);

  const yearlyForLastTen = useMemo(() => {
    if (historySeries.length === 0) return [];
    const byYear = new Map<number, { year: number; deaths: number; events: number }>();
    historySeries.forEach((m) => {
      const year = Number(m.year);
      const existing = byYear.get(year) ?? { year, deaths: 0, events: 0 };
      existing.deaths += Number(m.deaths ?? 0);
      existing.events += Number(m.events ?? 0);
      byYear.set(year, existing);
    });
    const years = Array.from(byYear.keys()).sort((a, b) => a - b);
    if (years.length === 0) return [];
    const maxYear = years[years.length - 1];
    const minYear = maxYear - 9;
    const out: { year: number; deaths: number; events: number }[] = [];
    for (let y = minYear; y <= maxYear; y += 1) {
      out.push(byYear.get(y) ?? { year: y, deaths: 0, events: 0 });
    }
    return out;
  }, [historySeries]);

  const yearlyClassificationForLastTen = useMemo(() => {
    if (yearlyForLastTen.length === 0) return [];
    const population = Number(selectedProps?.pop_count ?? 0);
    return yearlyForLastTen.map((point) => {
      const yearlyClass = classifyFromCounts(Number(point.deaths ?? 0), Number(point.events ?? 0), population);
      return {
        year: point.year,
        classification: yearlyClass,
        label: STATUS_LABEL_BY_CODE[yearlyClass],
        color: STATUS_COLOR_BY_CODE[yearlyClass],
      };
    });
  }, [yearlyForLastTen, selectedProps]);

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
            <label className="text-xs font-medium text-gray-600 block mb-1">Admin Level</label>
            <div className="grid grid-cols-1 gap-1">
              <button
                type="button"
                onClick={() => handleLevelChange(1)}
                className={`text-xs rounded border px-2 py-1.5 text-left ${
                  adminLevel === 1 ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-700'
                }`}
              >
                Regions
              </button>
              <button
                type="button"
                onClick={() => handleLevelChange(2)}
                className={`text-xs rounded border px-2 py-1.5 text-left ${
                  adminLevel === 2 ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-700'
                }`}
              >
                Zones
              </button>
              <button
                type="button"
                onClick={() => handleLevelChange(3)}
                className={`text-xs rounded border px-2 py-1.5 text-left ${
                  adminLevel === 3 ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-700'
                }`}
              >
                Woredas
              </button>
            </div>
          </div>

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
            analysisType={analysisType}
            trajectoryCategories={trajectoryCategories}
            startYear={startYear}
            startMonth={startMonth}
            endYear={endYear}
            endMonth={endMonth}
            rateThresh={2}
            absThresh={10}
            parentPcode={parentPcode}
            parentLevel={parentLevel}
            regionPcode={drillState?.pcode || undefined}
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
                  <p className="text-lg font-semibold text-gray-900">{monthlyFromSelectedPeriod.length.toLocaleString()}</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyFromSelectedPeriod} margin={{ top: 18, right: 10, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ececec" />
                      <XAxis dataKey="period" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        label={{ value: 'Fatalities', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#6b7280' } }}
                      />
                      <Tooltip />
                      <Bar dataKey="deaths" fill="#dc2626" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="h-64">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={monthlyFromSelectedPeriod} margin={{ top: 18, right: 10, bottom: 8, left: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ececec" />
                      <XAxis dataKey="period" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        label={{ value: 'Events', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#6b7280' } }}
                      />
                      <Tooltip />
                      <Bar dataKey="events" fill="#2563eb" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={yearlyForLastTen} margin={{ top: 18, right: 16, bottom: 8, left: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ececec" />
                      <XAxis dataKey="year" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis
                        yAxisId="left"
                        tick={{ fontSize: 10 }}
                        label={{ value: 'Fatalities', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#6b7280' } }}
                      />
                      <YAxis
                        yAxisId="right"
                        orientation="right"
                        tick={{ fontSize: 10 }}
                        label={{ value: 'Events', angle: 90, position: 'insideRight', style: { fontSize: 11, fill: '#6b7280' } }}
                      />
                      <Tooltip />
                      <Line yAxisId="left" type="monotone" dataKey="deaths" stroke="#dc2626" strokeWidth={2} dot />
                      <Line yAxisId="right" type="monotone" dataKey="events" stroke="#2563eb" strokeWidth={2} dot />
                    </LineChart>
                  </ResponsiveContainer>
                </div>

                <div className="h-72">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={yearlyClassificationForLastTen} margin={{ top: 18, right: 16, bottom: 8, left: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ececec" />
                      <XAxis dataKey="year" tick={{ fontSize: 10 }} interval="preserveStartEnd" />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        domain={[0, 3]}
                        ticks={[0, 1, 2, 3]}
                        tickFormatter={(value) => STATUS_LABEL_BY_CODE[value as ClassificationCode] ?? ''}
                        width={145}
                      />
                      <Tooltip
                        formatter={(value: number) => {
                          const code = Number(value) as ClassificationCode;
                          return [STATUS_LABEL_BY_CODE[code] ?? 'Unknown', 'Classification'];
                        }}
                        labelFormatter={(value) => `Year: ${value}`}
                      />
                      <Line
                        type="linear"
                        dataKey="classification"
                        stroke="#334155"
                        strokeWidth={2}
                        dot={(props) => {
                          const payload = props.payload as { color: string };
                          return (
                            <circle
                              cx={props.cx}
                              cy={props.cy}
                              r={4}
                              fill={payload?.color ?? '#64748b'}
                              stroke="#ffffff"
                              strokeWidth={1}
                            />
                          );
                        }}
                        activeDot={{ r: 5 }}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
