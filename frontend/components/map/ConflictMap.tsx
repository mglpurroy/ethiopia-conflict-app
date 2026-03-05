'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Globe2 } from 'lucide-react';
import { apiUrl } from '@/lib/apiBase';

export interface DrillEvent {
  level: 1 | 2 | 3;
  pcode: string;
  name: string;
}

/** Compute the bounding box of any GeoJSON geometry. */
function featureBbox(geometry: any): [[number, number], [number, number]] {
  const lngs: number[] = [];
  const lats: number[] = [];
  function walk(c: any) {
    if (typeof c[0] === 'number') { lngs.push(c[0]); lats.push(c[1]); return; }
    c.forEach(walk);
  }
  if (geometry.type === 'GeometryCollection') {
    geometry.geometries.forEach((g: any) => walk(g.coordinates));
  } else {
    walk(geometry.coordinates);
  }
  return [
    [Math.min(...lngs), Math.min(...lats)],
    [Math.max(...lngs), Math.max(...lats)],
  ];
}

interface ConflictMapProps {
  level: 1 | 2 | 3;
  variable: 'deaths' | 'ward_share' | 'rate' | 'events' | 'density';
  periodId?: string;
  mapView?: 'regions_zones' | 'woredas';
  analysisType?: 'conflict_metrics' | 'trajectory';
  trajectoryCategories?: string[];
  affectedOnly?: boolean;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  rateThresh: number;
  absThresh: number;
  parentPcode?: string;
  parentLevel?: 1 | 2;
  regionPcode?: string;
  showEvents?: boolean;
  showChoropleth?: boolean;
  showBoundaries?: boolean;
  activeEventTypes?: string[];
  flyToCoords?: { lng: number; lat: number } | null;
  onUnitClick?: (props: Record<string, any>) => void;
  onDrillDown?: (event: DrillEvent) => void;
  onPcodeMap?: (map: Record<string, string>) => void;
  onMapReady?: (map: maplibregl.Map) => void;
}

function getChoroplethColor(variable: string, level: number, maxDeaths: number, maxRate: number, maxEvents: number) {
  if (level === 3) {
    if (variable === 'rate') {
      return [
        'interpolate',
        ['linear'],
        ['get', 'acled_total_death_rate'],
        0, '#f0f0f0',
        maxRate * 0.1, '#fee0d2',
        maxRate * 0.3, '#fc9272',
        maxRate * 0.6, '#de2d26',
        maxRate, '#67000d',
      ];
    }
    // Woreda deaths — ternary status: Affected / Below threshold / None
    return [
      'case',
      ['==', ['get', 'violence_affected'], true], '#d73027',
      ['>', ['get', 'ACLED_BRD_total'], 0], '#fd8d3c',
      '#bfdbfe',
    ];
  }
  if (variable === 'deaths') {
    return [
      'interpolate',
      ['linear'],
      ['get', 'ACLED_BRD_total'],
      0, '#f0f0f0',
      maxDeaths * 0.1, '#fee0d2',
      maxDeaths * 0.3, '#fc9272',
      maxDeaths * 0.6, '#de2d26',
      maxDeaths, '#67000d',
    ];
  }
  if (variable === 'events') {
    return [
      'interpolate',
      ['linear'],
      ['get', 'event_count'],
      0, '#f0f0f0',
      maxEvents * 0.1, '#c7e9c0',
      maxEvents * 0.3, '#74c476',
      maxEvents * 0.6, '#238b45',
      maxEvents, '#00441b',
    ];
  }
  return [
    'interpolate',
    ['linear'],
    ['get', 'share_woredas_affected'],
    0, '#f0f0f0',
    0.1, '#c7e9b4',
    0.3, '#41b6c4',
    0.5, '#2c7fb8',
    1.0, '#253494',
  ];
}

function getClassificationColor(
  analysisType: 'conflict_metrics' | 'trajectory',
) {
  if (analysisType === 'trajectory') {
    return [
      'match',
      ['coalesce', ['get', 'trajectory'], ['get', 'predominant_trajectory'], 'Insufficient Data'],
      'At-Risk', '#f97316',
      'Onset', '#dc2626',
      'Recovery', '#16a34a',
      'Turnaround', '#0284c7',
      'Stable', '#64748b',
      'Fluctuating', '#7c3aed',
      '#d1d5db',
    ];
  }

  return [
    'match',
    ['coalesce', ['get', 'status_label'], 'No reported violence'],
    'Highly Conflict-Affected', '#b91c1c',
    'Conflict-Affected', '#ef4444',
    'Below threshold', '#f59e0b',
    '#bfdbfe',
  ];
}

function actionHint(level: number): string {
  if (level === 1) return '<div style="color:#667eea;font-size:10px;margin-top:5px;padding-top:4px;border-top:1px solid #eee">Double-click to open Zones in this Region</div>';
  if (level === 2) return '<div style="color:#667eea;font-size:10px;margin-top:5px;padding-top:4px;border-top:1px solid #eee">Double-click to open Woredas in this Zone</div>';
  return '<div style="color:#667eea;font-size:10px;margin-top:5px;padding-top:4px;border-top:1px solid #eee">Double-click to zoom to this Woreda</div>';
}

function buildPopupHtml(
  props: Record<string, any>,
  level: number,
  analysisType: 'conflict_metrics' | 'trajectory',
): string {
  if (analysisType === 'trajectory') {
    const name = level === 1 ? (props.ADM1_EN ?? 'Unknown') : level === 2 ? (props.ADM2_EN ?? 'Unknown') : (props.ADM3_EN ?? 'Unknown');
    const trajectory = props.trajectory ?? props.predominant_trajectory ?? 'Insufficient Data';
    const selectedShare = props.selected_share != null ? `${(Number(props.selected_share) * 100).toFixed(1)}%` : 'N/A';
    return `<div style="font-family:sans-serif;font-size:12px;min-width:280px;line-height:1.5">
      <div style="font-weight:700;margin-bottom:2px">${name}</div>
      Trajectory: <b>${trajectory}</b><br/>
      Selected share: <b>${selectedShare}</b>
    </div>`;
  }

  if (level === 3) {
    const woreda = props.ADM3_EN ?? 'Unknown Woreda';
    const zone = props.ADM2_EN ?? '';
    const region = props.ADM1_EN ?? '';
    const status = String(props.status_label ?? 'No reported violence');
    const deaths = Number(props.ACLED_BRD_total ?? 0).toLocaleString();
    const rate = Number(props.acled_total_death_rate ?? 0).toFixed(2);
    const pop = props.pop_count ? Number(props.pop_count).toLocaleString() : 'N/A';
    const eventCount = Number(props.event_count ?? 0).toLocaleString();
    return `<div style="font-family:sans-serif;font-size:12px;min-width:280px;line-height:1.5">
      <div style="font-weight:700;margin-bottom:2px">${woreda}</div>
      Status: <b>${status}</b><br/>
      Region: <b>${region || 'N/A'}</b><br/>
      Zone: <b>${zone || 'N/A'}</b><br/>
      Population: <b>${pop}</b><br/>
      Conflict Events: <b>${eventCount}</b><br/>
      Fatalities (ACLED): <b>${deaths}</b><br/>
      Death rate: <b>${rate}</b> / 100K
    </div>`;
  }
  const name = level === 2 ? (props.ADM2_EN ?? 'Unknown') : (props.ADM1_EN ?? 'Unknown');
  const status = String(props.status_label ?? 'No reported violence');
  const parent = level === 2 && props.ADM1_EN ? `Region: <b>${props.ADM1_EN}</b><br/>` : '';
  const pop = props.pop_count ? Number(props.pop_count).toLocaleString() : 'N/A';
  const deaths = Number(props.ACLED_BRD_total ?? 0).toLocaleString();
  const affected = `${Number(props.affected_woredas ?? 0).toLocaleString()}/${Number(props.total_woredas ?? 0).toLocaleString()}`;
  const eventCount = Number(props.event_count ?? 0).toLocaleString();
  const sharePopulation = Number(props.share_population_conflict_affected ?? 0);
  const shareWoredas = Number(props.share_woredas_conflict_affected ?? 0);
  return `<div style="font-family:sans-serif;font-size:12px;min-width:280px;line-height:1.5">
    <div style="font-weight:700;margin-bottom:2px">${name}</div>
    Status: <b>${status}</b><br/>
    ${parent}
    Population: <b>${pop}</b><br/>
    Population in Conflict-Affected Woredas: <b>${(sharePopulation * 100).toFixed(2)}%</b><br/>
    Conflict-Affected Woredas: <b>${(shareWoredas * 100).toFixed(2)}%</b><br/>
    Affected Woredas: <b>${affected}</b><br/>
    Conflict Events: <b>${eventCount}</b><br/>
    Fatalities (ACLED): <b>${deaths}</b>
  </div>`;
}

function buildEventPopupHtml(props: Record<string, any>): string {
  const date = props.event_date ?? '';
  const type = props.event_type ?? '';
  const subType = props.sub_event_type ?? '';
  const actor = props.actor1 ?? '';
  const fatalities = Number(props.fatalities ?? 0);
  const location = props.location ?? '';
  const admin1 = props.admin1 ?? '';
  return `<div style="font-family:sans-serif;font-size:12px;min-width:200px;line-height:1.6">
    <div style="font-weight:700;margin-bottom:3px">${type}</div>
    ${subType ? `<div style="color:#555;font-size:11px;margin-bottom:4px">${subType}</div>` : ''}
    <div style="color:#666;font-size:11px;margin-bottom:5px">${date}${location ? ' · ' + location : ''}${admin1 ? ', ' + admin1 : ''}</div>
    Actor: <b>${actor || '—'}</b><br/>
    Fatalities: <b>${fatalities.toLocaleString()}</b>
  </div>`;
}

const SOURCE_ID = 'choropleth';
const FILL_ID = 'choropleth-fill';
const OUTLINE_ID = 'choropleth-outline';
const EVENTS_SOURCE_ID = 'acled-events';
const EVENTS_LAYER_ID = 'acled-events-circles';
const DENSITY_SOURCE_ID = 'density-heatmap';
const DENSITY_LAYER_ID = 'density-heatmap-layer';

const EVENT_TYPE_COLORS: Record<string, string> = {
  'Battles': '#0072B2',
  'Violence against civilians': '#CC79A7',
  'Explosions/Remote violence': '#009E73',
  'Riots': '#5D3A9B',
  'Protests': '#8C564B',
};
const EVENT_TYPE_DEFAULT_COLOR = '#4D4D4D';

const EVENT_TYPE_LABELS = Object.keys(EVENT_TYPE_COLORS);

const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const STREET_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export default function ConflictMap({
  level,
  variable,
  periodId,
  mapView = 'regions_zones',
  analysisType = 'conflict_metrics',
  trajectoryCategories,
  affectedOnly = false,
  startYear,
  startMonth,
  endYear,
  endMonth,
  rateThresh,
  absThresh,
  parentPcode = '',
  parentLevel,
  regionPcode,
  showEvents = false,
  showChoropleth = true,
  showBoundaries = true,
  activeEventTypes,
  flyToCoords,
  onUnitClick,
  onDrillDown,
  onPcodeMap,
  onMapReady,
}: ConflictMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const loadedGeojsonRef = useRef<any>(null);
  const [basemap, setBasemap] = useState<'satellite' | 'street'>('street');
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const enterHandlerRef = useRef<((e: any) => void) | null>(null);
  const leaveHandlerRef = useRef<(() => void) | null>(null);
  const clickHandlerRef = useRef<((e: any) => void) | null>(null);
  const lastClickRef = useRef<{ ts: number; pcode: string; level: 1 | 2 | 3 } | null>(null);
  // Events overlay refs
  const eventsEnterHandlerRef = useRef<((e: any) => void) | null>(null);
  const eventsLeaveHandlerRef = useRef<(() => void) | null>(null);
  const eventsPopupRef = useRef<maplibregl.Popup | null>(null);
  const eventsRequestRef = useRef(0);

  const onUnitClickRef = useRef(onUnitClick);
  const onDrillDownRef = useRef(onDrillDown);
  useEffect(() => { onUnitClickRef.current = onUnitClick; }, [onUnitClick]);
  useEffect(() => { onDrillDownRef.current = onDrillDown; }, [onDrillDown]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxDeaths, setMaxDeaths] = useState(1000);
  const [maxRate, setMaxRate] = useState(100);
  const [maxEvents, setMaxEvents] = useState(100);

  const effectiveMapView = level === 3 ? 'woredas' : mapView;
  const aggLevel = level === 1 ? 'ADM1' : level === 2 ? 'ADM2' : 'ADM3';

  const choroplethUrl = [
    '/api/spatial/choropleth',
    `?level=${level}`,
    `&variable=${variable}`,
    `&start_year=${startYear}&start_month=${startMonth}`,
    `&end_year=${endYear}&end_month=${endMonth}`,
    `&rate_thresh=${rateThresh}&abs_thresh=${absThresh}`,
    level === 3 ? `&affected_only=${affectedOnly}` : '',
    parentPcode ? `&parent_pcode=${encodeURIComponent(parentPcode)}` : '',
  ].join('');

  const classificationUrl = [
    '/api/spatial/classification',
    `?period_id=${encodeURIComponent(periodId ?? '')}`,
    `&map_view=${effectiveMapView}`,
    `&agg_level=${aggLevel}`,
    `&analysis_type=${analysisType}`,
    parentPcode ? `&parent_pcode=${encodeURIComponent(parentPcode)}` : '',
    parentPcode && parentLevel ? `&parent_level=${parentLevel}` : '',
    trajectoryCategories && trajectoryCategories.length > 0
      ? `&trajectory_categories=${encodeURIComponent(trajectoryCategories.join(','))}`
      : '',
  ].join('');

  const parentEventFilter =
    level === 2 && parentPcode
      ? `&level=1&pcode=${encodeURIComponent(parentPcode)}`
      : level === 3 && parentPcode && parentLevel
      ? `&level=${parentLevel}&pcode=${encodeURIComponent(parentPcode)}`
      : '';
  const eventsUrl = periodId
    ? `/api/spatial/events?period_id=${encodeURIComponent(periodId)}${parentEventFilter}`
    : [
        '/api/spatial/events',
        `?start_year=${startYear}&start_month=${startMonth}`,
        `&end_year=${endYear}&end_month=${endMonth}`,
        parentEventFilter,
      ].join('');

  /** Remove events layer + source from the map (idempotent). */
  const removeEventsLayer = useCallback(() => {
    if (!map.current) return;
    if (eventsEnterHandlerRef.current) {
      map.current.off('mouseenter', EVENTS_LAYER_ID, eventsEnterHandlerRef.current);
      eventsEnterHandlerRef.current = null;
    }
    if (eventsLeaveHandlerRef.current) {
      map.current.off('mouseleave', EVENTS_LAYER_ID, eventsLeaveHandlerRef.current);
      eventsLeaveHandlerRef.current = null;
    }
    if (map.current.getLayer(EVENTS_LAYER_ID)) map.current.removeLayer(EVENTS_LAYER_ID);
    if (map.current.getSource(EVENTS_SOURCE_ID)) map.current.removeSource(EVENTS_SOURCE_ID);
    eventsPopupRef.current?.remove();
  }, []);

  const loadEvents = useCallback(async () => {
    if (!map.current) return;
    if (!showEvents) {
      removeEventsLayer();
      return;
    }
    const requestId = ++eventsRequestRef.current;
    try {
      const res = await fetch(apiUrl(eventsUrl));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      let geojson = await res.json();

      // Fallback for zone->woreda drill: if zone-scoped incidents are empty, retry at region scope.
      if (
        level === 3
        && parentLevel === 2
        && parentPcode
        && regionPcode
        && (geojson?.features?.length ?? 0) === 0
      ) {
        const fallbackUrl = periodId
          ? `/api/spatial/events?period_id=${encodeURIComponent(periodId)}&level=1&pcode=${encodeURIComponent(regionPcode)}`
          : [
              '/api/spatial/events',
              `?start_year=${startYear}&start_month=${startMonth}`,
              `&end_year=${endYear}&end_month=${endMonth}`,
              `&level=1&pcode=${encodeURIComponent(regionPcode)}`,
            ].join('');
        const fallbackRes = await fetch(apiUrl(fallbackUrl));
        if (fallbackRes.ok) {
          const fallbackGeojson = await fallbackRes.json();
          if ((fallbackGeojson?.features?.length ?? 0) > 0) {
            geojson = fallbackGeojson;
          }
        }
      }
      // Ignore stale responses if a newer events request has started.
      if (requestId !== eventsRequestRef.current || !map.current) return;

      // Remove old events layer/source before re-adding
      removeEventsLayer();
      if (requestId !== eventsRequestRef.current || !map.current) return;

      map.current.addSource(EVENTS_SOURCE_ID, { type: 'geojson', data: geojson });
      map.current.addLayer({
        id: EVENTS_LAYER_ID,
        type: 'circle',
        source: EVENTS_SOURCE_ID,
        paint: {
          'circle-color': [
            'match',
            ['get', 'event_type'],
            'Battles', EVENT_TYPE_COLORS['Battles'],
            'Violence against civilians', EVENT_TYPE_COLORS['Violence against civilians'],
            'Explosions/Remote violence', EVENT_TYPE_COLORS['Explosions/Remote violence'],
            'Riots', EVENT_TYPE_COLORS['Riots'],
            'Protests', EVENT_TYPE_COLORS['Protests'],
            EVENT_TYPE_DEFAULT_COLOR,
          ],
          'circle-radius': [
            'interpolate',
            ['linear'],
            ['get', 'fatalities'],
            0, 4,
            1, 5,
            5, 7,
            20, 10,
            100, 15,
          ],
          'circle-opacity': 0.8,
          'circle-stroke-width': 0.5,
          'circle-stroke-color': 'rgba(0,0,0,0.3)',
        },
      });

      if (!eventsPopupRef.current) {
        eventsPopupRef.current = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          anchor: 'top',
          offset: 16,
          maxWidth: '320px',
        });
      }
      const popup = eventsPopupRef.current;

      const enterHandler = (e: any) => {
        if (!map.current) return;
        map.current.getCanvas().style.cursor = 'pointer';
        const props = (e.features?.[0]?.properties ?? {}) as Record<string, any>;
        popup.setLngLat(e.lngLat).setHTML(buildEventPopupHtml(props)).addTo(map.current);
      };
      const leaveHandler = () => {
        if (!map.current) return;
        map.current.getCanvas().style.cursor = '';
        popup.remove();
      };

      eventsEnterHandlerRef.current = enterHandler;
      eventsLeaveHandlerRef.current = leaveHandler;
      map.current.on('mouseenter', EVENTS_LAYER_ID, enterHandler);
      map.current.on('mouseleave', EVENTS_LAYER_ID, leaveHandler);
    } catch (err) {
      // Non-fatal: events overlay failure shouldn't break the map
      // but keep a visible hint for easier troubleshooting.
      if (requestId === eventsRequestRef.current) {
        setError(`Failed to load incidents overlay: ${err instanceof Error ? err.message : 'unknown error'}`);
      }
    }
  }, [
    showEvents,
    eventsUrl,
    removeEventsLayer,
    level,
    parentLevel,
    parentPcode,
    regionPcode,
    periodId,
    startYear,
    startMonth,
    endYear,
    endMonth,
  ]);

  const loadChoropleth = useCallback(async () => {
    if (!map.current) return;
    setLoading(true);
    setError(null);
    try {
      // ── DENSITY HEATMAP BRANCH ─────────────────────────────────────────────
      if (variable === 'density') {
        // Remove choropleth layers
        if (enterHandlerRef.current) { map.current.off('mousemove', FILL_ID, enterHandlerRef.current); enterHandlerRef.current = null; }
        if (leaveHandlerRef.current) { map.current.off('mouseleave', FILL_ID, leaveHandlerRef.current); leaveHandlerRef.current = null; }
        if (clickHandlerRef.current) { map.current.off('click', FILL_ID, clickHandlerRef.current); clickHandlerRef.current = null; }
        if (map.current.getLayer(OUTLINE_ID)) map.current.removeLayer(OUTLINE_ID);
        if (map.current.getLayer(FILL_ID)) map.current.removeLayer(FILL_ID);
        if (map.current.getSource(SOURCE_ID)) map.current.removeSource(SOURCE_ID);
        // Remove old density layer
        if (map.current.getLayer(DENSITY_LAYER_ID)) map.current.removeLayer(DENSITY_LAYER_ID);
        if (map.current.getSource(DENSITY_SOURCE_ID)) map.current.removeSource(DENSITY_SOURCE_ID);

        const evRes = await fetch(apiUrl(eventsUrl));
        if (!evRes.ok) throw new Error(`API error ${evRes.status}`);
        const eventsGeoJson = await evRes.json();

        map.current.addSource(DENSITY_SOURCE_ID, { type: 'geojson', data: eventsGeoJson });
        map.current.addLayer({
          id: DENSITY_LAYER_ID,
          type: 'heatmap',
          source: DENSITY_SOURCE_ID,
          paint: {
            'heatmap-weight': ['interpolate', ['linear'], ['coalesce', ['get', 'fatalities'], 0], 0, 0.1, 50, 1],
            'heatmap-intensity': ['interpolate', ['linear'], ['zoom'], 5, 1, 9, 3],
            'heatmap-color': [
              'interpolate', ['linear'], ['heatmap-density'],
              0,   'rgba(0,0,0,0)',
              0.2, '#ffffb2',
              0.4, '#fecc5c',
              0.6, '#fd8d3c',
              0.8, '#f03b20',
              1.0, '#bd0026',
            ],
            'heatmap-radius': ['interpolate', ['linear'], ['zoom'], 5, 20, 9, 40],
            'heatmap-opacity': 0.85,
          },
        } as any);
        return;
      }

      // ── CHOROPLETH BRANCHES ────────────────────────────────────────────────
      // Clean up density layer if switching away from it
      if (map.current.getLayer(DENSITY_LAYER_ID)) map.current.removeLayer(DENSITY_LAYER_ID);
      if (map.current.getSource(DENSITY_SOURCE_ID)) map.current.removeSource(DENSITY_SOURCE_ID);

      const useClassification = Boolean(periodId);
      const targetUrl = useClassification ? classificationUrl : choroplethUrl;
      const res = await fetch(apiUrl(targetUrl));
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const geojson = await res.json();
      loadedGeojsonRef.current = geojson;

      // Provide state name→pcode mapping to the parent (level-1 only, used for table-click drill-down)
      if (level === 1 && onPcodeMap) {
        const pm: Record<string, string> = {};
        for (const f of (geojson.features ?? [])) {
          const n = f.properties?.ADM1_EN;
          const p = f.properties?.ADM1_PCODE;
          if (n && p) pm[n] = p;
        }
        onPcodeMap(pm);
      }

      // Auto-fit to the extent of all loaded features when drilling into a sub-unit
      if (parentPcode && geojson.features?.length > 0) {
        let mnLng = Infinity, mnLat = Infinity, mxLng = -Infinity, mxLat = -Infinity;
        for (const f of geojson.features) {
          if (f.geometry) {
            const [[a, b], [c, d]] = featureBbox(f.geometry);
            if (a < mnLng) mnLng = a; if (b < mnLat) mnLat = b;
            if (c > mxLng) mxLng = c; if (d > mxLat) mxLat = d;
          }
        }
        if (isFinite(mnLng)) {
          map.current!.fitBounds([[mnLng, mnLat], [mxLng, mxLat]], { padding: 40, duration: 600, maxZoom: 10 });
        }
      }

      const deaths = geojson.features?.map((f: any) => f.properties?.ACLED_BRD_total ?? 0) ?? [];
      const rates = geojson.features?.map((f: any) => f.properties?.acled_total_death_rate ?? 0) ?? [];
      const evts  = geojson.features?.map((f: any) => f.properties?.event_count ?? 0) ?? [];
      const localMax = Math.max(...deaths, 100);
      const localMaxRate = Math.max(...rates, 10);
      const localMaxEvents = Math.max(...evts, 10);
      setMaxDeaths(localMax);
      setMaxRate(localMaxRate);
      setMaxEvents(localMaxEvents);

      // Clean up old event handlers before removing layers
      if (enterHandlerRef.current) {
        map.current.off('mousemove', FILL_ID, enterHandlerRef.current);
        enterHandlerRef.current = null;
      }
      if (leaveHandlerRef.current) {
        map.current.off('mouseleave', FILL_ID, leaveHandlerRef.current);
        leaveHandlerRef.current = null;
      }
      if (clickHandlerRef.current) {
        map.current.off('click', FILL_ID, clickHandlerRef.current);
        clickHandlerRef.current = null;
      }

      // Remove existing layers and source for clean rebuild
      if (map.current.getLayer(OUTLINE_ID)) map.current.removeLayer(OUTLINE_ID);
      if (map.current.getLayer(FILL_ID)) map.current.removeLayer(FILL_ID);
      if (map.current.getSource(SOURCE_ID)) map.current.removeSource(SOURCE_ID);

      map.current.addSource(SOURCE_ID, { type: 'geojson', data: geojson });

      const lineWidth = level === 3 ? 0.3 : level === 1 ? 1.5 : 0.8;
      const fillOpacity = level === 3 ? 0.8 : 0.75;
      const lineOpacity = level === 3 ? 0.35 : 0.6;

      // Insert choropleth layers below any point overlay layers
      const eventsExists = !!map.current.getLayer(EVENTS_LAYER_ID);
      const beforeLayer = eventsExists ? EVENTS_LAYER_ID : undefined;

      map.current.addLayer({
        id: FILL_ID,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': (
            periodId
              ? getClassificationColor(analysisType)
              : getChoroplethColor(variable, level, localMax, localMaxRate, localMaxEvents)
          ) as any,
          'fill-opacity': fillOpacity,
        },
      }, beforeLayer);
      map.current.addLayer({
        id: OUTLINE_ID,
        type: 'line',
        source: SOURCE_ID,
        paint: {
          'line-color': '#333',
          'line-width': lineWidth,
          'line-opacity': lineOpacity,
        },
      }, beforeLayer);

      // Create shared popup
      if (!popupRef.current) {
        popupRef.current = new maplibregl.Popup({
          closeButton: false,
          closeOnClick: false,
          anchor: 'bottom',
          offset: 18,
          maxWidth: '360px',
        });
      }
      const popup = popupRef.current;

      const enterHandler = (e: any) => {
        if (!map.current) return;
        map.current.getCanvas().style.cursor = 'pointer';
        const props = (e.features?.[0]?.properties ?? {}) as Record<string, any>;
        popup
          .setLngLat(e.lngLat)
          .setHTML(buildPopupHtml(props, level, analysisType) + actionHint(level))
          .addTo(map.current);
      };
      const leaveHandler = () => {
        if (!map.current) return;
        map.current.getCanvas().style.cursor = '';
        popup.remove();
      };

      enterHandlerRef.current = enterHandler;
      leaveHandlerRef.current = leaveHandler;
      map.current.on('mousemove', FILL_ID, enterHandler);
      map.current.on('mouseleave', FILL_ID, leaveHandler);

      const clickHandler = (e: any) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = (feature.properties ?? {}) as Record<string, any>;
        const pcodeKey = level === 1 ? "ADM1_PCODE" : level === 2 ? "ADM2_PCODE" : "ADM3_PCODE";
        const pcode = String(props?.[pcodeKey] ?? "");
        onUnitClickRef.current?.({ ...props, _clickedLevel: level });

        const now = Date.now();
        const prev = lastClickRef.current;
        const isDoubleOnSameUnit =
          !!prev && prev.level === level && prev.pcode === pcode && now - prev.ts <= 350;
        lastClickRef.current = { ts: now, pcode, level };

        if (!isDoubleOnSameUnit || !map.current) return;

        const sourceFeature = (loadedGeojsonRef.current?.features ?? []).find(
          (f: any) => String(f?.properties?.[pcodeKey] ?? "") === pcode,
        );
        const targetGeometry = sourceFeature?.geometry ?? feature?.geometry;
        if (targetGeometry) {
          const bbox = featureBbox(targetGeometry);
          if (level === 3) {
            map.current.fitBounds(bbox, {
              padding: 95,
              duration: 700,
              maxZoom: 11.3,
            });
          } else {
            map.current.fitBounds(bbox, {
              padding: 60,
              duration: 700,
              maxZoom: 10,
            });
          }
        }

        if (level < 3) {
          const parentPcode = level === 1 ? (props.ADM1_PCODE ?? '') : (props.ADM2_PCODE ?? '');
          const name = level === 1 ? (props.ADM1_EN ?? '') : (props.ADM2_EN ?? '');
          onDrillDownRef.current?.({ level: level as 1 | 2, pcode: parentPcode, name });
        } else {
          const woredaPcode = props.ADM3_PCODE ?? '';
          const woredaName = props.ADM3_EN ?? '';
          onDrillDownRef.current?.({ level: 3, pcode: woredaPcode, name: woredaName });
        }
      };
      clickHandlerRef.current = clickHandler;
      map.current.on('click', FILL_ID, clickHandler);
    } catch (e: any) {
      const msg = e?.message ?? 'Failed to load map data';
      if (typeof msg === 'string' && msg.toLowerCase().includes('failed to fetch')) {
        setError('Failed to fetch map data. Verify backend is running and API URL/proxy is configured.');
      } else {
        setError(msg);
      }
    } finally {
      setLoading(false);
    }
  }, [
    choroplethUrl,
    classificationUrl,
    eventsUrl,
    variable,
    level,
    periodId,
    analysisType,
  ]);

  useEffect(() => {
    if (!mapContainer.current) return;
    map.current = new maplibregl.Map({
      container: mapContainer.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: 'raster',
            tiles: [STREET_TILES],
            tileSize: 256,
            attribution: '© OpenStreetMap contributors',
          },
        },
        layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
      },
      center: [40.4897, 9.145],
      zoom: 5.2,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current.doubleClickZoom.disable();
    map.current.on('load', () => {
      loadChoropleth();
      loadEvents();
      onMapReady?.(map.current!);
    });

    return () => {
      removeEventsLayer();
      popupRef.current = null;
      eventsPopupRef.current = null;
      map.current?.remove();
    };
  }, []);

  useEffect(() => {
    if (map.current?.isStyleLoaded()) {
      loadChoropleth();
    }
  }, [loadChoropleth]);

  // Load / remove events overlay whenever showEvents or date range changes
  useEffect(() => {
    if (map.current?.isStyleLoaded()) {
      loadEvents();
    }
  }, [loadEvents]);

  // Toggle choropleth fill visibility
  useEffect(() => {
    if (!map.current?.getLayer(FILL_ID)) return;
    map.current.setLayoutProperty(FILL_ID, 'visibility', showChoropleth ? 'visible' : 'none');
  }, [showChoropleth]);

  // Toggle admin boundary outline visibility
  useEffect(() => {
    if (!map.current?.getLayer(OUTLINE_ID)) return;
    map.current.setLayoutProperty(OUTLINE_ID, 'visibility', showBoundaries ? 'visible' : 'none');
  }, [showBoundaries]);

  // Apply event type filter on the events layer without reloading data
  useEffect(() => {
    if (!map.current?.getLayer(EVENTS_LAYER_ID)) return;
    if (!activeEventTypes) { map.current.setFilter(EVENTS_LAYER_ID, null); return; }
    const NAMED = Object.keys(EVENT_TYPE_COLORS);
    const selectedNamed = activeEventTypes.filter((t) => NAMED.includes(t));
    const showOther = activeEventTypes.includes('Other');
    const allNamed = selectedNamed.length === NAMED.length;
    if (allNamed && showOther) {
      map.current.setFilter(EVENTS_LAYER_ID, null);
    } else if (showOther) {
      const namedFilter: any = selectedNamed.length > 0
        ? ['match', ['get', 'event_type'], selectedNamed, true, false]
        : ['boolean', false];
      map.current.setFilter(EVENTS_LAYER_ID, ['any', namedFilter,
        ['!', ['match', ['get', 'event_type'], NAMED, true, false]]] as any);
    } else {
      map.current.setFilter(EVENTS_LAYER_ID,
        selectedNamed.length === 0
          ? (['boolean', false] as any)
          : (['match', ['get', 'event_type'], selectedNamed, true, false] as any));
    }
  }, [activeEventTypes]);

  // Fly to specific coordinates when an event is selected from the external list
  useEffect(() => {
    if (!flyToCoords || !map.current) return;
    map.current.flyTo({ center: [flyToCoords.lng, flyToCoords.lat], zoom: 12, duration: 700 });
  }, [flyToCoords]);

  // Hot-swap basemap tiles without reloading the full style
  useEffect(() => {
    if (!map.current?.isStyleLoaded()) return;
    const src = map.current.getSource('osm') as maplibregl.RasterTileSource;
    if (!src) return;
    src.setTiles([basemap === 'satellite' ? SATELLITE_TILES : STREET_TILES]);
  }, [basemap]);

  const renderLegend = () => {
    if (periodId && analysisType === 'trajectory') {
      return (
        <>
          <p className="font-semibold text-gray-700 mb-1.5">Trajectory</p>
          {[
            { color: '#dc2626', label: 'Onset' },
            { color: '#f97316', label: 'At-Risk' },
            { color: '#16a34a', label: 'Recovery' },
            { color: '#0284c7', label: 'Turnaround' },
            { color: '#64748b', label: 'Stable' },
            { color: '#7c3aed', label: 'Fluctuating' },
            { color: '#d1d5db', label: 'Insufficient Data' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5 mb-0.5">
              <div className="w-4 h-3 rounded-sm border border-gray-200" style={{ background: color }} />
              <span className="text-gray-600">{label}</span>
            </div>
          ))}
        </>
      );
    }

    if (periodId && analysisType === 'conflict_metrics') {
      return (
        <>
          <p className="font-semibold text-gray-700 mb-1.5">Conflict Classification</p>
          {[
            { color: '#b91c1c', label: 'Highly Conflict-Affected' },
            { color: '#ef4444', label: 'Conflict-Affected' },
            { color: '#f59e0b', label: 'Below threshold' },
            { color: '#bfdbfe', label: 'No reported violence' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5 mb-0.5">
              <div className="w-4 h-3 rounded-sm border border-gray-200" style={{ background: color }} />
              <span className="text-gray-600">{label}</span>
            </div>
          ))}
        </>
      );
    }

    if (level === 3) {
      if (variable === 'rate') {
        return (
          <>
            <p className="font-semibold text-gray-700 mb-1.5">Death Rate /100k</p>
            {[
              { color: '#67000d', label: 'Highest' },
              { color: '#de2d26', label: 'High' },
              { color: '#fc9272', label: 'Medium' },
              { color: '#fee0d2', label: 'Low' },
              { color: '#f0f0f0', label: 'None' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5 mb-0.5">
                <div className="w-4 h-3 rounded-sm" style={{ background: color }} />
                <span className="text-gray-600">{label}</span>
              </div>
            ))}
          </>
        );
      }
      return (
        <>
          <p className="font-semibold text-gray-700 mb-1.5">Woreda Status</p>
          {[
            { color: '#d73027', label: 'Affected' },
            { color: '#fd8d3c', label: 'Below threshold' },
            { color: '#bfdbfe', label: 'No violence' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5 mb-0.5">
              <div className="w-4 h-3 rounded-sm border border-gray-200" style={{ background: color }} />
              <span className="text-gray-600">{label}</span>
            </div>
          ))}
        </>
      );
    }
    if (variable === 'density') {
      return (
        <>
          <p className="font-semibold text-gray-700 mb-1.5">Death Density</p>
          {[
            { color: '#bd0026', label: 'Highest' },
            { color: '#f03b20', label: 'High' },
            { color: '#fd8d3c', label: 'Medium' },
            { color: '#fecc5c', label: 'Low' },
            { color: '#ffffb2', label: 'Very low' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5 mb-0.5">
              <div className="w-4 h-3 rounded-sm" style={{ background: color }} />
              <span className="text-gray-600">{label}</span>
            </div>
          ))}
          <p className="text-xs text-gray-400 mt-1.5">Weighted by fatalities</p>
        </>
      );
    }
    if (variable === 'events') {
      return (
        <>
          <p className="font-semibold text-gray-700 mb-1.5">Event Count</p>
          {[
            { color: '#00441b', label: 'Highest' },
            { color: '#238b45', label: 'High' },
            { color: '#74c476', label: 'Medium' },
            { color: '#c7e9c0', label: 'Low' },
            { color: '#f0f0f0', label: 'None' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5 mb-0.5">
              <div className="w-4 h-3 rounded-sm" style={{ background: color }} />
              <span className="text-gray-600">{label}</span>
            </div>
          ))}
        </>
      );
    }
    if (variable === 'deaths') {
      return (
        <>
          <p className="font-semibold text-gray-700 mb-1.5">Total Deaths</p>
          {[
            { color: '#67000d', label: 'Highest' },
            { color: '#de2d26', label: 'High' },
            { color: '#fc9272', label: 'Medium' },
            { color: '#fee0d2', label: 'Low' },
            { color: '#f0f0f0', label: 'None' },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5 mb-0.5">
              <div className="w-4 h-3 rounded-sm" style={{ background: color }} />
              <span className="text-gray-600">{label}</span>
            </div>
          ))}
        </>
      );
    }
    return (
      <>
        <p className="font-semibold text-gray-700 mb-1.5">Woreda Share Affected</p>
        {[
          { color: '#253494', label: '> 50%' },
          { color: '#2c7fb8', label: '30–50%' },
          { color: '#41b6c4', label: '10–30%' },
          { color: '#c7e9b4', label: '< 10%' },
          { color: '#f0f0f0', label: 'None' },
        ].map(({ color, label }) => (
          <div key={label} className="flex items-center gap-1.5 mb-0.5">
            <div className="w-4 h-3 rounded-sm" style={{ background: color }} />
            <span className="text-gray-600">{label}</span>
          </div>
        ))}
      </>
    );
  };

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />
      {loading && (
        <div className="absolute top-3 left-3 bg-white/90 px-3 py-1.5 rounded shadow text-sm text-gray-600">
          Loading{level === 3 ? ' woreda data…' : '…'}
        </div>
      )}
      {error && (
        <div className="absolute top-3 left-3 bg-red-50 border border-red-200 px-3 py-1.5 rounded shadow text-sm text-red-600">
          {error}
        </div>
      )}
      <button
        onClick={() => map.current?.flyTo({ center: [40.4897, 9.145], zoom: 5.2, duration: 700 })}
        className="absolute top-[100px] right-[10px] bg-white rounded shadow p-1.5 hover:bg-gray-50 transition-colors z-10"
        title="Reset to full Ethiopia view"
        style={{ boxShadow: '0 0 0 2px rgba(0,0,0,.1)' }}
      >
        <Globe2 className="h-4 w-4 text-gray-500" />
      </button>
      <button
        onClick={() => setBasemap((b) => b === 'satellite' ? 'street' : 'satellite')}
        className="absolute top-[140px] right-[10px] bg-white rounded shadow px-1.5 py-1 text-[10px] font-bold hover:bg-gray-50 transition-colors z-10 text-gray-600 leading-none"
        title={basemap === 'satellite' ? 'Switch to street map' : 'Switch to satellite'}
        style={{ boxShadow: '0 0 0 2px rgba(0,0,0,.1)' }}
      >
        {basemap === 'satellite' ? 'MAP' : 'SAT'}
      </button>
      <div className="absolute bottom-8 right-3 bg-white/95 rounded shadow p-3 text-xs min-w-[150px] max-h-[300px] overflow-y-auto">
        {renderLegend()}
        {showEvents && (
          <>
            <div className="border-t border-gray-200 mt-2 pt-2">
              <p className="font-semibold text-gray-700 mb-1.5">Event Types</p>
              {EVENT_TYPE_LABELS.map((label) => (
                <div key={label} className="flex items-center gap-1.5 mb-0.5">
                  <div
                    className="w-3 h-3 rounded-full"
                    style={{ background: EVENT_TYPE_COLORS[label] }}
                  />
                  <span className="text-gray-600">{label}</span>
                </div>
              ))}
              <div className="flex items-center gap-1.5 mb-0.5">
                <div className="w-3 h-3 rounded-full" style={{ background: EVENT_TYPE_DEFAULT_COLOR }} />
                <span className="text-gray-600">Other</span>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
