'use client';

import dynamic from 'next/dynamic';
import { useState, useEffect, useCallback } from 'react';
import { Layers, Map as MapIcon, Info, X, TrendingUp, ChevronRight } from 'lucide-react';
import type { DrillEvent } from '@/components/map/ConflictMap';
import { api } from '@/lib/api';
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
  Legend,
} from 'recharts';

const ConflictMap = dynamic(() => import('@/components/map/ConflictMap'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-gray-100 rounded-lg">
      <div className="text-gray-500 text-sm">Loading map…</div>
    </div>
  ),
});

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

type AdminLevel = 1 | 2 | 3;
type MapVariable = 'deaths' | 'ward_share' | 'rate';

const LEVEL_LABELS: Record<AdminLevel, string> = { 1: 'State', 2: 'LGA', 3: 'Ward' };

const VARIABLE_OPTIONS: Record<AdminLevel, { value: MapVariable; label: string }[]> = {
  1: [
    { value: 'deaths', label: 'Total Deaths' },
    { value: 'ward_share', label: '% Wards Affected' },
  ],
  2: [
    { value: 'deaths', label: 'Total Deaths' },
    { value: 'ward_share', label: '% Wards Affected' },
  ],
  3: [
    { value: 'deaths', label: 'Deaths / Ward' },
    { value: 'rate', label: 'Death Rate /100k' },
  ],
};

interface MonthlyPoint {
  year: number;
  month: number;
  period: string;
  deaths: number;
  events: number;
}

interface EventTypePoint {
  event_type: string;
  deaths: number;
  events: number;
}

interface ActorPoint {
  actor: string;
  deaths: number;
  events: number;
}

interface UnitHistory {
  unit: string;
  pcode: string;
  level: number;
  monthly: MonthlyPoint[];
  by_type: EventTypePoint[];
  top_actors: ActorPoint[];
  actor_timelines: Record<string, { period: string; deaths: number }[]>;
  total_deaths: number;
  total_events: number;
}

function getBreadcrumb(props: Record<string, any>, level: AdminLevel): string {
  if (level === 1) return `Nigeria › ${props.ADM1_EN ?? props.ADM1_PCODE ?? ''}`;
  if (level === 2) return `${props.ADM1_EN ?? ''} › ${props.ADM2_EN ?? props.ADM2_PCODE ?? ''}`;
  return `${props.ADM1_EN ?? ''} › ${props.ADM2_EN ?? ''} › ${props.ADM3_EN ?? props.ADM3_PCODE ?? ''}`;
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

type Frequency = 'monthly' | 'quarterly' | 'yearly';

/** Fill every month between first and last data point with 0 where missing. */
function fillGaps(monthly: MonthlyPoint[]): MonthlyPoint[] {
  if (monthly.length === 0) return [];
  const sorted = [...monthly].sort((a, b) =>
    a.year !== b.year ? a.year - b.year : a.month - b.month,
  );
  const existing = new Map(sorted.map((p) => [p.period, p]));
  const { year: y0, month: m0 } = sorted[0];
  const { year: yN, month: mN } = sorted[sorted.length - 1];
  const result: MonthlyPoint[] = [];
  let y = y0, m = m0;
  while (y < yN || (y === yN && m <= mN)) {
    const period = `${y}-${String(m).padStart(2, '0')}`;
    result.push(existing.get(period) ?? { year: y, month: m, period, deaths: 0, events: 0 });
    if (++m > 12) { m = 1; y++; }
  }
  return result;
}

/** Aggregate filled monthly data into quarters or years. */
function aggregate(data: MonthlyPoint[], freq: Frequency): MonthlyPoint[] {
  if (freq === 'monthly') return data;
  const buckets = new Map<string, MonthlyPoint>();
  for (const p of data) {
    const key =
      freq === 'yearly'
        ? String(p.year)
        : `${p.year}-Q${Math.ceil(p.month / 3)}`;
    if (!buckets.has(key)) {
      buckets.set(key, { year: p.year, month: p.month, period: key, deaths: 0, events: 0 });
    }
    const b = buckets.get(key)!;
    b.deaths += p.deaths;
    b.events += p.events;
  }
  return Array.from(buckets.values());
}

function tickInterval(n: number): number {
  if (n <= 30) return 0;   // show all
  if (n <= 60) return 3;
  if (n <= 120) return 5;
  if (n <= 240) return 11;
  return 23;
}

export default function SpatialPage() {
  const [adminLevel, setAdminLevel] = useState<AdminLevel>(1);
  const [variable, setVariable] = useState<MapVariable>('deaths');
  const [affectedOnly, setAffectedOnly] = useState(false);
  const [showEvents, setShowEvents] = useState(false);
  const [showWbProjects, setShowWbProjects] = useState(false);
  const [wbStatusFilter, setWbStatusFilter] = useState<string[]>(['Active']);
  const [rateThresh, setRateThresh] = useState(10);
  const [absThresh, setAbsThresh] = useState(5);
  const [aggThresh, setAggThresh] = useState(0.1);
  const [startYear, setStartYear] = useState(2023);
  const [startMonth, setStartMonth] = useState(1);
  const [endYear, setEndYear] = useState(2025);
  const [endMonth, setEndMonth] = useState(12);

  // Drill-down context
  const [drillState, setDrillState] = useState<{ pcode: string; name: string } | null>(null);
  const [drillLGA,   setDrillLGA]   = useState<{ pcode: string; name: string } | null>(null);

  const parentPcode =
    adminLevel === 3 && drillLGA   ? drillLGA.pcode   :
    adminLevel === 2 && drillState ? drillState.pcode  : '';

  const [selectedProps, setSelectedProps] = useState<Record<string, any> | null>(null);
  const [unitHistory, setUnitHistory] = useState<UnitHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [historyTab, setHistoryTab] = useState<'trend' | 'actors' | 'summary'>('trend');
  const [selectedActorInPanel, setSelectedActorInPanel] = useState<string | null>(null);
  const [unitSummary, setUnitSummary] = useState<{ summary: string; generated_at: string; event_count: number } | null>(null);

  type WbProject = {
    proj_id: string; name: string; status: string; practice: string;
    approval_fy: number | null; commitment_amt: number | null;
    location_count: number; locations: string[]; objective: string;
  };
  const [wbUnitProjects, setWbUnitProjects] = useState<WbProject[]>([]);
  const [wbUnitLoading, setWbUnitLoading] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const handleLevelChange = (l: AdminLevel) => {
    setAdminLevel(l);
    setDrillState(null);
    setDrillLGA(null);
    setSelectedProps(null);
    const opts = VARIABLE_OPTIONS[l];
    if (!opts.find((o) => o.value === variable)) {
      setVariable(opts[0].value);
    }
  };

  const handleDrillDown = useCallback(({ level, pcode, name }: DrillEvent) => {
    if (level === 1) {
      setDrillState({ pcode, name });
      setDrillLGA(null);
      setAdminLevel(2);
      // keep variable valid for level 2
      if (!VARIABLE_OPTIONS[2].find((o) => o.value === variable)) {
        setVariable(VARIABLE_OPTIONS[2][0].value);
      }
    } else {
      setDrillLGA({ pcode, name });
      setAdminLevel(3);
      if (!VARIABLE_OPTIONS[3].find((o) => o.value === variable)) {
        setVariable(VARIABLE_OPTIONS[3][0].value);
      }
    }
    // Do NOT clear selectedProps here — the map will fire onUnitClick with
    // the clicked feature, opening the history panel for the drilled unit.
  }, [variable]);

  const resetDrill = useCallback(() => {
    setDrillState(null);
    setDrillLGA(null);
    setAdminLevel(1);
    setSelectedProps(null);
    const opts = VARIABLE_OPTIONS[1];
    if (!opts.find((o) => o.value === variable)) setVariable(opts[0].value);
  }, [variable]);

  const backToState = useCallback(() => {
    setDrillLGA(null);
    setAdminLevel(2);
    setSelectedProps(null);
  }, []);

  const handleUnitClick = useCallback((props: Record<string, any>) => {
    setSelectedProps(props);
  }, []);

  const fetchSummary = useCallback(() => {
    if (!selectedProps) return;
    const clickedLevel = (selectedProps._clickedLevel ?? adminLevel) as AdminLevel;
    if (clickedLevel > 2) return; // only state / LGA
    const name = getUnitName(selectedProps, clickedLevel);
    setSummaryLoading(true);
    setSummaryError(null);
    setUnitSummary(null);
    api
      .unitSummary({
        level: clickedLevel,
        name,
        start_year: startYear,
        start_month: startMonth,
        end_year: endYear,
        end_month: endMonth,
      })
      .then(setUnitSummary)
      .catch((e: Error) => setSummaryError(e.message ?? 'Failed to generate summary'))
      .finally(() => setSummaryLoading(false));
  }, [selectedProps, adminLevel, startYear, startMonth, endYear, endMonth]);

  // Fetch history whenever a polygon is selected.
  // _clickedLevel is embedded in props when clicking a state/LGA so we use the
  // level of the CLICKED unit, not the level the map transitions to afterward.
  // Fetch conflict history whenever a polygon is selected
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
    setHistoryTab('trend');
    setSelectedActorInPanel(null);
    setUnitSummary(null);
    setSummaryError(null);
    fetch(
      `${BASE_URL}/api/spatial/unit-history?level=${clickedLevel}&pcode=${encodeURIComponent(pcode)}&name=${encodeURIComponent(name)}`,
    )
      .then((r) => r.json())
      .then((d) => setUnitHistory(d))
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [selectedProps, adminLevel]);

  // Fetch WB projects for the selected unit — independent of history
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

  const filledMonthly = unitHistory ? fillGaps(unitHistory.monthly) : [];
  const chartData = aggregate(filledMonthly, frequency);
  const peakMonth = filledMonthly.length
    ? filledMonthly.reduce((a, b) => (b.deaths > a.deaths ? b : a))
    : null;

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-[#667eea] to-[#764ba2] rounded-xl p-4 text-white flex items-center gap-3">
        <MapIcon className="h-5 w-5" />
        <div>
          <h1 className="text-lg font-bold">Spatial Analysis</h1>
          <p className="text-white/80 text-xs">
            Choropleth map — State, LGA, and Ward level conflict data
          </p>
        </div>
      </div>

      {/* Breadcrumb — visible only when drill-down is active */}
      {(drillState || drillLGA) && (
        <div className="bg-white rounded-lg shadow-sm px-4 py-2 flex items-center gap-1.5 text-sm flex-wrap">
          <button onClick={resetDrill} className="text-[#667eea] hover:underline font-medium">
            Nigeria
          </button>
          {drillState && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              {drillLGA ? (
                <button onClick={backToState} className="text-[#667eea] hover:underline font-medium">
                  {drillState.name}
                </button>
              ) : (
                <span className="text-gray-700 font-semibold">{drillState.name}</span>
              )}
            </>
          )}
          {drillLGA && (
            <>
              <ChevronRight className="h-3.5 w-3.5 text-gray-400 shrink-0" />
              <span className="text-gray-700 font-semibold">{drillLGA.name}</span>
            </>
          )}
          <button onClick={resetDrill} className="ml-auto text-gray-400 hover:text-gray-600">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
        {/* Controls */}
        <div className="bg-white rounded-lg shadow-sm p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[#667eea]" />
            <h3 className="font-semibold text-sm">Map Controls</h3>
          </div>

          {/* Admin Level */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Admin Level</label>
            <div className="flex gap-1">
              {([1, 2, 3] as AdminLevel[]).map((l) => (
                <button
                  key={l}
                  onClick={() => handleLevelChange(l)}
                  className={`flex-1 text-xs py-1.5 rounded border transition-colors ${
                    adminLevel === l
                      ? 'bg-[#667eea] text-white border-[#667eea]'
                      : 'border-gray-200 text-gray-600 hover:border-[#667eea]'
                  }`}
                >
                  {LEVEL_LABELS[l]}
                </button>
              ))}
            </div>
          </div>

          {/* Ward-level note */}
          {adminLevel === 3 && (
            <div className="bg-amber-50 border border-amber-200 rounded p-2 flex gap-2 text-xs text-amber-800">
              <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
              <span>
                Ward level renders ~9,400 polygons. Use <strong>Affected Only</strong> for faster
                loading.
              </span>
            </div>
          )}

          {/* Variable */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Variable</label>
            <div className="flex flex-col gap-1">
              {VARIABLE_OPTIONS[adminLevel].map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setVariable(value)}
                  className={`text-xs py-1.5 px-2 rounded border transition-colors text-left ${
                    variable === value
                      ? 'bg-[#667eea] text-white border-[#667eea]'
                      : 'border-gray-200 text-gray-600 hover:border-[#667eea]'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Affected-only toggle — ward level only */}
          {adminLevel === 3 && (
            <div className="flex items-center gap-2">
              <input
                id="affected-only"
                type="checkbox"
                checked={affectedOnly}
                onChange={(e) => setAffectedOnly(e.target.checked)}
                className="accent-[#667eea]"
              />
              <label htmlFor="affected-only" className="text-xs font-medium text-gray-600 cursor-pointer">
                Affected wards only
              </label>
            </div>
          )}

          {/* Period */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">Period</label>
            <div className="grid grid-cols-2 gap-1">
              {[
                { label: 'Start Year', value: startYear, set: setStartYear },
                { label: 'Start Month', value: startMonth, set: setStartMonth, min: 1, max: 12 },
                { label: 'End Year', value: endYear, set: setEndYear },
                { label: 'End Month', value: endMonth, set: setEndMonth, min: 1, max: 12 },
              ].map(({ label, value, set, min = 1997, max = 2025 }) => (
                <div key={label}>
                  <label className="text-xs text-gray-400">{label}</label>
                  <input
                    type="number"
                    min={min}
                    max={max}
                    value={value}
                    onChange={(e) => set(Number(e.target.value))}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Classification thresholds */}
          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Death Rate Threshold: {rateThresh}/100k
            </label>
            <input
              type="range"
              min="1"
              max="50"
              value={rateThresh}
              onChange={(e) => setRateThresh(Number(e.target.value))}
              className="w-full accent-[#667eea]"
            />
          </div>

          <div>
            <label className="text-xs font-medium text-gray-600 block mb-1">
              Min Deaths Threshold: {absThresh}
            </label>
            <input
              type="range"
              min="1"
              max="50"
              value={absThresh}
              onChange={(e) => setAbsThresh(Number(e.target.value))}
              className="w-full accent-[#667eea]"
            />
          </div>

          {adminLevel !== 3 && (
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">
                Ward Share Threshold: {(aggThresh * 100).toFixed(0)}%
              </label>
              <input
                type="range"
                min="0.02"
                max="0.5"
                step="0.01"
                value={aggThresh}
                onChange={(e) => setAggThresh(Number(e.target.value))}
                className="w-full accent-[#667eea]"
              />
            </div>
          )}

          {/* Overlays */}
          <div className="space-y-2 pt-1 border-t border-gray-100">
            <div className="flex items-center gap-2">
              <input
                id="show-events"
                type="checkbox"
                checked={showEvents}
                onChange={(e) => setShowEvents(e.target.checked)}
                className="accent-[#667eea]"
              />
              <label htmlFor="show-events" className="text-xs font-medium text-gray-600 cursor-pointer">
                Show ACLED events
              </label>
            </div>
            <div className="flex items-center gap-2">
              <input
                id="show-wb-projects"
                type="checkbox"
                checked={showWbProjects}
                onChange={(e) => setShowWbProjects(e.target.checked)}
                className="accent-[#009fda]"
              />
              <label htmlFor="show-wb-projects" className="text-xs font-medium text-gray-600 cursor-pointer">
                Show WB project sites
              </label>
            </div>
            {showWbProjects && (
              <div className="ml-5 space-y-1">
                {(['Active', 'Closed', 'Other'] as const).map((status) => {
                  const colors: Record<string, string> = {
                    Active: '#009fda',
                    Closed: '#888888',
                    Other: '#f59e0b',
                  };
                  return (
                    <div key={status} className="flex items-center gap-1.5">
                      <input
                        id={`wb-status-${status}`}
                        type="checkbox"
                        checked={wbStatusFilter.includes(status)}
                        onChange={(e) =>
                          setWbStatusFilter((prev) =>
                            e.target.checked
                              ? [...prev, status]
                              : prev.filter((s) => s !== status),
                          )
                        }
                        className="accent-[#009fda]"
                      />
                      <div
                        className="w-2.5 h-2.5 shrink-0 border border-white shadow-sm"
                        style={{ background: colors[status], transform: 'rotate(45deg)' }}
                      />
                      <label
                        htmlFor={`wb-status-${status}`}
                        className="text-xs text-gray-500 cursor-pointer"
                      >
                        {status}
                      </label>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Map */}
        <div
          className="lg:col-span-3 bg-white rounded-lg shadow-sm overflow-hidden"
          style={{ height: '70vh' }}
        >
          <ConflictMap
            level={adminLevel}
            variable={variable}
            affectedOnly={affectedOnly}
            parentPcode={parentPcode}
            startYear={startYear}
            startMonth={startMonth}
            endYear={endYear}
            endMonth={endMonth}
            rateThresh={rateThresh}
            absThresh={absThresh}
            aggThresh={aggThresh}
            showEvents={showEvents}
            showWbProjects={showWbProjects}
            wbStatusFilter={wbStatusFilter}
            onUnitClick={handleUnitClick}
            onDrillDown={handleDrillDown}
          />
        </div>
      </div>

      {/* ── History panel ─────────────────────────────────────────────────── */}
      {(selectedProps || historyLoading) && (
        <div className="bg-white rounded-lg shadow-sm p-5">
          {/* Header */}
          <div className="flex items-start justify-between mb-4">
            <div>
              <div className="flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-[#667eea]" />
                <h2 className="font-semibold text-sm text-gray-800">
                  {selectedProps ? getUnitName(selectedProps, (selectedProps._clickedLevel ?? adminLevel) as AdminLevel) : '…'}
                </h2>
              </div>
              {selectedProps && (
                <p className="text-xs text-gray-400 mt-0.5">
                  {getBreadcrumb(selectedProps, (selectedProps._clickedLevel ?? adminLevel) as AdminLevel)}
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              {/* Aggregation toggle */}
              <div className="flex rounded border border-gray-200 overflow-hidden">
                {(['monthly', 'quarterly', 'yearly'] as Frequency[]).map((f) => (
                  <button
                    key={f}
                    onClick={() => setFrequency(f)}
                    className={`text-xs px-2.5 py-1 transition-colors ${
                      frequency === f
                        ? 'bg-[#667eea] text-white'
                        : 'text-gray-500 hover:bg-gray-50'
                    }`}
                  >
                    {f.charAt(0).toUpperCase() + f.slice(1)}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setSelectedProps(null)}
                className="text-gray-400 hover:text-gray-600 transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          {historyLoading && (
            <div className="text-sm text-gray-400 py-8 text-center">Loading history…</div>
          )}

          {unitHistory && !historyLoading && (
            <>
              {/* KPI strip */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                {[
                  { label: 'Total Deaths (all time)', value: unitHistory.total_deaths.toLocaleString() },
                  { label: 'Total Events (all time)', value: unitHistory.total_events > 0 ? unitHistory.total_events.toLocaleString() : '—' },
                  { label: 'Peak Month', value: peakMonth ? peakMonth.period : '—' },
                  { label: 'Peak Deaths', value: peakMonth ? peakMonth.deaths.toLocaleString() : '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="bg-gray-50 rounded-lg p-3">
                    <p className="text-xs text-gray-500">{label}</p>
                    <p className="text-lg font-bold text-gray-800 mt-0.5">{value}</p>
                  </div>
                ))}
              </div>

              {/* Tab bar */}
              {(() => {
                const clickedLevel = (selectedProps?._clickedLevel ?? adminLevel) as AdminLevel;
                return (
                  <div className="flex rounded border border-gray-200 overflow-hidden w-fit mb-4">
                    {(['trend', 'actors'] as const).map((tab) => (
                      <button
                        key={tab}
                        onClick={() => { setHistoryTab(tab); setSelectedActorInPanel(null); }}
                        className={`text-xs px-3 py-1.5 capitalize transition-colors ${
                          historyTab === tab ? 'bg-[#667eea] text-white' : 'text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        {tab === 'trend' ? 'Trend' : `Actors${unitHistory.top_actors.length ? ` (${unitHistory.top_actors.length})` : ''}`}
                      </button>
                    ))}
                    {clickedLevel < 3 && (
                      <button
                        onClick={() => {
                          setHistoryTab('summary');
                          if (!unitSummary && !summaryLoading) fetchSummary();
                        }}
                        className={`text-xs px-3 py-1.5 transition-colors ${
                          historyTab === 'summary' ? 'bg-[#667eea] text-white' : 'text-gray-500 hover:bg-gray-50'
                        }`}
                      >
                        AI Summary
                      </button>
                    )}
                  </div>
                );
              })()}

              {/* ── Trend tab ── */}
              {historyTab === 'trend' && (
                <div className={`grid gap-5 ${unitHistory.by_type.length > 0 ? 'grid-cols-1 lg:grid-cols-3' : 'grid-cols-1'}`}>
                  <div className={unitHistory.by_type.length > 0 ? 'lg:col-span-2' : ''}>
                    <p className="text-xs font-medium text-gray-600 mb-2">
                      Monthly Deaths{adminLevel < 3 ? ' & Events' : ''} (all time)
                    </p>
                    {chartData.length === 0 ? (
                      <p className="text-xs text-gray-400 py-4">No data available.</p>
                    ) : (
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="period" tick={{ fontSize: 10 }} interval={tickInterval(chartData.length)} />
                          <YAxis tick={{ fontSize: 10 }} width={36} />
                          <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: any, name: string | undefined) => [Number(v).toLocaleString(), name ?? '']} />
                          <Area type="monotone" dataKey="deaths" stroke="#d73027" fill="#d73027" fillOpacity={0.15} strokeWidth={1.5} name="Deaths" dot={false} />
                          {adminLevel < 3 && (
                            <Area type="monotone" dataKey="events" stroke="#667eea" fill="#667eea" fillOpacity={0.1} strokeWidth={1.5} name="Events" dot={false} />
                          )}
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  {unitHistory.by_type.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-2">Deaths by Event Type</p>
                      <ResponsiveContainer width="100%" height={200}>
                        <BarChart data={unitHistory.by_type} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10 }} />
                          <YAxis dataKey="event_type" type="category" width={110} tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: any) => [Number(v).toLocaleString(), 'Deaths']} />
                          <Bar dataKey="deaths" fill="#d73027" radius={[0, 3, 3, 0]} name="Deaths" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              )}

              {/* ── Summary tab ── */}
              {historyTab === 'summary' && (
                <div className="space-y-3">
                  {summaryLoading && (
                    <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center">
                      <span className="animate-spin inline-block">⟳</span> Generating summary…
                    </div>
                  )}
                  {summaryError && (
                    <div className="text-sm text-red-500 bg-red-50 rounded p-3">{summaryError}</div>
                  )}
                  {unitSummary && !summaryLoading && (
                    <>
                      <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                        <span>⚠</span>
                        <span>AI-generated analysis · Based on ACLED data · Verify before operational use</span>
                      </div>
                      <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-lg p-4">
                        {unitSummary.summary}
                      </div>
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>
                          Based on {unitSummary.event_count.toLocaleString()} events · Generated{' '}
                          {new Date(unitSummary.generated_at).toLocaleTimeString()}
                        </span>
                        <button onClick={fetchSummary} className="text-[#667eea] hover:underline">
                          Regenerate
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Actors tab ── */}
              {historyTab === 'actors' && (
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  {/* Ranked actor list */}
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-2">Top actors by deaths (all time)</p>
                    {unitHistory.top_actors.length === 0 ? (
                      <p className="text-xs text-gray-400">No actor data available.</p>
                    ) : (
                      <div className="space-y-1">
                        {unitHistory.top_actors.map((a, i) => {
                          const maxDeaths = unitHistory.top_actors[0].deaths || 1;
                          const isSelected = selectedActorInPanel === a.actor;
                          return (
                            <button
                              key={a.actor}
                              onClick={() => setSelectedActorInPanel(isSelected ? null : a.actor)}
                              className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${isSelected ? 'bg-indigo-50 ring-1 ring-[#667eea]' : 'hover:bg-gray-50'}`}
                            >
                              <span className="text-xs text-gray-400 w-4 shrink-0">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-gray-800 truncate">{a.actor}</p>
                                <div className="h-1.5 bg-gray-100 rounded mt-1 overflow-hidden">
                                  <div
                                    className="h-full rounded transition-all"
                                    style={{
                                      width: `${(a.deaths / maxDeaths) * 100}%`,
                                      background: isSelected ? '#667eea' : '#d73027',
                                    }}
                                  />
                                </div>
                              </div>
                              <span className="text-xs font-mono text-gray-600 shrink-0">{a.deaths.toLocaleString()}</span>
                              <span className="text-xs text-gray-400 shrink-0">{a.events}ev</span>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>

                  {/* Actor timeline — shown when one is selected */}
                  <div>
                    {selectedActorInPanel && unitHistory.actor_timelines[selectedActorInPanel] ? (
                      <>
                        <p className="text-xs font-medium text-gray-600 mb-2 truncate">
                          Timeline: <span className="text-[#667eea]">{selectedActorInPanel}</span>
                        </p>
                        <ResponsiveContainer width="100%" height={220}>
                          <AreaChart
                            data={unitHistory.actor_timelines[selectedActorInPanel]}
                            margin={{ top: 4, right: 8, left: 0, bottom: 0 }}
                          >
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="period" tick={{ fontSize: 9 }} interval={tickInterval(unitHistory.actor_timelines[selectedActorInPanel].length)} />
                            <YAxis tick={{ fontSize: 10 }} width={36} />
                            <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: any) => [Number(v).toLocaleString(), 'Deaths']} />
                            <Area type="monotone" dataKey="deaths" stroke="#667eea" fill="#667eea" fillOpacity={0.15} strokeWidth={1.5} name="Deaths" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </>
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-gray-400 py-12">
                        {unitHistory.top_actors.length > 0
                          ? 'Click an actor to see their activity timeline in this location'
                          : ''}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* ── WB Projects panel ─────────────────────────────────────────────── */}
      {showWbProjects && selectedProps && (
        <div className="bg-white rounded-lg shadow-sm p-5">
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
                    const statusColor =
                      p.status === 'Active' ? '#009fda' :
                      p.status === 'Closed' ? '#888' : '#f59e0b';
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
