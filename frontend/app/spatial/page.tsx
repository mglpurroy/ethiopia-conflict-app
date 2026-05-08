'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Layers, Map as MapIcon, Search, Sparkles, TrendingUp } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, BarChart, Bar } from 'recharts';

import ReactMarkdown from 'react-markdown';

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
  'LT Conflict',
  'Escalation',
  'LT High Conflict',
  'Decreasing Conflict',
  'Recovery',
  'Below threshold',
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
  0: 'Below threshold',
  1: 'Below threshold',
  2: 'Conflict-Affected',
  3: 'Highly Conflict-Affected',
};

const STATUS_COLOR_BY_CODE: Record<ClassificationCode, string> = {
  0: '#f59e0b',
  1: '#f59e0b',
  2: '#ef4444',
  3: '#b91c1c',
};


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
  const [showWbProjects, setShowWbProjects] = useState(true);
  const [showPsnp, setShowPsnp] = useState(false);
  const [show3R4CACE, setShow3R4CACE] = useState(false);
  const [wbStatusFilter, setWbStatusFilter] = useState<string[]>(['Active']);
  const [trajectoryCategories, setTrajectoryCategories] = useState<string[]>(TRAJECTORY_OPTIONS);

  const [drillState, setDrillState] = useState<{ pcode: string; name: string } | null>(null);
  const [drillZone, setDrillZone] = useState<{ pcode: string; name: string } | null>(null);

  const [selectedProps, setSelectedProps] = useState<Record<string, any> | null>(null);
  const [unitHistory, setUnitHistory] = useState<UnitHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [aiSummary, setAiSummary] = useState<{ summary: string; generated_at: string; event_count: number } | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [aiSummaryError, setAiSummaryError] = useState<string | null>(null);
  const [trajectoryLabel, setTrajectoryLabel] = useState<string | null>(null);
  const [periodSeries, setPeriodSeries] = useState<{ period: string; classification: number; classification_label: string; deaths: number; events: number }[]>([]);

  type WbProject = {
    proj_id: string; name: string; status: string; practice: string;
    approval_fy: number | null; commitment_amt: number | null;
    location_count: number; locations: string[]; objective: string;
  };
  const [wbUnitProjects, setWbUnitProjects] = useState<WbProject[]>([]);
  const [wbUnitLoading, setWbUnitLoading] = useState(false);

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

  useEffect(() => {
    if (!selectedProps || !selectedPeriod) {
      setAiSummary(null);
      setAiSummaryError(null);
      return;
    }
    const clickedLevel = (selectedProps._clickedLevel ?? adminLevel) as AdminLevel;
    const name = getUnitName(selectedProps, clickedLevel);

    setAiSummaryLoading(true);
    setAiSummary(null);
    setAiSummaryError(null);
    api
      .unitSummary({
        level: clickedLevel,
        name,
        start_year: selectedPeriod.start_year,
        start_month: selectedPeriod.start_month,
        end_year: selectedPeriod.end_year,
        end_month: selectedPeriod.end_month,
      })
      .then((d) => setAiSummary(d))
      .catch((e) => setAiSummaryError(e instanceof Error ? e.message : 'Failed to load AI summary'))
      .finally(() => setAiSummaryLoading(false));
  }, [selectedProps, selectedPeriod, adminLevel]);

  useEffect(() => {
    if (!selectedProps) {
      setTrajectoryLabel(null);
      setPeriodSeries([]);
      return;
    }
    const clickedLevel = (selectedProps._clickedLevel ?? adminLevel) as AdminLevel;
    const pcode = getPcode(selectedProps, clickedLevel);
    const level = clickedLevel === 1 ? 'ADM1' : clickedLevel === 2 ? 'ADM2' : 'ADM3';
    api.trendsLocation({ pcode, level, lookback_periods: 20 }).then((r) => {
      setTrajectoryLabel(r.trajectory);
      setPeriodSeries((r as any).series ?? []);
    }).catch(() => { setTrajectoryLabel(null); setPeriodSeries([]); });
  }, [selectedProps, adminLevel]);

  useEffect(() => {
    if (!selectedProps || !showWbProjects) {
      setWbUnitProjects([]);
      return;
    }
    const clickedLevel = (selectedProps._clickedLevel ?? adminLevel) as AdminLevel;
    const name = getUnitName(selectedProps, clickedLevel);
    setWbUnitLoading(true);
    api.wbProjectsByUnit(clickedLevel, name)
      .then(setWbUnitProjects)
      .catch(() => setWbUnitProjects([]))
      .finally(() => setWbUnitLoading(false));
  }, [selectedProps, adminLevel, showWbProjects]);

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

  // Trend API uses 0=Below threshold, 1=Conflict-Affected, 2=Highly Conflict-Affected
  const TREND_LABEL: Record<number, string> = { 0: 'Below threshold', 1: 'Conflict-Affected', 2: 'Highly Conflict-Affected' };
  const TREND_COLOR: Record<number, string> = { 0: '#f59e0b', 1: '#ef4444', 2: '#b91c1c' };

  const periodClassificationSeries = useMemo(() => {
    if (periodSeries.length === 0) return [];
    return periodSeries.map((p) => ({
      period: p.period,
      classification: p.classification,
      label: TREND_LABEL[p.classification] ?? p.classification_label,
      color: TREND_COLOR[p.classification] ?? '#f59e0b',
    }));
  }, [periodSeries]);

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
                onClick={() => {
                  setAnalysisType('trajectory');
                  setAdminLevel(3);
                  setDrillState(null);
                  setDrillZone(null);
                  setSelectedProps(null);
                }}
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
            <div className="flex items-center gap-2">
              <input
                id="show-wb-projects"
                type="checkbox"
                checked={showWbProjects}
                onChange={(e) => setShowWbProjects(e.target.checked)}
                className="accent-[#56b4e9]"
              />
              <label htmlFor="show-wb-projects" className="text-xs font-medium text-gray-600 cursor-pointer">
                Show WB project sites
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="show-psnp"
                type="checkbox"
                checked={showPsnp}
                onChange={(e) => setShowPsnp(e.target.checked)}
                className="accent-[#cc79a7]"
              />
              <label htmlFor="show-psnp" className="text-xs font-medium text-gray-600 cursor-pointer">
                Show PSNP woredas
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="show-3r4cace"
                type="checkbox"
                checked={show3R4CACE}
                onChange={(e) => setShow3R4CACE(e.target.checked)}
                className="accent-[#009e73]"
              />
              <label htmlFor="show-3r4cace" className="text-xs font-medium text-gray-600 cursor-pointer">
                Show 3R4CACE woredas
              </label>
            </div>
            {showWbProjects && (
              <div className="ml-5 space-y-1">
                {(['Active', 'Closed', 'Other'] as const).map((status) => {
                  const colors: Record<string, string> = { Active: '#56b4e9', Closed: '#999999', Other: '#e69f00' };
                  return (
                    <div key={status} className="flex items-center gap-1.5">
                      <input
                        id={`wb-status-${status}`}
                        type="checkbox"
                        checked={wbStatusFilter.includes(status)}
                        onChange={(e) =>
                          setWbStatusFilter((prev) =>
                            e.target.checked ? [...prev, status] : prev.filter((s) => s !== status),
                          )
                        }
                        className="accent-[#56b4e9]"
                      />
                      <div className="w-2.5 h-2.5 shrink-0 border border-white shadow-sm" style={{ background: colors[status], transform: 'rotate(45deg)' }} />
                      <label htmlFor={`wb-status-${status}`} className="text-xs text-gray-500 cursor-pointer">{status}</label>
                    </div>
                  );
                })}
              </div>
            )}
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
            showWbProjects={showWbProjects}
            wbStatusFilter={wbStatusFilter}
            showPsnp={showPsnp}
            show3R4CACE={show3R4CACE}
            onDrillDown={handleDrillDown}
            onUnitClick={(props) => setSelectedProps(props)}
            flyToCoords={flyToCoords}
          />
        </div>
      </div>

      {(selectedProps || historyLoading) && (
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-[#667eea]" />
              <h2 className="text-sm font-semibold text-gray-800">
                {selectedProps ? getUnitName(selectedProps, (selectedProps._clickedLevel ?? adminLevel) as AdminLevel) : 'Loading...'}
              </h2>
            </div>
            {trajectoryLabel && (
              <span className="inline-flex items-center rounded-md bg-gray-100 px-2.5 py-0.5 text-xs font-medium text-gray-700">
                Trajectory: {trajectoryLabel}
              </span>
            )}
          </div>

          {historyLoading && <div className="h-40 bg-gray-100 animate-pulse rounded" />}

          {(aiSummaryLoading || aiSummary || aiSummaryError) && (
            <div className="rounded-lg border border-gray-200 bg-gray-50/50 p-3 mb-4">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="h-4 w-4 text-[#667eea]" />
                <h3 className="text-sm font-semibold text-gray-800">AI Summary</h3>
              </div>
              {aiSummaryLoading && <div className="h-20 bg-gray-100 animate-pulse rounded" />}
              {aiSummaryError && (
                <p className="text-sm text-amber-700">{aiSummaryError}</p>
              )}
              {!aiSummaryLoading && aiSummary && (
                <>
                  <div className="text-sm text-gray-700 space-y-1.5">
                    <ReactMarkdown
                      components={{
                        h1: ({ children }) => <p className="text-sm font-bold text-gray-900 mt-3 mb-1">{children}</p>,
                        h2: ({ children }) => <p className="text-sm font-semibold text-gray-900 mt-3 mb-1">{children}</p>,
                        h3: ({ children }) => <p className="text-xs font-semibold text-gray-800 mt-2 mb-0.5">{children}</p>,
                        p:  ({ children }) => <p className="leading-relaxed">{children}</p>,
                        strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
                        ul: ({ children }) => <ul className="list-disc pl-4 space-y-0.5">{children}</ul>,
                        ol: ({ children }) => <ol className="list-decimal pl-4 space-y-0.5">{children}</ol>,
                        li: ({ children }) => <li className="leading-snug">{children}</li>,
                        hr: () => <hr className="border-gray-200 my-2" />,
                        em: ({ children }) => <em className="italic">{children}</em>,
                      }}
                    >
                      {aiSummary.summary}
                    </ReactMarkdown>
                  </div>
                  <p className="text-xs text-gray-500 mt-2">
                    AI-generated · Based on ACLED data · Verify before operational use
                    {aiSummary.event_count > 0 && ` · ${aiSummary.event_count.toLocaleString()} events`}
                  </p>
                </>
              )}
            </div>
          )}

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
                    <LineChart data={periodClassificationSeries} margin={{ top: 18, right: 16, bottom: 8, left: 6 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#ececec" />
                      <XAxis dataKey="period" tick={{ fontSize: 9 }} interval="preserveStartEnd" />
                      <YAxis
                        tick={{ fontSize: 10 }}
                        domain={[0, 2]}
                        ticks={[0, 1, 2]}
                        tickFormatter={(value) => TREND_LABEL[value as number] ?? ''}
                        width={145}
                      />
                      <Tooltip
                        formatter={(value: number | undefined) => {
                          if (value === undefined) return ['Unknown', 'Classification'];
                          return [TREND_LABEL[Number(value)] ?? 'Unknown', 'Classification'];
                        }}
                        labelFormatter={(value) => `Period: ${value}`}
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

      {showWbProjects && selectedProps && (
        <div className="bg-white rounded-lg shadow-sm p-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-3 h-3 shrink-0 border border-white shadow-sm" style={{ background: '#009fda', transform: 'rotate(45deg)' }} />
            <h2 className="font-semibold text-sm text-gray-800">
              WB Projects — {getUnitName(selectedProps, (selectedProps._clickedLevel ?? adminLevel) as AdminLevel)}
            </h2>
            {wbUnitLoading && <span className="text-xs text-gray-400 ml-1">Loading…</span>}
          </div>

          {!wbUnitLoading && wbUnitProjects.length === 0 && (
            <p className="text-xs text-gray-400">No WB project sites recorded for this unit.</p>
          )}

          {wbUnitProjects.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-50 text-left">
                    <th className="px-2 py-1.5 font-medium text-gray-600 border-b border-gray-200">Project</th>
                    <th className="px-2 py-1.5 font-medium text-gray-600 border-b border-gray-200">Status</th>
                    <th className="px-2 py-1.5 font-medium text-gray-600 border-b border-gray-200">Practice Area</th>
                    <th className="px-2 py-1.5 font-medium text-gray-600 border-b border-gray-200 text-right">FY</th>
                    <th className="px-2 py-1.5 font-medium text-gray-600 border-b border-gray-200 text-right">Commitment</th>
                    <th className="px-2 py-1.5 font-medium text-gray-600 border-b border-gray-200">Sites</th>
                  </tr>
                </thead>
                <tbody>
                  {wbUnitProjects.map((p) => {
                    const statusColor = p.status === 'Active' ? '#009fda' : p.status === 'Closed' ? '#888' : '#f59e0b';
                    const commitment = p.commitment_amt == null ? '—'
                      : p.commitment_amt >= 1_000_000_000
                        ? `$${(p.commitment_amt / 1_000_000_000).toFixed(1)}B`
                        : `$${Math.round(p.commitment_amt / 1_000_000)}M`;
                    return (
                      <tr key={`${p.proj_id}-${p.locations[0]}`} className="border-b border-gray-100 hover:bg-gray-50" title={p.objective || undefined}>
                        <td className="px-2 py-1.5 max-w-[200px]">
                          <p className="font-medium text-gray-800 truncate">{p.name || p.proj_id}</p>
                          <p className="text-gray-400 text-[10px]">{p.proj_id}</p>
                        </td>
                        <td className="px-2 py-1.5">
                          <span className="font-semibold" style={{ color: statusColor }}>{p.status || '—'}</span>
                        </td>
                        <td className="px-2 py-1.5 text-gray-600 max-w-[160px] truncate">{p.practice || '—'}</td>
                        <td className="px-2 py-1.5 text-right text-gray-600">{p.approval_fy ? `FY${p.approval_fy}` : '—'}</td>
                        <td className="px-2 py-1.5 text-right font-mono text-gray-700">{commitment}</td>
                        <td className="px-2 py-1.5 text-gray-500">
                          <span title={p.locations.join(', ')}>{p.location_count} site{p.location_count !== 1 ? 's' : ''}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
