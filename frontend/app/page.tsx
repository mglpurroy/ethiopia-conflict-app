'use client';

import dynamic from 'next/dynamic';
import { useState, useCallback, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, List, Settings, Map as MapIcon, Info, AlertTriangle, Activity, Shield, Calendar, ChevronUp, ChevronDown, TrendingUp, X, Clock } from 'lucide-react';
import maplibregl from 'maplibre-gl';
import { useSummary, useAlertStatus, useAlertsSummary, useChanges } from '@/lib/hooks/useAlerts';
import { useByAdmin } from '@/lib/hooks/useConflicts';
import { KpiCard } from '@/components/ui/KpiCard';
import { RagBadge } from '@/components/ui/RagBadge';
import { TrendArrow } from '@/components/ui/TrendArrow';
import { api } from '@/lib/api';
import type { DrillEvent } from '@/components/map/ConflictMap';
import { Tour, type TourStep } from '@/components/ui/Tour';
import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid,
} from 'recharts';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

const ConflictMap = dynamic(() => import('@/components/map/ConflictMap'), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full bg-gray-100 rounded-lg">
      <div className="text-gray-500 text-sm">Loading map…</div>
    </div>
  ),
});

type AdminLevel = 1 | 2 | 3;
type MapVariable = 'deaths' | 'ward_share' | 'rate' | 'events' | 'density';
type SortKey = 'total_deaths_30d' | 'deaths_prior_30d' | 'mom_deaths_pct_change' | 'wb_active' | 'wb_commitment';

const LEVEL_LABELS: Record<AdminLevel, string> = { 1: 'State', 2: 'LGA', 3: 'Ward' };

function getQuarterRange(year: number, q: 1 | 2 | 3 | 4) {
  const starts = [1, 4, 7, 10];
  const ends   = [3, 6, 9, 12];
  const endDay = [31, 30, 30, 31];
  const sm = starts[q - 1];
  const em = ends[q - 1];
  const ed = endDay[q - 1];
  return {
    start: `${year}-${String(sm).padStart(2, '0')}-01`,
    end:   `${year}-${String(em).padStart(2, '0')}-${ed}`,
    label: `Q${q} ${year}`,
  };
}

function getCurrentAndPrevQuarter() {
  const now = new Date();
  const year = now.getFullYear();
  const q = Math.ceil((now.getMonth() + 1) / 3) as 1 | 2 | 3 | 4;
  const prevQ = (q === 1 ? 4 : q - 1) as 1 | 2 | 3 | 4;
  const prevYear = q === 1 ? year - 1 : year;
  return { current: getQuarterRange(year, q), prev: getQuarterRange(prevYear, prevQ) };
}
const VARIABLE_OPTIONS: Record<AdminLevel, { value: MapVariable; label: string }[]> = {
  1: [{ value: 'deaths', label: 'Total Deaths' }, { value: 'ward_share', label: '% Wards Affected' }, { value: 'events', label: 'Event Count' }, { value: 'density', label: 'Death Density' }],
  2: [{ value: 'deaths', label: 'Total Deaths' }, { value: 'ward_share', label: '% Wards Affected' }, { value: 'events', label: 'Event Count' }, { value: 'density', label: 'Death Density' }],
  3: [{ value: 'deaths', label: 'Deaths / Ward' }, { value: 'rate', label: 'Death Rate /100k' }],
};

// ── Unit history types & helpers (mirrors spatial page) ─────────────────────
type Frequency = 'monthly' | 'quarterly' | 'yearly';

interface MonthlyPoint { year: number; month: number; period: string; deaths: number; events: number; }
interface EventTypePoint { event_type: string; deaths: number; events: number; }
interface ActorPoint { actor: string; deaths: number; events: number; }
interface UnitHistory {
  unit: string; pcode: string; level: number;
  monthly: MonthlyPoint[]; by_type: EventTypePoint[]; top_actors: ActorPoint[];
  actor_timelines: Record<string, { period: string; deaths: number }[]>;
  total_deaths: number; total_events: number;
}

function getUnitName(props: Record<string, unknown>, level: AdminLevel): string {
  if (level === 1) return (props.ADM1_EN ?? props.ADM1_PCODE ?? 'Unknown') as string;
  if (level === 2) return (props.ADM2_EN ?? props.ADM2_PCODE ?? 'Unknown') as string;
  return (props.ADM3_EN ?? props.ADM3_PCODE ?? 'Unknown') as string;
}
function getPcode(props: Record<string, unknown>, level: AdminLevel): string {
  if (level === 1) return (props.ADM1_PCODE ?? '') as string;
  if (level === 2) return (props.ADM2_PCODE ?? '') as string;
  return (props.ADM3_PCODE ?? '') as string;
}
function getBreadcrumb(props: Record<string, unknown>, level: AdminLevel): string {
  if (level === 1) return `Nigeria › ${props.ADM1_EN ?? ''}`;
  if (level === 2) return `${props.ADM1_EN ?? ''} › ${props.ADM2_EN ?? ''}`;
  return `${props.ADM1_EN ?? ''} › ${props.ADM2_EN ?? ''} › ${props.ADM3_EN ?? ''}`;
}
function fillGaps(monthly: MonthlyPoint[]): MonthlyPoint[] {
  if (!monthly.length) return [];
  const sorted = [...monthly].sort((a, b) => a.year !== b.year ? a.year - b.year : a.month - b.month);
  const map = new Map(sorted.map((p) => [p.period, p]));
  const { year: y0, month: m0 } = sorted[0];
  const { year: yN, month: mN } = sorted[sorted.length - 1];
  const result: MonthlyPoint[] = [];
  let y = y0, m = m0;
  while (y < yN || (y === yN && m <= mN)) {
    const period = `${y}-${String(m).padStart(2, '0')}`;
    result.push(map.get(period) ?? { year: y, month: m, period, deaths: 0, events: 0 });
    if (++m > 12) { m = 1; y++; }
  }
  return result;
}
function aggregate(data: MonthlyPoint[], freq: Frequency): MonthlyPoint[] {
  if (freq === 'monthly') return data;
  const buckets = new Map<string, MonthlyPoint>();
  for (const p of data) {
    const key = freq === 'yearly' ? String(p.year) : `${p.year}-Q${Math.ceil(p.month / 3)}`;
    if (!buckets.has(key)) buckets.set(key, { year: p.year, month: p.month, period: key, deaths: 0, events: 0 });
    const b = buckets.get(key)!;
    b.deaths += p.deaths; b.events += p.events;
  }
  return Array.from(buckets.values());
}
function tickInterval(n: number): number {
  if (n <= 30) return 0; if (n <= 60) return 3; if (n <= 120) return 5;
  if (n <= 240) return 11; return 23;
}
// ─────────────────────────────────────────────────────────────────────────────

function fmtCommitment(amt: number): string {
  if (amt >= 1_000_000_000) return `$${(amt / 1_000_000_000).toFixed(1)}B`;
  if (amt >= 1_000_000) return `$${Math.round(amt / 1_000_000)}M`;
  if (amt > 0) return `$${Math.round(amt / 1_000)}K`;
  return '—';
}

function SortIcon({ currentKey, thisKey, asc }: { currentKey: SortKey; thisKey: SortKey; asc: boolean }) {
  if (currentKey !== thisKey) return null;
  return asc ? <ChevronUp className="h-3 w-3 inline" /> : <ChevronDown className="h-3 w-3 inline" />;
}

function ThBtn({
  k, children, sortKey, sortAsc, onSort,
}: {
  k: SortKey;
  children: React.ReactNode;
  sortKey: SortKey;
  sortAsc: boolean;
  onSort: (k: SortKey) => void;
}) {
  return (
    <th
      className="px-3 py-2.5 font-semibold text-gray-600 cursor-pointer select-none hover:bg-gray-100 transition-colors text-center"
      onClick={() => onSort(k)}
    >
      {children} <SortIcon currentKey={sortKey} thisKey={k} asc={sortAsc} />
    </th>
  );
}

const TOUR_STEPS: TourStep[] = [
  {
    title: 'Nigeria FCV Monitor — Beta',
    body: 'Built for the World Bank Nigeria country team. Tracks fragility, conflict, and violence using ACLED data (1997–2025) linked to the WB Nigeria portfolio. This tour covers the key features — takes about 90 seconds.',
  },
  {
    target: '[data-tour="kpi-strip"]',
    title: 'Portfolio & Conflict Overview',
    body: 'Top-line metrics for the selected period: conflict events, fatalities, states in the alert zone, and active WB projects. Arrows show quarter-over-quarter change — a red arrow means worsening conditions.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="map-container"]',
    title: 'Conflict Choropleth Map',
    body: 'Units shaded by conflict intensity. Click a state to zoom and switch to LGA view. Click an LGA to drill into wards. Hover any unit for a quick tooltip with event count and fatalities.',
    placement: 'bottom',
  },
  {
    target: '[data-tour="btn-settings"]',
    title: 'Map Settings',
    body: 'Control admin level (State → LGA → Ward), choropleth variable (deaths, rate per 100K, event count, or death density heatmap), and date window. RAG thresholds are configurable for sensitivity tuning.',
    placement: 'right',
  },
  {
    target: '[data-tour="btn-layers"]',
    title: 'Data Layers',
    body: 'Independently toggle conflict coloring, admin boundaries, ACLED event dots (colour-coded by type: Battles, Explosions, VAC, etc.), and World Bank project sites. WB pins can be filtered by project status.',
    placement: 'right',
  },
  {
    title: 'Unit Analysis Panel',
    body: 'Clicking any polygon opens a right-side analysis panel with four tabs: (1) historical trend from 2010, (2) top armed actors with activity timelines, (3) AI-generated FCV brief in WB operational style, and (4) co-located WB projects.',
  },
  {
    target: '[data-tour="btn-events"]',
    title: 'ACLED Event Log',
    body: 'Full searchable list of individual conflict incidents — date, location, type, actors, and fatalities. Auto-filters to the selected state when you click a polygon on the map. Click any event card to fly the map to that location.',
    placement: 'right',
  },
  {
    target: '[data-tour="state-table"]',
    title: 'Dynamic Summary Table',
    body: 'Drills with the map: all 37 states at national level → LGAs within a selected state → wards within a selected LGA. Each level shows a RAG status (states) or current vs prior quarter death comparison (LGA/ward). Ward data is assigned by spatial point-in-polygon join.',
    placement: 'top',
  },
  {
    target: '[data-tour="btn-compare"]',
    title: 'Time-Period Comparison',
    body: 'Split the map into two side-by-side panels to compare conflict intensity across two different periods. Pan or zoom either panel — both maps stay synchronised. Useful for before/after analysis or programme-cycle planning.',
    placement: 'right',
  },
];

export default function HomePage() {
  // Sidebar panels: 'settings' | 'layers' | 'events' | 'compare' | null
  const [openPanel, setOpenPanel] = useState<'settings' | 'layers' | 'events' | 'compare' | null>(null);
  const togglePanel = (panel: 'settings' | 'layers' | 'events' | 'compare') =>
    setOpenPanel((p) => (p === panel ? null : panel));

  // Map state — defaults to State level, deaths, 2024–2025
  const [adminLevel, setAdminLevel] = useState<AdminLevel>(1);
  const [variable, setVariable] = useState<MapVariable>('deaths');
  const [affectedOnly, setAffectedOnly] = useState(false);
  // Data layers — independent toggles
  const [showEvents, setShowEvents] = useState(false);
  const [showWbProjects, setShowWbProjects] = useState(true);
  const [showChoropleth, setShowChoropleth] = useState(true);
  const [showBoundaries, setShowBoundaries] = useState(true);
  const EVENT_TYPES = [
    { label: 'Battles',                    color: '#e31a1c' },
    { label: 'Violence against civilians', color: '#ff7f00' },
    { label: 'Explosions/Remote violence', color: '#6a3d9a' },
    { label: 'Riots',                      color: '#1f78b4' },
    { label: 'Protests',                   color: '#33a02c' },
    { label: 'Other',                      color: '#b15928' },
  ] as const;
  const ALL_EVENT_TYPES = EVENT_TYPES.map((t) => t.label);
  const [activeEventTypes, setActiveEventTypes] = useState<string[]>([...ALL_EVENT_TYPES]);
  const toggleEventType = (label: string) =>
    setActiveEventTypes((prev) =>
      prev.includes(label) ? prev.filter((t) => t !== label) : [...prev, label]);
  const [wbStatus, setWbStatus] = useState<'All' | 'Active' | 'Closed' | 'Other'>('Active');
  const wbStatusFilter = wbStatus === 'All' ? ['Active', 'Closed', 'Other'] : [wbStatus];
  const [rateThresh, setRateThresh] = useState(10);
  const [absThresh, setAbsThresh] = useState(5);
  const [aggThresh, setAggThresh] = useState(0.1);
  const [startYear, setStartYear] = useState(2024);
  const [startMonth, setStartMonth] = useState(1);
  const [endYear, setEndYear] = useState(2025);
  const [endMonth, setEndMonth] = useState(12);

  // Compare mode — default to same quarter, one year ago (year-over-year comparison)
  const [compareMode, setCompareMode] = useState(false);
  const _cmpDefaultQ = (() => {
    const now = new Date();
    const q = Math.ceil((now.getMonth() + 1) / 3) as 1 | 2 | 3 | 4;
    return getQuarterRange(now.getFullYear() - 1, q);
  })();
  const [cmpStartYear,  setCmpStartYear]  = useState(() => Number(_cmpDefaultQ.start.slice(0, 4)));
  const [cmpStartMonth, setCmpStartMonth] = useState(() => Number(_cmpDefaultQ.start.slice(5, 7)));
  const [cmpEndYear,    setCmpEndYear]    = useState(() => Number(_cmpDefaultQ.end.slice(0, 4)));
  const [cmpEndMonth,   setCmpEndMonth]   = useState(() => Number(_cmpDefaultQ.end.slice(5, 7)));
  const mapARef    = useRef<maplibregl.Map | null>(null);
  const mapBRef    = useRef<maplibregl.Map | null>(null);
  const syncingRef = useRef(false);

  const setupSync = useCallback(() => {
    const a = mapARef.current;
    const b = mapBRef.current;
    if (!a || !b) return;
    const syncAtoB = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      b.jumpTo({ center: a.getCenter(), zoom: a.getZoom(), bearing: a.getBearing(), pitch: a.getPitch() });
      syncingRef.current = false;
    };
    const syncBtoA = () => {
      if (syncingRef.current) return;
      syncingRef.current = true;
      a.jumpTo({ center: b.getCenter(), zoom: b.getZoom(), bearing: b.getBearing(), pitch: b.getPitch() });
      syncingRef.current = false;
    };
    a.on('move', syncAtoB);
    b.on('move', syncBtoA);
    b.jumpTo({ center: a.getCenter(), zoom: a.getZoom() });
  }, []);

  // Drill-down
  const [drillState, setDrillState] = useState<{ pcode: string; name: string } | null>(null);
  const [drillLGA, setDrillLGA] = useState<{ pcode: string; name: string } | null>(null);
  const parentPcode =
    adminLevel === 3 && drillLGA ? drillLGA.pcode :
    adminLevel === 2 && drillState ? drillState.pcode : '';

  // Fly-to coords — set when user clicks an event card; map zooms to that point
  const [flyToCoords, setFlyToCoords] = useState<{ lng: number; lat: number } | null>(null);

  // Events panel filters (auto-set on polygon click, manually clearable)
  // eventsStateFilter → sent to API (backend admin1 filter)
  // eventsLgaFilter   → applied client-side for LGA/ward drill-down
  const [eventsStateFilter, setEventsStateFilter] = useState<string | null>(null);
  const [eventsLgaFilter, setEventsLgaFilter] = useState<string | null>(null);

  // Table sort
  const [sortKey, setSortKey] = useState<SortKey>('total_deaths_30d');
  const [sortAsc, setSortAsc] = useState(false);

  // Unit history panel (polygon click)
  const [selectedProps, setSelectedProps] = useState<Record<string, unknown> | null>(null);
  const [unitHistory, setUnitHistory] = useState<UnitHistory | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [frequency, setFrequency] = useState<Frequency>('monthly');
  const [historyTab, setHistoryTab] = useState<'trend' | 'actors' | 'summary'>('trend');
  const [selectedActorInPanel, setSelectedActorInPanel] = useState<string | null>(null);
  const [unitSummary, setUnitSummary] = useState<{ summary: string; generated_at: string; event_count: number } | null>(null);
  const [aiSummaryLoading, setAiSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);
  const [wbUnitProjects, setWbUnitProjects] = useState<{
    proj_id: string; name: string; status: string; practice: string;
    approval_fy: number | null; commitment_amt: number | null;
    location_count: number; locations: string[]; objective: string;
  }[]>([]);
  const [wbUnitLoading, setWbUnitLoading] = useState(false);

  // Onboarding tour
  const [showTour, setShowTour] = useState(false);
  useEffect(() => {
    if (!localStorage.getItem('nigeria-monitor-tour-v1')) setShowTour(true);
  }, []);
  const handleTourFinish = () => {
    localStorage.setItem('nigeria-monitor-tour-v1', '1');
    setShowTour(false);
  };

  // Derived date strings (used for events query and KPI comparison)
  const kpiStart = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  const kpiEnd = `${endYear}-${String(endMonth).padStart(2, '0')}-28`;

  // Quarter-over-quarter comparison for KPI cards
  const { current: currentQ, prev: prevQ } = getCurrentAndPrevQuarter();

  // Data hooks
  const { data: summary, isLoading: summaryLoading } = useSummary();
  const { data: currentPeriodSummary } = useSummary({ start_date: kpiStart, end_date: kpiEnd });
  const { data: currentQSummary } = useSummary({ start_date: currentQ.start, end_date: currentQ.end });
  const { data: prevQSummary } = useSummary({ start_date: prevQ.start, end_date: prevQ.end });
  const { data: alerts } = useAlertStatus();
  const { data: alertSummary } = useAlertsSummary();
  const { data: changes } = useChanges();

  // Sub-state table data — current quarter and previous quarter
  const { data: lgaAdminData } = useByAdmin(
    { level: 2, start: currentQ.start, end: currentQ.end },
    { enabled: adminLevel >= 2 },
  );
  const { data: lgaAdminDataPrev } = useByAdmin(
    { level: 2, start: prevQ.start, end: prevQ.end },
    { enabled: adminLevel >= 2 },
  );
  // Ward data — spatially joined on backend, filtered by parent LGA
  const { data: wardAdminData } = useByAdmin(
    { level: 3, start: currentQ.start, end: currentQ.end, parent: drillLGA?.name },
    { enabled: adminLevel === 3 && !!drillLGA },
  );
  const { data: wardAdminDataPrev } = useByAdmin(
    { level: 3, start: prevQ.start, end: prevQ.end, parent: drillLGA?.name },
    { enabled: adminLevel === 3 && !!drillLGA },
  );
  const { data: wbSummary } = useQuery({
    queryKey: ['wb-state-summary'],
    queryFn: () => api.wbStateSummary(),
    staleTime: 10 * 60 * 1000,
  });

  const eventsStart = `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  const eventsEnd = `${endYear}-${String(endMonth).padStart(2, '0')}-28`;
  const { data: conflictEvents, isLoading: eventsLoading } = useQuery({
    queryKey: ['events-panel', eventsStart, eventsEnd, eventsStateFilter],
    queryFn: () => api.conflicts({
      start: eventsStart,
      end: eventsEnd,
      states: eventsStateFilter ?? undefined,
      limit: 200,
    }),
    staleTime: 5 * 60 * 1000,
    enabled: openPanel === 'events',
  });
  const sortedEvents = conflictEvents
    ? [...conflictEvents]
        .filter((ev) => !eventsLgaFilter || ev.admin2 === eventsLgaFilter)
        .sort((a, b) => b.fatalities - a.fatalities)
    : [];

  const lastUpdated = summary?.last_update
    ? new Date(summary.last_update).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
    : '—';

  const handleLevelChange = (l: AdminLevel) => {
    setAdminLevel(l);
    setDrillState(null);
    setDrillLGA(null);
    const opts = VARIABLE_OPTIONS[l];
    if (!opts.find((o) => o.value === variable)) setVariable(opts[0].value);
  };

  const handleDrillDown = useCallback(({ level, pcode, name }: DrillEvent) => {
    if (level === 1) {
      setDrillState({ pcode, name });
      setDrillLGA(null);
      setAdminLevel(2);
      if (!VARIABLE_OPTIONS[2].find((o) => o.value === variable)) setVariable(VARIABLE_OPTIONS[2][0].value);
    } else {
      setDrillLGA({ pcode, name });
      setAdminLevel(3);
      if (!VARIABLE_OPTIONS[3].find((o) => o.value === variable)) setVariable(VARIABLE_OPTIONS[3][0].value);
    }
  }, [variable]);

  const resetDrill = useCallback(() => {
    setDrillState(null);
    setDrillLGA(null);
    setAdminLevel(1);
    if (!VARIABLE_OPTIONS[1].find((o) => o.value === variable)) setVariable(VARIABLE_OPTIONS[1][0].value);
  }, [variable]);

  const backToState = useCallback(() => {
    setDrillLGA(null);
    setAdminLevel(2);
  }, []);

  // Merge alert + changes + WB data per state
  const tableRows = (alerts ?? []).map((alert) => {
    const change = changes?.find((c) => c.state === alert.state);
    // WB: try case-insensitive match
    const wbKey = wbSummary
      ? Object.keys(wbSummary).find((k) => k.toLowerCase() === alert.state.toLowerCase())
      : undefined;
    const wb = wbKey ? wbSummary![wbKey] : null;
    return {
      ...alert,
      deaths_prior_30d: change?.deaths_prior_30d ?? 0,
      wb_active: wb?.active_count ?? 0,
      wb_commitment: wb?.total_commitment ?? 0,
    };
  });

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortAsc(!sortAsc);
    else { setSortKey(key); setSortAsc(false); }
  };

  const sorted = [...tableRows].sort((a, b) => {
    const va = a[sortKey] as number;
    const vb = b[sortKey] as number;
    return sortAsc ? va - vb : vb - va;
  });

  // pcode lookup populated by ConflictMap's onPcodeMap callback
  const pcodeMapRef = useRef<Record<string, string>>({});

  // Unit history: fetch on polygon click
  const handleUnitClick = useCallback((props: Record<string, unknown>) => {
    setSelectedProps(props);
    // Auto-filter events panel by state (API-level) + LGA/ward (client-side)
    const stateName = props.ADM1_EN as string | undefined;
    const lgaName = props.ADM2_EN as string | undefined;
    if (stateName) setEventsStateFilter(stateName);
    setEventsLgaFilter(lgaName ?? null);
  }, []);

  // State table row click — drill into state, open history panel, filter events
  const handleStateTableClick = useCallback((stateName: string) => {
    const pcode = pcodeMapRef.current[stateName] ?? '';
    handleDrillDown({ level: 1, pcode, name: stateName });
    handleUnitClick({ ADM1_EN: stateName, ADM1_PCODE: pcode, _clickedLevel: 1 });
    setEventsStateFilter(stateName);
    setEventsLgaFilter(null);
  }, [handleDrillDown, handleUnitClick]);


  useEffect(() => {
    if (!selectedProps) { setUnitHistory(null); return; }
    const clickedLevel = ((selectedProps._clickedLevel ?? adminLevel) as AdminLevel);
    const pcode = getPcode(selectedProps, clickedLevel);
    const name = getUnitName(selectedProps, clickedLevel);
    setHistoryLoading(true);
    setUnitHistory(null);
    setHistoryTab('trend');
    setSelectedActorInPanel(null);
    setUnitSummary(null);
    setSummaryError(null);
    fetch(`${BASE_URL}/api/spatial/unit-history?level=${clickedLevel}&pcode=${encodeURIComponent(pcode)}&name=${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then(setUnitHistory)
      .catch(() => {})
      .finally(() => setHistoryLoading(false));
  }, [selectedProps, adminLevel]);

  // WB projects for selected unit
  useEffect(() => {
    if (!selectedProps || !showWbProjects) { setWbUnitProjects([]); return; }
    const clickedLevel = ((selectedProps._clickedLevel ?? adminLevel) as AdminLevel);
    const name = getUnitName(selectedProps, clickedLevel);
    setWbUnitLoading(true);
    api.wbProjectsByUnit(clickedLevel, name)
      .then(setWbUnitProjects)
      .catch(() => setWbUnitProjects([]))
      .finally(() => setWbUnitLoading(false));
  }, [selectedProps, adminLevel, showWbProjects]);

  const fetchSummary = useCallback(() => {
    if (!selectedProps) return;
    const clickedLevel = ((selectedProps._clickedLevel ?? adminLevel) as AdminLevel);
    if (clickedLevel > 2) return;
    const name = getUnitName(selectedProps, clickedLevel);
    setAiSummaryLoading(true);
    setSummaryError(null);
    setUnitSummary(null);
    api.unitSummary({ level: clickedLevel, name, start_year: startYear, start_month: startMonth, end_year: endYear, end_month: endMonth })
      .then(setUnitSummary)
      .catch((e: Error) => setSummaryError(e.message ?? 'Failed to generate summary'))
      .finally(() => setAiSummaryLoading(false));
  }, [selectedProps, adminLevel, startYear, startMonth, endYear, endMonth]);

  const filledMonthly = unitHistory ? fillGaps(unitHistory.monthly).filter((p) => p.year >= 2010) : [];
  const chartData = aggregate(filledMonthly, frequency);
  const peakMonth = filledMonthly.length ? filledMonthly.reduce((a, b) => b.deaths > a.deaths ? b : a) : null;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="bg-gradient-to-r from-[#667eea] to-[#764ba2] rounded-xl p-5 text-white">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold">Nigeria Conflict Monitor</h1>
            <p className="text-white/80 text-sm mt-0.5">
              Early Warning & Alert Dashboard · ACLED 1997–2025
            </p>
          </div>
          <div className="text-right text-sm">
            <div className="flex items-center gap-1.5 text-white/70">
              <Calendar className="h-4 w-4" />
              <span>Last updated: {lastUpdated}</span>
            </div>
            {alertSummary && (
              <div className="mt-1 flex gap-2 justify-end text-xs">
                <span className="bg-red-500/30 text-white px-2 py-0.5 rounded">{alertSummary.states_red} Red</span>
                <span className="bg-orange-500/30 text-white px-2 py-0.5 rounded">{alertSummary.states_amber} Amber</span>
                <span className="bg-green-500/30 text-white px-2 py-0.5 rounded">{alertSummary.states_green} Green</span>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* KPI Strip */}
      {(() => {
        const eventsPct = prevQSummary && currentQSummary && prevQSummary.total_events > 0
          ? ((currentQSummary.total_events - prevQSummary.total_events) / prevQSummary.total_events) * 100
          : undefined;
        const deathsPct = prevQSummary && currentQSummary && prevQSummary.total_deaths > 0
          ? ((currentQSummary.total_deaths - prevQSummary.total_deaths) / prevQSummary.total_deaths) * 100
          : undefined;
        const vsLabel = `vs ${prevQ.label}`;
        return (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4" data-tour="kpi-strip">
            <KpiCard
              title={`Conflict Events · ${currentQ.label}`}
              value={currentQSummary ? currentQSummary.total_events.toLocaleString() : '—'}
              trend={eventsPct}
              subtitle={vsLabel}
              icon={<Activity className="h-6 w-6" />}
            />
            <KpiCard
              title={`Fatalities · ${currentQ.label}`}
              value={currentQSummary ? currentQSummary.total_deaths.toLocaleString() : '—'}
              trend={deathsPct}
              subtitle={vsLabel}
              variant="gradient"
              icon={<AlertTriangle className="h-6 w-6" />}
            />
            <KpiCard
              title="New Displacements"
              value="—"
              subtitle="Data not yet connected"
              icon={<MapIcon className="h-6 w-6" />}
            />
            <KpiCard
              title="Total IDPs"
              value="—"
              subtitle="Data not yet connected"
              icon={<Shield className="h-6 w-6" />}
            />
          </div>
        );
      })()}

      {/* Breadcrumb */}
      {(drillState || drillLGA) && (
        <div className="bg-white rounded-lg shadow-sm px-4 py-2 flex items-center gap-1.5 text-sm flex-wrap">
          <button onClick={resetDrill} className="text-[#667eea] hover:underline font-medium">Nigeria</button>
          {drillState && (
            <>
              <span className="text-gray-400">›</span>
              {drillLGA ? (
                <button onClick={backToState} className="text-[#667eea] hover:underline font-medium">{drillState.name}</button>
              ) : (
                <span className="text-gray-700 font-semibold">{drillState.name}</span>
              )}
            </>
          )}
          {drillLGA && (
            <>
              <span className="text-gray-400">›</span>
              <span className="text-gray-700 font-semibold">{drillLGA.name}</span>
            </>
          )}
          <button onClick={resetDrill} className="ml-auto text-xs text-gray-400 hover:text-gray-600">✕ Reset</button>
        </div>
      )}

      {/* Map Section */}
      <div className="flex gap-4">
        {/* Sidebar: icon strip + optional panel */}
        <div className="flex shrink-0 bg-white rounded-lg shadow-sm overflow-hidden" style={{ height: '65vh' }}>

          {/* Icon strip — always visible */}
          <div className="w-10 flex flex-col items-center pt-2 gap-1 border-r border-gray-100">
            <button
              onClick={() => togglePanel('settings')}
              className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${openPanel === 'settings' ? 'bg-[#667eea] text-white' : 'text-gray-400 hover:bg-gray-100'}`}
              title="Map settings"
              data-tour="btn-settings"
            >
              <Settings className="h-4 w-4" />
            </button>
            <button
              onClick={() => togglePanel('layers')}
              className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${openPanel === 'layers' ? 'bg-[#667eea] text-white' : 'text-gray-400 hover:bg-gray-100'}`}
              title="Data layers"
              data-tour="btn-layers"
            >
              <Layers className="h-4 w-4" />
            </button>
            <button
              onClick={() => togglePanel('events')}
              className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${openPanel === 'events' ? 'bg-[#667eea] text-white' : 'text-gray-400 hover:bg-gray-100'}`}
              title="ACLED events list"
              data-tour="btn-events"
            >
              <List className="h-4 w-4" />
            </button>
            <button
              onClick={() => {
                const next = !compareMode;
                setCompareMode(next);
                setOpenPanel(next ? 'compare' : null);
              }}
              className={`w-8 h-8 flex items-center justify-center rounded transition-colors ${
                compareMode ? 'bg-[#667eea] text-white' : 'text-gray-400 hover:bg-gray-100'
              }`}
              title="Time comparison"
              data-tour="btn-compare"
            >
              <Clock className="h-4 w-4" />
            </button>
          </div>

          {/* Settings panel */}
          {openPanel === 'settings' && (
            <div className="w-52 p-3 space-y-4 overflow-y-auto" style={{ height: '65vh' }}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Map Settings</p>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Admin Level</label>
                <div className="flex gap-1">
                  {([1, 2, 3] as AdminLevel[]).map((l) => (
                    <button
                      key={l}
                      onClick={() => handleLevelChange(l)}
                      className={`flex-1 text-xs py-1.5 rounded border transition-colors ${adminLevel === l ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-600 hover:border-[#667eea]'}`}
                    >
                      {LEVEL_LABELS[l]}
                    </button>
                  ))}
                </div>
              </div>

              {adminLevel === 3 && (
                <div className="bg-amber-50 border border-amber-200 rounded p-2 flex gap-2 text-xs text-amber-800">
                  <Info className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                  <span>Ward level renders ~9,400 polygons. Use <strong>Affected Only</strong> for faster loading.</span>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Variable</label>
                <div className="flex flex-col gap-1">
                  {VARIABLE_OPTIONS[adminLevel].map(({ value, label }) => (
                    <button
                      key={value}
                      onClick={() => setVariable(value)}
                      className={`text-xs py-1.5 px-2 rounded border transition-colors text-left ${variable === value ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-600 hover:border-[#667eea]'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {adminLevel === 3 && (
                <div className="flex items-center gap-2">
                  <input id="affected-only" type="checkbox" checked={affectedOnly} onChange={(e) => setAffectedOnly(e.target.checked)} className="accent-[#667eea]" />
                  <label htmlFor="affected-only" className="text-xs font-medium text-gray-600 cursor-pointer">Affected wards only</label>
                </div>
              )}

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Period</label>
                <div className="grid grid-cols-2 gap-1">
                  {[
                    { label: 'Start Year', value: startYear, set: setStartYear, min: 1997, max: 2025 },
                    { label: 'Start Month', value: startMonth, set: setStartMonth, min: 1, max: 12 },
                    { label: 'End Year', value: endYear, set: setEndYear, min: 1997, max: 2025 },
                    { label: 'End Month', value: endMonth, set: setEndMonth, min: 1, max: 12 },
                  ].map(({ label, value, set, min, max }) => (
                    <div key={label}>
                      <label className="text-xs text-gray-400">{label}</label>
                      <input type="number" min={min} max={max} value={value} onChange={(e) => set(Number(e.target.value))} className="w-full border border-gray-200 rounded px-2 py-1 text-xs" />
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Death Rate Threshold: {rateThresh}/100k</label>
                <input type="range" min="1" max="50" value={rateThresh} onChange={(e) => setRateThresh(Number(e.target.value))} className="w-full accent-[#667eea]" />
              </div>

              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Min Deaths Threshold: {absThresh}</label>
                <input type="range" min="1" max="50" value={absThresh} onChange={(e) => setAbsThresh(Number(e.target.value))} className="w-full accent-[#667eea]" />
              </div>

              {adminLevel !== 3 && (
                <div>
                  <label className="text-xs font-medium text-gray-600 block mb-1">Ward Share: {(aggThresh * 100).toFixed(0)}%</label>
                  <input type="range" min="0.02" max="0.5" step="0.01" value={aggThresh} onChange={(e) => setAggThresh(Number(e.target.value))} className="w-full accent-[#667eea]" />
                </div>
              )}
            </div>
          )}

          {/* Data Layers panel */}
          {openPanel === 'layers' && (
            <div className="w-52 p-3 space-y-4 overflow-y-auto" style={{ height: '65vh' }}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Data Layers</p>

              {/* Layer checkboxes — independent toggles */}
              <div className="space-y-2">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Admin Layers</p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showChoropleth}
                    onChange={(e) => setShowChoropleth(e.target.checked)}
                    className="accent-[#667eea]"
                  />
                  <div className="w-3 h-3 shrink-0 rounded-sm" style={{ background: 'linear-gradient(135deg, #fee5d9, #a50f15)' }} />
                  <span className="text-xs font-medium text-gray-700">Conflict Coloring</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showBoundaries}
                    onChange={(e) => setShowBoundaries(e.target.checked)}
                    className="accent-[#667eea]"
                  />
                  <div className="w-3 h-3 shrink-0 rounded-sm border border-gray-500" style={{ background: 'transparent' }} />
                  <span className="text-xs font-medium text-gray-700">Admin Boundaries</span>
                </label>

                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide pt-1">Data Overlays</p>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showEvents}
                    onChange={(e) => setShowEvents(e.target.checked)}
                    className="accent-[#667eea]"
                  />
                  <span className="text-xs font-medium text-gray-700">ACLED Events</span>
                </label>

                {/* Event type sub-filters — shown only when events layer is active */}
                {showEvents && (
                  <div className="ml-4 space-y-1.5 pt-1 border-l-2 border-gray-100 pl-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wide">Event types</span>
                      <button
                        onClick={() => setActiveEventTypes(activeEventTypes.length === ALL_EVENT_TYPES.length ? [] : [...ALL_EVENT_TYPES])}
                        className="text-[10px] text-[#667eea] hover:underline"
                      >
                        {activeEventTypes.length === ALL_EVENT_TYPES.length ? 'None' : 'All'}
                      </button>
                    </div>
                    {EVENT_TYPES.map(({ label, color }) => (
                      <label key={label} className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={activeEventTypes.includes(label)}
                          onChange={() => toggleEventType(label)}
                          className="accent-[#667eea]"
                        />
                        <div className="w-2.5 h-2.5 shrink-0 rounded-full" style={{ background: color }} />
                        <span className="text-xs text-gray-600 leading-tight">{label}</span>
                      </label>
                    ))}
                  </div>
                )}
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showWbProjects}
                    onChange={(e) => setShowWbProjects(e.target.checked)}
                    className="accent-[#009fda]"
                  />
                  <svg width="7" height="9" viewBox="0 0 22 28" className="shrink-0">
                    <path d="M11 1.5 C6.3 1.5 2.5 5.3 2.5 10 C2.5 14 11 26.5 11 26.5 C11 26.5 19.5 14 19.5 10 C19.5 5.3 15.7 1.5 11 1.5 Z" fill="#009fda" stroke="white" strokeWidth="1.5"/>
                    <circle cx="11" cy="10" r="3.5" fill="rgba(255,255,255,0.9)"/>
                  </svg>
                  <span className="text-xs font-medium text-gray-700">WB Project Sites</span>
                </label>
              </div>

              {/* WB status radio group — shown only when WB layer is active */}
              {showWbProjects && (
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-500">Project Status</p>
                  {([
                    { value: 'All',    color: null },
                    { value: 'Active', color: '#009fda' },
                    { value: 'Closed', color: '#888888' },
                    { value: 'Other',  color: '#f59e0b' },
                  ] as const).map(({ value, color }) => (
                    <label key={value} className="flex items-center gap-2 cursor-pointer">
                      <input
                        type="radio"
                        name="wb-status"
                        value={value}
                        checked={wbStatus === value}
                        onChange={() => setWbStatus(value)}
                        className="accent-[#009fda]"
                      />
                      {color && (
                        <svg width="7" height="9" viewBox="0 0 22 28" className="shrink-0">
                          <path d="M11 1.5 C6.3 1.5 2.5 5.3 2.5 10 C2.5 14 11 26.5 11 26.5 C11 26.5 19.5 14 19.5 10 C19.5 5.3 15.7 1.5 11 1.5 Z" fill={color} stroke="white" strokeWidth="1.5"/>
                          <circle cx="11" cy="10" r="3.5" fill="rgba(255,255,255,0.9)"/>
                        </svg>
                      )}
                      <span className="text-xs text-gray-600">{value}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* ACLED Events panel */}
          {openPanel === 'events' && (
            <div className="w-96 flex flex-col border-l border-gray-100" style={{ height: '65vh' }}>
              <div className="px-3 py-2 border-b border-gray-100 flex items-center justify-between shrink-0">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">ACLED Events</p>
                {(eventsStateFilter || eventsLgaFilter) && (
                  <button
                    onClick={() => { setEventsStateFilter(null); setEventsLgaFilter(null); }}
                    className="flex items-center gap-1 text-xs text-[#667eea] bg-indigo-50 px-2 py-0.5 rounded-full hover:bg-indigo-100 transition-colors"
                  >
                    {eventsLgaFilter ?? eventsStateFilter} <X className="h-3 w-3" />
                  </button>
                )}
              </div>
              {eventsLoading && (
                <div className="flex items-center justify-center flex-1 text-xs text-gray-400">Loading events…</div>
              )}
              {!eventsLoading && sortedEvents.length === 0 && (
                <div className="flex items-center justify-center flex-1 text-xs text-gray-400">No events found.</div>
              )}
              {!eventsLoading && sortedEvents.length > 0 && (
                <div className="overflow-y-auto flex-1 divide-y divide-gray-50">
                  {sortedEvents.map((ev) => {
                    const typeColor: Record<string, string> = {
                      'Battles': 'bg-red-50 text-red-700',
                      'Explosions/Remote violence': 'bg-orange-50 text-orange-700',
                      'Violence against civilians': 'bg-amber-50 text-amber-700',
                      'Riots': 'bg-yellow-50 text-yellow-700',
                      'Protests': 'bg-blue-50 text-blue-700',
                      'Strategic developments': 'bg-gray-100 text-gray-600',
                    };
                    const badge = typeColor[ev.event_type] ?? 'bg-gray-100 text-gray-600';
                    return (
                      <div
                        key={ev.event_id_cnty}
                        className="px-3 py-2.5 hover:bg-indigo-50 transition-colors cursor-pointer"
                        onClick={() => ev.longitude != null && ev.latitude != null && setFlyToCoords({ lng: ev.longitude, lat: ev.latitude })}
                        title="Click to zoom map to this event"
                      >
                        <div className="flex items-start justify-between gap-2 mb-1">
                          <div className="flex items-center gap-1.5 flex-wrap min-w-0">
                            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded shrink-0 ${badge}`}>
                              {ev.event_type}
                            </span>
                            <span className="text-xs text-gray-600 truncate">{ev.admin2 || ev.admin1}</span>
                          </div>
                          {ev.fatalities > 0 && (
                            <span className="text-xs font-bold text-red-600 shrink-0 tabular-nums">
                              ● {ev.fatalities}
                            </span>
                          )}
                        </div>
                        <p className="text-[10px] text-gray-400 mb-1">{ev.event_date}</p>
                        {ev.notes && (
                          <p className="text-xs text-gray-600 leading-relaxed">{ev.notes}</p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              <div className="px-3 py-1.5 border-t border-gray-100 shrink-0">
                <p className="text-[10px] text-gray-400">
                  {sortedEvents.length} event{sortedEvents.length !== 1 ? 's' : ''} · sorted by fatalities · {eventsStart} – {eventsEnd}
                </p>
              </div>
            </div>
          )}

          {/* Compare panel */}
          {openPanel === 'compare' && (
            <div className="w-52 p-3 space-y-4 overflow-y-auto" style={{ height: '65vh' }}>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Compare Period</p>
              {[
                { label: 'Start Year',  value: cmpStartYear,  set: setCmpStartYear,  min: 1997, max: 2025 },
                { label: 'Start Month', value: cmpStartMonth, set: setCmpStartMonth, min: 1,    max: 12   },
                { label: 'End Year',    value: cmpEndYear,    set: setCmpEndYear,    min: 1997, max: 2025 },
                { label: 'End Month',   value: cmpEndMonth,   set: setCmpEndMonth,   min: 1,    max: 12   },
              ].map(({ label, value, set, min, max }) => (
                <div key={label}>
                  <label className="text-xs text-gray-400">{label}</label>
                  <input
                    type="number" min={min} max={max} value={value}
                    onChange={(e) => set(Number(e.target.value))}
                    className="w-full border border-gray-200 rounded px-2 py-1 text-xs"
                  />
                </div>
              ))}
              <p className="text-xs text-gray-400 border-t border-gray-100 pt-2">
                Primary period is set in <strong>Map Settings</strong>.
              </p>
            </div>
          )}
        </div>

        {/* Map area: single or split */}
        <div className="flex flex-1 gap-2 overflow-hidden" style={{ height: '65vh' }} data-tour="map-container">

          {/* Primary map */}
          <div className="relative flex-1 bg-white rounded-lg shadow-sm overflow-hidden flex flex-col">
            {compareMode && (
              <div className="shrink-0 px-3 py-1 bg-indigo-50 border-b border-indigo-100 text-xs font-semibold text-indigo-600">
                Primary · {startYear}-{String(startMonth).padStart(2,'0')} → {endYear}-{String(endMonth).padStart(2,'0')}
              </div>
            )}
            <div className="flex-1 min-h-0">
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
                activeEventTypes={activeEventTypes}
                flyToCoords={flyToCoords}
                showWbProjects={showWbProjects}
                wbStatusFilter={wbStatusFilter}
                showChoropleth={showChoropleth}
                showBoundaries={showBoundaries}
                onUnitClick={handleUnitClick}
                onDrillDown={handleDrillDown}
                onPcodeMap={(m) => { pcodeMapRef.current = m; }}
                onMapReady={(m) => { mapARef.current = m; if (mapBRef.current) setupSync(); }}
              />
            </div>
          </div>

          {/* Comparison map — only when compareMode */}
          {compareMode && (
            <div className="relative flex-1 bg-white rounded-lg shadow-sm overflow-hidden flex flex-col">
              <div className="shrink-0 px-3 py-1 bg-amber-50 border-b border-amber-100 text-xs font-semibold text-amber-600">
                Compare · {cmpStartYear}-{String(cmpStartMonth).padStart(2,'0')} → {cmpEndYear}-{String(cmpEndMonth).padStart(2,'0')}
              </div>
              <div className="flex-1 min-h-0">
                <ConflictMap
                  level={adminLevel}
                  variable={variable}
                  affectedOnly={affectedOnly}
                  parentPcode={parentPcode}
                  startYear={cmpStartYear}
                  startMonth={cmpStartMonth}
                  endYear={cmpEndYear}
                  endMonth={cmpEndMonth}
                  rateThresh={rateThresh}
                  absThresh={absThresh}
                  aggThresh={aggThresh}
                  showEvents={false}
                  showWbProjects={false}
                  showChoropleth={showChoropleth}
                  showBoundaries={showBoundaries}
                  activeEventTypes={activeEventTypes}
                  wbStatusFilter={wbStatusFilter}
                  onUnitClick={handleUnitClick}
                  onDrillDown={handleDrillDown}
                  onPcodeMap={() => {}}
                  onMapReady={(m) => { mapBRef.current = m; if (mapARef.current) setupSync(); }}
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ── Unit history drawer — fixed right-side overlay ───────────────────── */}
      {(selectedProps || historyLoading) && (
        <div
          className="fixed top-0 right-0 bottom-0 z-50 flex flex-col bg-white border-l border-gray-200"
          style={{ width: 520, boxShadow: '-6px 0 32px rgba(0,0,0,0.13)' }}
        >
          {/* Header */}
          <div className="flex items-start justify-between px-5 py-4 border-b border-gray-100 shrink-0">
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
            <button onClick={() => setSelectedProps(null)} className="text-gray-400 hover:text-gray-600 mt-0.5 ml-4 shrink-0">
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Scrollable body */}
          <div className="flex-1 overflow-y-auto px-5 py-4">

          {historyLoading && <div className="text-sm text-gray-400 py-8 text-center">Loading history…</div>}

          {unitHistory && !historyLoading && (
            <>
              {/* KPI strip */}
              <div className="grid grid-cols-2 gap-3 mb-4">
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

              {/* Tab bar + frequency toggle */}
              {(() => {
                const clickedLevel = ((selectedProps?._clickedLevel ?? adminLevel) as AdminLevel);
                return (
                  <div className="flex items-center justify-between mb-4 gap-2">
                    <div className="flex rounded border border-gray-200 overflow-hidden">
                      {(['trend', 'actors'] as const).map((tab) => (
                        <button key={tab} onClick={() => { setHistoryTab(tab); setSelectedActorInPanel(null); }}
                          className={`text-xs px-3 py-1.5 capitalize transition-colors ${historyTab === tab ? 'bg-[#667eea] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                          {tab === 'trend' ? 'Trend' : `Actors${unitHistory.top_actors.length ? ` (${unitHistory.top_actors.length})` : ''}`}
                        </button>
                      ))}
                      {clickedLevel < 3 && (
                        <button onClick={() => { setHistoryTab('summary'); if (!unitSummary && !aiSummaryLoading) fetchSummary(); }}
                          className={`text-xs px-3 py-1.5 transition-colors ${historyTab === 'summary' ? 'bg-[#667eea] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                          AI Summary
                        </button>
                      )}
                      {showWbProjects && (
                        <button onClick={() => setHistoryTab('projects' as any)}
                          className={`text-xs px-3 py-1.5 transition-colors ${historyTab === ('projects' as any) ? 'bg-[#667eea] text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                          Projects{wbUnitProjects.length > 0 ? ` (${wbUnitProjects.length})` : ''}
                        </button>
                      )}
                    </div>
                    {historyTab === 'trend' && (
                      <div className="flex rounded border border-gray-200 overflow-hidden shrink-0">
                        {(['monthly', 'quarterly', 'yearly'] as Frequency[]).map((f) => (
                          <button key={f} onClick={() => setFrequency(f)}
                            className={`text-xs px-2 py-1 transition-colors ${frequency === f ? 'bg-gray-700 text-white' : 'text-gray-500 hover:bg-gray-50'}`}>
                            {f.charAt(0).toUpperCase()}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}

              {/* Trend tab */}
              {historyTab === 'trend' && (
                <div className="space-y-5">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-2">Monthly Deaths{adminLevel < 3 ? ' & Events' : ''} (all time)</p>
                    {chartData.length === 0 ? <p className="text-xs text-gray-400 py-4">No data available.</p> : (
                      <ResponsiveContainer width="100%" height={200}>
                        <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                          <XAxis dataKey="period" tick={{ fontSize: 10 }} interval={tickInterval(chartData.length)} />
                          <YAxis tick={{ fontSize: 10 }} width={36} />
                          <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: unknown, name: string | undefined) => [Number(v).toLocaleString(), name ?? '']} />
                          <Area type="monotone" dataKey="deaths" stroke="#d73027" fill="#d73027" fillOpacity={0.15} strokeWidth={1.5} name="Deaths" dot={false} />
                          {adminLevel < 3 && <Area type="monotone" dataKey="events" stroke="#667eea" fill="#667eea" fillOpacity={0.1} strokeWidth={1.5} name="Events" dot={false} />}
                        </AreaChart>
                      </ResponsiveContainer>
                    )}
                  </div>
                  {unitHistory.by_type.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-gray-600 mb-2">Deaths by Event Type</p>
                      <ResponsiveContainer width="100%" height={180}>
                        <BarChart data={unitHistory.by_type} layout="vertical" margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" horizontal={false} />
                          <XAxis type="number" tick={{ fontSize: 10 }} />
                          <YAxis dataKey="event_type" type="category" width={130} tick={{ fontSize: 10 }} />
                          <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: unknown) => [Number(v).toLocaleString(), 'Deaths']} />
                          <Bar dataKey="deaths" fill="#d73027" radius={[0, 3, 3, 0]} name="Deaths" />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  )}
                </div>
              )}

              {/* AI Summary tab */}
              {historyTab === 'summary' && (
                <div className="space-y-3">
                  {aiSummaryLoading && <div className="flex items-center gap-2 text-sm text-gray-400 py-8 justify-center"><span className="animate-spin inline-block">⟳</span> Generating summary…</div>}
                  {summaryError && <div className="text-sm text-red-500 bg-red-50 rounded p-3">{summaryError}</div>}
                  {unitSummary && !aiSummaryLoading && (
                    <>
                      <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5">
                        <span>⚠</span><span>AI-generated analysis · Based on ACLED data · Verify before operational use</span>
                      </div>
                      <div className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap bg-gray-50 rounded-lg p-4">{unitSummary.summary}</div>
                      <div className="flex items-center justify-between text-xs text-gray-400">
                        <span>Based on {unitSummary.event_count.toLocaleString()} events · Generated {new Date(unitSummary.generated_at).toLocaleTimeString()}</span>
                        <button onClick={fetchSummary} className="text-[#667eea] hover:underline">Regenerate</button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* Actors tab */}
              {historyTab === 'actors' && (
                <div className="space-y-5">
                  <div>
                    <p className="text-xs font-medium text-gray-600 mb-2">Top actors by deaths (all time)</p>
                    {unitHistory.top_actors.length === 0 ? <p className="text-xs text-gray-400">No actor data available.</p> : (
                      <div className="space-y-1">
                        {unitHistory.top_actors.map((a, i) => {
                          const maxDeaths = unitHistory.top_actors[0].deaths || 1;
                          const isSelected = selectedActorInPanel === a.actor;
                          return (
                            <button key={a.actor} onClick={() => setSelectedActorInPanel(isSelected ? null : a.actor)}
                              className={`w-full text-left flex items-center gap-2 px-2 py-1.5 rounded transition-colors ${isSelected ? 'bg-indigo-50 ring-1 ring-[#667eea]' : 'hover:bg-gray-50'}`}>
                              <span className="text-xs text-gray-400 w-4 shrink-0">{i + 1}</span>
                              <div className="flex-1 min-w-0">
                                <p className="text-xs font-medium text-gray-800 truncate">{a.actor}</p>
                                <div className="h-1.5 bg-gray-100 rounded mt-1 overflow-hidden">
                                  <div className="h-full rounded transition-all" style={{ width: `${(a.deaths / maxDeaths) * 100}%`, background: isSelected ? '#667eea' : '#d73027' }} />
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
                  <div>
                    {selectedActorInPanel && unitHistory.actor_timelines[selectedActorInPanel] ? (
                      <>
                        <p className="text-xs font-medium text-gray-600 mb-2 truncate">Timeline: <span className="text-[#667eea]">{selectedActorInPanel}</span></p>
                        <ResponsiveContainer width="100%" height={220}>
                          <AreaChart data={unitHistory.actor_timelines[selectedActorInPanel].filter((p) => parseInt(p.period.slice(0, 4)) >= 2010)} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                            <XAxis dataKey="period" tick={{ fontSize: 9 }} interval={tickInterval(unitHistory.actor_timelines[selectedActorInPanel].filter((p) => parseInt(p.period.slice(0, 4)) >= 2010).length)} />
                            <YAxis tick={{ fontSize: 10 }} width={36} />
                            <Tooltip contentStyle={{ fontSize: 12 }} formatter={(v: unknown) => [Number(v).toLocaleString(), 'Deaths']} />
                            <Area type="monotone" dataKey="deaths" stroke="#667eea" fill="#667eea" fillOpacity={0.15} strokeWidth={1.5} name="Deaths" dot={false} />
                          </AreaChart>
                        </ResponsiveContainer>
                      </>
                    ) : (
                      <div className="flex items-center justify-center text-xs text-gray-400 py-8">
                        {unitHistory.top_actors.length > 0 ? 'Click an actor to see their activity timeline' : ''}
                      </div>
                    )}
                  </div>
                </div>
              )}
              {/* Projects tab */}
              {(historyTab as string) === 'projects' && showWbProjects && (
                <div>
                  {wbUnitLoading && <p className="text-xs text-gray-400 py-4 text-center">Loading projects…</p>}
                  {!wbUnitLoading && wbUnitProjects.length === 0 && (
                    <p className="text-xs text-gray-400 py-4 text-center">No WB project sites recorded for this unit.</p>
                  )}
                  {wbUnitProjects.length > 0 && (
                    <div className="space-y-3">
                      {wbUnitProjects.map((p) => {
                        const statusColor = p.status === 'Active' ? '#009fda' : p.status === 'Closed' ? '#888' : '#f59e0b';
                        const commitment = p.commitment_amt == null ? '—'
                          : p.commitment_amt >= 1_000_000_000 ? `$${(p.commitment_amt / 1_000_000_000).toFixed(1)}B`
                          : `$${Math.round(p.commitment_amt / 1_000_000)}M`;
                        return (
                          <div key={`${p.proj_id}-${p.locations[0]}`} className="bg-gray-50 rounded-lg p-3" title={p.objective || undefined}>
                            <div className="flex items-start justify-between gap-2 mb-1">
                              <p className="text-xs font-semibold text-gray-800 leading-snug">{p.name || p.proj_id}</p>
                              <span className="text-xs font-bold shrink-0" style={{ color: statusColor }}>{p.status || '—'}</span>
                            </div>
                            <p className="text-[10px] text-gray-400 mb-1">{p.proj_id}</p>
                            {p.practice && <p className="text-xs text-gray-600 mb-1">{p.practice}</p>}
                            <div className="flex items-center gap-3 text-[10px] text-gray-400">
                              {p.approval_fy && <span>FY{p.approval_fy}</span>}
                              {p.commitment_amt != null && <span className="font-mono text-gray-600">{commitment}</span>}
                              <span>{p.location_count} site{p.location_count !== 1 ? 's' : ''}</span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          </div>{/* end scrollable body */}
        </div>
      )}{/* end drawer */}

      {/* Summary Table — State / LGA / Ward depending on drill level */}
      <div className="bg-white rounded-lg shadow-sm overflow-hidden" data-tour="state-table">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
          {adminLevel === 1 ? (
            <h2 className="font-semibold text-sm text-gray-900">State Summary — All 36 States + FCT</h2>
          ) : (
            <div className="flex items-center gap-1.5 text-sm min-w-0">
              <button onClick={resetDrill} className="text-[#667eea] hover:underline font-medium shrink-0">Nigeria</button>
              {drillState && (
                <>
                  <span className="text-gray-400">/</span>
                  {adminLevel === 2 ? (
                    <span className="font-semibold text-gray-900 truncate">{drillState.name}</span>
                  ) : (
                    <button onClick={backToState} className="text-[#667eea] hover:underline font-medium shrink-0">{drillState.name}</button>
                  )}
                </>
              )}
              {drillLGA && adminLevel === 3 && (
                <>
                  <span className="text-gray-400">/</span>
                  <span className="font-semibold text-gray-900 truncate">{drillLGA.name}</span>
                </>
              )}
            </div>
          )}
          <span className="text-xs text-gray-400 shrink-0">
            {adminLevel === 1
              ? 'Deaths = last 30 days · Click a row to drill into LGAs'
              : adminLevel === 2
              ? `LGAs in ${drillState?.name} · Current vs prior quarter · Click column headers to sort`
              : `Wards in ${drillLGA?.name} · Spatially assigned from coordinates · Current vs prior quarter`}
          </span>
        </div>
        <div className="overflow-x-auto">
          {adminLevel === 1 && (
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-100">
                <tr>
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600 w-8">#</th>
                  <th className="text-left px-3 py-2.5 font-semibold text-gray-600">State</th>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Status</th>
                  <ThBtn k="total_deaths_30d" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort}>Deaths (30d)</ThBtn>
                  <ThBtn k="deaths_prior_30d" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort}>Prior (30d)</ThBtn>
                  <ThBtn k="mom_deaths_pct_change" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort}>Δ Deaths</ThBtn>
                  <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Escalation</th>
                  <ThBtn k="wb_active" sortKey={sortKey} sortAsc={sortAsc} onSort={handleSort}>WB Active</ThBtn>
                </tr>
              </thead>
              <tbody>
                {sorted.map((row, i) => {
                  const borderColor =
                    row.status === 'red' ? 'border-l-4 border-red-500' :
                    row.status === 'amber' ? 'border-l-4 border-orange-500' :
                    'border-l-4 border-green-500';
                  return (
                    <tr key={row.state} className={`border-b border-gray-50 hover:bg-indigo-50 transition-colors cursor-pointer ${borderColor}`} onClick={() => handleStateTableClick(row.state)}>
                      <td className="px-3 py-2 text-gray-400 font-mono text-xs">{i + 1}</td>
                      <td className="px-3 py-2 font-medium text-gray-900">{row.state}</td>
                      <td className="px-3 py-2 text-center"><RagBadge status={row.status} size="sm" /></td>
                      <td className="px-3 py-2 text-center font-mono font-semibold text-gray-800">
                        {row.total_deaths_30d > 0 ? row.total_deaths_30d.toLocaleString() : <span className="text-gray-300">0</span>}
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-gray-500">
                        {row.deaths_prior_30d > 0 ? row.deaths_prior_30d.toLocaleString() : <span className="text-gray-300">0</span>}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.total_deaths_30d > 0 || row.deaths_prior_30d > 0 ? (
                          <TrendArrow value={row.mom_deaths_pct_change} invert />
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center">
                        {row.is_significant_escalation ? (
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 bg-red-50 px-2 py-0.5 rounded">▲ Escalating</span>
                        ) : (
                          <span className="text-gray-300 text-xs">—</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-center font-mono text-gray-700">
                        {row.wb_active > 0 ? <span className="font-semibold text-[#009fda]">{row.wb_active}</span> : <span className="text-gray-300">0</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {adminLevel === 2 && drillState && (() => {
            const qLabel = (d: string) => { const dt = new Date(d); return `Q${Math.ceil((dt.getMonth()+1)/3)} ${dt.getFullYear()}`; };
            const prevMap = Object.fromEntries((lgaAdminDataPrev ?? []).filter((r) => r.admin1 === drillState.name).map((r) => [r.admin2!, r.deaths]));
            const rows = (lgaAdminData ?? [])
              .filter((r) => r.admin1 === drillState.name)
              .sort((a, b) => b.deaths - a.deaths);
            return (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-semibold text-gray-600 w-8">#</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-gray-600">LGA</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Deaths {qLabel(currentQ.start)}</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Deaths {qLabel(prevQ.start)}</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Δ Deaths</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-400">No data for this quarter</td></tr>
                  )}
                  {rows.map((row, i) => {
                    const prev = prevMap[row.admin2!] ?? 0;
                    const pct = prev > 0 ? ((row.deaths - prev) / prev) * 100 : null;
                    return (
                      <tr key={row.admin2} className="border-b border-gray-50 hover:bg-indigo-50 transition-colors cursor-pointer border-l-4 border-gray-200"
                        onClick={() => handleUnitClick({ ADM1_EN: drillState.name, ADM2_EN: row.admin2, _clickedLevel: 2 })}>
                        <td className="px-3 py-2 text-gray-400 font-mono text-xs">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">{row.admin2}</td>
                        <td className="px-3 py-2 text-center font-mono font-semibold text-gray-800">
                          {row.deaths > 0 ? row.deaths.toLocaleString() : <span className="text-gray-300">0</span>}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-gray-500">
                          {prev > 0 ? prev.toLocaleString() : <span className="text-gray-300">0</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {pct !== null ? <TrendArrow value={pct} invert /> : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-gray-500">{row.events.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}

          {adminLevel === 3 && drillLGA && (() => {
            const qLabel = (d: string) => { const dt = new Date(d); return `Q${Math.ceil((dt.getMonth()+1)/3)} ${dt.getFullYear()}`; };
            const prevMap = Object.fromEntries((wardAdminDataPrev ?? []).map((r) => [r.admin3!, r.deaths]));
            const rows = wardAdminData ?? [];
            return (
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-100">
                  <tr>
                    <th className="text-left px-3 py-2.5 font-semibold text-gray-600 w-8">#</th>
                    <th className="text-left px-3 py-2.5 font-semibold text-gray-600">Ward</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Deaths {qLabel(currentQ.start)}</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Deaths {qLabel(prevQ.start)}</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Δ Deaths</th>
                    <th className="text-center px-3 py-2.5 font-semibold text-gray-600">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.length === 0 && (
                    <tr><td colSpan={6} className="px-3 py-6 text-center text-xs text-gray-400">No events recorded in this LGA for the current quarter</td></tr>
                  )}
                  {rows.map((row, i) => {
                    const prev = prevMap[row.admin3!] ?? 0;
                    const pct = prev > 0 ? ((row.deaths - prev) / prev) * 100 : null;
                    return (
                      <tr key={row.admin3} className="border-b border-gray-50 hover:bg-gray-50 transition-colors border-l-4 border-gray-200"
                        onClick={() => handleUnitClick({ ADM1_EN: drillLGA.name, ADM2_EN: row.admin2, ADM3_EN: row.admin3, _clickedLevel: 3 })}>
                        <td className="px-3 py-2 text-gray-400 font-mono text-xs">{i + 1}</td>
                        <td className="px-3 py-2 font-medium text-gray-900">{row.admin3}</td>
                        <td className="px-3 py-2 text-center font-mono font-semibold text-gray-800">
                          {row.deaths > 0 ? row.deaths.toLocaleString() : <span className="text-gray-300">0</span>}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-gray-500">
                          {prev > 0 ? prev.toLocaleString() : <span className="text-gray-300">0</span>}
                        </td>
                        <td className="px-3 py-2 text-center">
                          {pct !== null ? <TrendArrow value={pct} invert /> : <span className="text-gray-300 text-xs">—</span>}
                        </td>
                        <td className="px-3 py-2 text-center font-mono text-gray-500">{row.events.toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            );
          })()}
        </div>
      </div>

      {showTour && <Tour steps={TOUR_STEPS} onFinish={handleTourFinish} />}
    </div>
  );
}
