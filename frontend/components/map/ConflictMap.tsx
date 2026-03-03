'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { Globe2 } from 'lucide-react';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000';

export interface DrillEvent {
  level: 1 | 2;
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
  affectedOnly?: boolean;
  startYear: number;
  startMonth: number;
  endYear: number;
  endMonth: number;
  rateThresh: number;
  absThresh: number;
  aggThresh: number;
  parentPcode?: string;
  showEvents?: boolean;
  showWbProjects?: boolean;
  showChoropleth?: boolean;
  showBoundaries?: boolean;
  wbStatusFilter?: string[];
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
    // Ward deaths — ternary status: Affected / Below threshold / None
    return [
      'case',
      ['==', ['get', 'violence_affected'], true], '#d73027',
      ['>', ['get', 'ACLED_BRD_total'], 0], '#fd8d3c',
      '#e8e8e8',
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
    ['get', 'share_wards_affected'],
    0, '#f0f0f0',
    0.1, '#c7e9b4',
    0.3, '#41b6c4',
    0.5, '#2c7fb8',
    1.0, '#253494',
  ];
}

function actionHint(level: number): string {
  if (level === 1) return '<div style="color:#667eea;font-size:10px;margin-top:5px;padding-top:4px;border-top:1px solid #eee">▾ Click to show LGAs</div>';
  if (level === 2) return '<div style="color:#667eea;font-size:10px;margin-top:5px;padding-top:4px;border-top:1px solid #eee">▾ Click to show wards</div>';
  return '<div style="color:#667eea;font-size:10px;margin-top:5px;padding-top:4px;border-top:1px solid #eee">Click for full history</div>';
}

function buildPopupHtml(props: Record<string, any>, level: number): string {
  if (level === 3) {
    const ward = props.ADM3_EN ?? 'Unknown Ward';
    const lga = props.ADM2_EN ?? '';
    const state = props.ADM1_EN ?? '';
    const subtitle = [lga, state].filter(Boolean).join(', ');
    const deaths = Number(props.ACLED_BRD_total ?? 0).toLocaleString();
    const rate = Number(props.acled_total_death_rate ?? 0).toFixed(1);
    const pop = props.pop_count ? Number(props.pop_count).toLocaleString() : 'N/A';
    const status = props.violence_affected === true
      ? '<span style="color:#d73027;font-weight:600">Affected</span>'
      : Number(props.ACLED_BRD_total ?? 0) > 0
      ? '<span style="color:#fd8d3c;font-weight:600">Below threshold</span>'
      : '<span style="color:#888">No violence</span>';
    return `<div style="font-family:sans-serif;font-size:12px;min-width:180px;line-height:1.5">
      <div style="font-weight:700;margin-bottom:2px">${ward}</div>
      ${subtitle ? `<div style="color:#666;font-size:11px;margin-bottom:6px">${subtitle}</div>` : ''}
      Deaths: <b>${deaths}</b><br/>
      Death rate: <b>${rate}/100k</b><br/>
      Population: <b>${pop}</b><br/>
      Status: ${status}
    </div>`;
  }
  const name = level === 2 ? (props.ADM2_EN ?? 'Unknown') : (props.ADM1_EN ?? 'Unknown');
  const parent = level === 2 && props.ADM1_EN
    ? `<div style="color:#666;font-size:11px;margin-bottom:4px">${props.ADM1_EN}</div>`
    : '';
  const deaths = Number(props.ACLED_BRD_total ?? 0).toLocaleString();
  const wardShare = ((props.share_wards_affected ?? 0) * 100).toFixed(1);
  const eventCount = props.event_count != null ? Number(props.event_count).toLocaleString() : null;
  return `<div style="font-family:sans-serif;font-size:12px;min-width:160px;line-height:1.5">
    <div style="font-weight:700;margin-bottom:2px">${name}</div>
    ${parent}
    Deaths: <b>${deaths}</b><br/>
    Wards affected: <b>${wardShare}%</b>${eventCount != null ? `<br/>Events: <b>${eventCount}</b>` : ''}
  </div>`;
}

function buildWbPopupHtml(props: Record<string, any>): string {
  const name = props.name || props.proj_id || 'WB Project';
  const status = props.status || '';
  const practice = props.practice || '';
  const location = props.location_name || props.admin1 || '';
  const approvalFy = props.approval_fy ? `FY${props.approval_fy}` : '';
  const commitment = props.commitment_amt != null
    ? props.commitment_amt >= 1_000_000_000
      ? `$${(props.commitment_amt / 1_000_000_000).toFixed(1)}B`
      : `$${Math.round(props.commitment_amt / 1_000_000)}M`
    : '';
  const statusColor = status === 'Active' ? '#27ae60' : status === 'Closed' ? '#888' : '#d35400';
  return `<div style="font-family:sans-serif;font-size:12px;min-width:220px;line-height:1.6">
    <div style="font-weight:700;margin-bottom:3px">${name}</div>
    <div style="margin-bottom:4px">
      <span style="color:${statusColor};font-weight:600;font-size:11px">${status}</span>
      ${approvalFy ? `<span style="color:#888;font-size:11px;margin-left:6px">${approvalFy}</span>` : ''}
    </div>
    ${practice ? `<div style="color:#555;font-size:11px;margin-bottom:3px">${practice}</div>` : ''}
    ${location ? `<div style="color:#666;font-size:11px;margin-bottom:2px">📍 ${location}</div>` : ''}
    ${commitment ? `Commitment: <b>${commitment}</b><br/>` : ''}
    <div style="color:#888;font-size:10px;margin-top:3px">${props.proj_id}</div>
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
const WB_SOURCE_ID = 'wb-projects';
const WB_LAYER_ID = 'wb-projects-circles';
const DENSITY_SOURCE_ID = 'density-heatmap';
const DENSITY_LAYER_ID = 'density-heatmap-layer';

const EVENT_TYPE_COLORS: Record<string, string> = {
  'Battles': '#e31a1c',
  'Violence against civilians': '#ff7f00',
  'Explosions/Remote violence': '#6a3d9a',
  'Riots': '#1f78b4',
  'Protests': '#33a02c',
};
const EVENT_TYPE_DEFAULT_COLOR = '#b15928';

const EVENT_TYPE_LABELS = Object.keys(EVENT_TYPE_COLORS);

const SATELLITE_TILES = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
const STREET_TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

export default function ConflictMap({
  level,
  variable,
  affectedOnly = false,
  startYear,
  startMonth,
  endYear,
  endMonth,
  rateThresh,
  absThresh,
  aggThresh,
  parentPcode = '',
  showEvents = false,
  showWbProjects = false,
  showChoropleth = true,
  showBoundaries = true,
  wbStatusFilter = ['Active'],
  activeEventTypes,
  flyToCoords,
  onUnitClick,
  onDrillDown,
  onPcodeMap,
  onMapReady,
}: ConflictMapProps) {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [basemap, setBasemap] = useState<'satellite' | 'street'>('street');
  const popupRef = useRef<maplibregl.Popup | null>(null);
  const enterHandlerRef = useRef<((e: any) => void) | null>(null);
  const leaveHandlerRef = useRef<(() => void) | null>(null);
  const clickHandlerRef = useRef<((e: any) => void) | null>(null);
  // Events overlay refs
  const eventsEnterHandlerRef = useRef<((e: any) => void) | null>(null);
  const eventsLeaveHandlerRef = useRef<(() => void) | null>(null);
  const eventsPopupRef = useRef<maplibregl.Popup | null>(null);
  // WB projects overlay refs
  const wbStatusFilterRef = useRef(wbStatusFilter);
  useEffect(() => { wbStatusFilterRef.current = wbStatusFilter; }, [wbStatusFilter]);
  const wbEnterHandlerRef = useRef<((e: any) => void) | null>(null);
  const wbLeaveHandlerRef = useRef<(() => void) | null>(null);
  const wbPopupRef = useRef<maplibregl.Popup | null>(null);

  const onUnitClickRef = useRef(onUnitClick);
  const onDrillDownRef = useRef(onDrillDown);
  useEffect(() => { onUnitClickRef.current = onUnitClick; }, [onUnitClick]);
  useEffect(() => { onDrillDownRef.current = onDrillDown; }, [onDrillDown]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxDeaths, setMaxDeaths] = useState(1000);
  const [maxRate, setMaxRate] = useState(100);
  const [maxEvents, setMaxEvents] = useState(100);

  const choroplethUrl = [
    `${BASE_URL}/api/spatial/choropleth`,
    `?level=${level}`,
    `&variable=${variable}`,
    `&start_year=${startYear}&start_month=${startMonth}`,
    `&end_year=${endYear}&end_month=${endMonth}`,
    `&rate_thresh=${rateThresh}&abs_thresh=${absThresh}&agg_thresh=${aggThresh}`,
    level === 3 ? `&affected_only=${affectedOnly}` : '',
    parentPcode ? `&parent_pcode=${encodeURIComponent(parentPcode)}` : '',
  ].join('');

  const eventsUrl = [
    `${BASE_URL}/api/spatial/events`,
    `?start_year=${startYear}&start_month=${startMonth}`,
    `&end_year=${endYear}&end_month=${endMonth}`,
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

  const removeWbLayer = useCallback(() => {
    if (!map.current) return;
    if (wbEnterHandlerRef.current) {
      map.current.off('mouseenter', WB_LAYER_ID, wbEnterHandlerRef.current);
      wbEnterHandlerRef.current = null;
    }
    if (wbLeaveHandlerRef.current) {
      map.current.off('mouseleave', WB_LAYER_ID, wbLeaveHandlerRef.current);
      wbLeaveHandlerRef.current = null;
    }
    if (map.current.getLayer(WB_LAYER_ID)) map.current.removeLayer(WB_LAYER_ID);
    if (map.current.getSource(WB_SOURCE_ID)) map.current.removeSource(WB_SOURCE_ID);
    wbPopupRef.current?.remove();
  }, []);

  const loadWbProjects = useCallback(async () => {
    if (!map.current) return;
    if (!showWbProjects) {
      removeWbLayer();
      return;
    }
    try {
      // Build a location-pin icon (teardrop) via canvas and register it in the map sprite
      function makePin(fill: string): ImageData {
        const w = 16, h = 20;
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        const cx = w / 2;
        const r = w / 2 - 1.5; // head radius

        // Drop shadow
        ctx.shadowColor = 'rgba(0,0,0,0.35)';
        ctx.shadowBlur = 3;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 2;

        // Pin body: head circle + tail
        ctx.beginPath();
        ctx.arc(cx, r + 1.5, r, Math.PI, 0); // top semicircle
        ctx.bezierCurveTo(cx + r, r + 1.5 + r * 0.6, cx + 3, h - 3, cx, h - 1); // right side down
        ctx.bezierCurveTo(cx - 3, h - 3, cx - r, r + 1.5 + r * 0.6, cx - r, r + 1.5); // left side up
        ctx.closePath();
        ctx.fillStyle = fill;
        ctx.fill();

        ctx.shadowColor = 'transparent';

        // White outline stroke
        ctx.strokeStyle = 'rgba(255,255,255,0.9)';
        ctx.lineWidth = 1.5;
        ctx.stroke();

        // White circle hole in head
        ctx.beginPath();
        ctx.arc(cx, r + 1.5, r * 0.38, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.92)';
        ctx.fill();

        return ctx.getImageData(0, 0, w, h);
      }

      if (!map.current.hasImage('wb-active')) map.current.addImage('wb-active', makePin('#009fda') as any);
      if (!map.current.hasImage('wb-closed')) map.current.addImage('wb-closed', makePin('#888888') as any);
      if (!map.current.hasImage('wb-other'))  map.current.addImage('wb-other',  makePin('#f59e0b') as any);

      const res = await fetch(`${BASE_URL}/api/wb-projects`);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const geojson = await res.json();

      removeWbLayer();

      map.current.addSource(WB_SOURCE_ID, { type: 'geojson', data: geojson });
      map.current.addLayer({
        id: WB_LAYER_ID,
        type: 'symbol',
        source: WB_SOURCE_ID,
        layout: {
          'icon-image': [
            'match', ['get', 'status'],
            'Active', 'wb-active',
            'Closed', 'wb-closed',
            'wb-other',
          ],
          'icon-size': 0.9,
          'icon-allow-overlap': true,
          'icon-ignore-placement': true,
        },
      });

      // Apply the current status filter immediately after the layer is created
      const initialFilter = wbStatusFilterRef.current;
      const expanded = initialFilter.flatMap((s) => (s === 'Other' ? [s, ''] : [s]));
      if (expanded.length > 0) {
        map.current.setFilter(WB_LAYER_ID, ['in', ['get', 'status'], ['literal', expanded]] as any);
      }

      if (!wbPopupRef.current) {
        wbPopupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      }
      const popup = wbPopupRef.current;

      const enterHandler = (e: any) => {
        if (!map.current) return;
        map.current.getCanvas().style.cursor = 'pointer';
        const props = (e.features?.[0]?.properties ?? {}) as Record<string, any>;
        popup.setLngLat(e.lngLat).setHTML(buildWbPopupHtml(props)).addTo(map.current);
      };
      const leaveHandler = () => {
        if (!map.current) return;
        map.current.getCanvas().style.cursor = '';
        popup.remove();
      };

      wbEnterHandlerRef.current = enterHandler;
      wbLeaveHandlerRef.current = leaveHandler;
      map.current.on('mouseenter', WB_LAYER_ID, enterHandler);
      map.current.on('mouseleave', WB_LAYER_ID, leaveHandler);
    } catch {
      // Non-fatal
    }
  }, [showWbProjects, removeWbLayer]);

  const loadEvents = useCallback(async () => {
    if (!map.current) return;
    if (!showEvents) {
      removeEventsLayer();
      return;
    }
    try {
      const res = await fetch(eventsUrl);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const geojson = await res.json();

      // Remove old events layer/source before re-adding
      removeEventsLayer();

      map.current.addSource(EVENTS_SOURCE_ID, { type: 'geojson', data: geojson });
      map.current.addLayer({
        id: EVENTS_LAYER_ID,
        type: 'circle',
        source: EVENTS_SOURCE_ID,
        paint: {
          'circle-color': [
            'match',
            ['get', 'event_type'],
            'Battles', '#e31a1c',
            'Violence against civilians', '#ff7f00',
            'Explosions/Remote violence', '#6a3d9a',
            'Riots', '#1f78b4',
            'Protests', '#33a02c',
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
        eventsPopupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
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
    } catch {
      // Non-fatal: events overlay failure shouldn't break the map
    }
  }, [showEvents, eventsUrl, removeEventsLayer]);

  const loadChoropleth = useCallback(async () => {
    if (!map.current) return;
    setLoading(true);
    setError(null);
    try {
      // ── DENSITY HEATMAP BRANCH ─────────────────────────────────────────────
      if (variable === 'density') {
        // Remove choropleth layers
        if (enterHandlerRef.current) { map.current.off('mouseenter', FILL_ID, enterHandlerRef.current); enterHandlerRef.current = null; }
        if (leaveHandlerRef.current) { map.current.off('mouseleave', FILL_ID, leaveHandlerRef.current); leaveHandlerRef.current = null; }
        if (clickHandlerRef.current) { map.current.off('click', FILL_ID, clickHandlerRef.current); clickHandlerRef.current = null; }
        if (map.current.getLayer(OUTLINE_ID)) map.current.removeLayer(OUTLINE_ID);
        if (map.current.getLayer(FILL_ID)) map.current.removeLayer(FILL_ID);
        if (map.current.getSource(SOURCE_ID)) map.current.removeSource(SOURCE_ID);
        // Remove old density layer
        if (map.current.getLayer(DENSITY_LAYER_ID)) map.current.removeLayer(DENSITY_LAYER_ID);
        if (map.current.getSource(DENSITY_SOURCE_ID)) map.current.removeSource(DENSITY_SOURCE_ID);

        const evRes = await fetch(eventsUrl);
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

      const res = await fetch(choroplethUrl);
      if (!res.ok) throw new Error(`API error ${res.status}`);
      const geojson = await res.json();

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
        map.current.off('mouseenter', FILL_ID, enterHandlerRef.current);
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
      const wbExists = !!map.current.getLayer(WB_LAYER_ID);
      const beforeLayer = eventsExists ? EVENTS_LAYER_ID : wbExists ? WB_LAYER_ID : undefined;

      map.current.addLayer({
        id: FILL_ID,
        type: 'fill',
        source: SOURCE_ID,
        paint: {
          'fill-color': getChoroplethColor(variable, level, localMax, localMaxRate, localMaxEvents) as any,
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
        popupRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false });
      }
      const popup = popupRef.current;

      const enterHandler = (e: any) => {
        if (!map.current) return;
        map.current.getCanvas().style.cursor = 'pointer';
        const props = (e.features?.[0]?.properties ?? {}) as Record<string, any>;
        popup.setLngLat(e.lngLat).setHTML(buildPopupHtml(props, level) + actionHint(level)).addTo(map.current);
      };
      const leaveHandler = () => {
        if (!map.current) return;
        map.current.getCanvas().style.cursor = '';
        popup.remove();
      };

      enterHandlerRef.current = enterHandler;
      leaveHandlerRef.current = leaveHandler;
      map.current.on('mouseenter', FILL_ID, enterHandler);
      map.current.on('mouseleave', FILL_ID, leaveHandler);

      const clickHandler = (e: any) => {
        const feature = e.features?.[0];
        if (!feature) return;
        const props = (feature.properties ?? {}) as Record<string, any>;

        if (level < 3) {
          // Zoom to the clicked polygon's bounding box
          if (feature.geometry) {
            const bbox = featureBbox(feature.geometry);
            map.current!.fitBounds(bbox, { padding: 60, duration: 700, maxZoom: 10 });
          }
          const pcode = level === 1 ? (props.ADM1_PCODE ?? '') : (props.ADM2_PCODE ?? '');
          const name  = level === 1 ? (props.ADM1_EN  ?? '') : (props.ADM2_EN  ?? '');
          onDrillDownRef.current?.({ level: level as 1 | 2, pcode, name });
          // Also fire unit-click so the history panel opens for state/LGA
          onUnitClickRef.current?.({ ...props, _clickedLevel: level });
        } else {
          onUnitClickRef.current?.(props);
        }
      };
      clickHandlerRef.current = clickHandler;
      map.current.on('click', FILL_ID, clickHandler);
    } catch (e: any) {
      setError(e.message ?? 'Failed to load map data');
    } finally {
      setLoading(false);
    }
  }, [choroplethUrl, eventsUrl, variable, level]);

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
      center: [8.6753, 9.082],
      zoom: 5.2,
    });

    map.current.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.current.on('load', () => {
      loadChoropleth();
      loadWbProjects();
      loadEvents();
      onMapReady?.(map.current!);
    });

    return () => {
      removeEventsLayer();
      removeWbLayer();
      popupRef.current = null;
      eventsPopupRef.current = null;
      wbPopupRef.current = null;
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

  // Load / remove WB projects overlay whenever showWbProjects changes
  useEffect(() => {
    if (map.current?.isStyleLoaded()) {
      loadWbProjects();
    }
  }, [loadWbProjects]);

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

  // Apply status filter on the WB layer without reloading data
  useEffect(() => {
    if (!map.current?.getLayer(WB_LAYER_ID)) return;
    // 'Other' maps to '' (empty string from unmatched master rows)
    const expanded = wbStatusFilter.flatMap((s) => (s === 'Other' ? [s, ''] : [s]));
    const filter = expanded.length > 0
      ? ['in', ['get', 'status'], ['literal', expanded]]
      : ['==', ['literal', false], ['literal', true]]; // show nothing
    map.current.setFilter(WB_LAYER_ID, filter as any);
  }, [wbStatusFilter]);

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
          <p className="font-semibold text-gray-700 mb-1.5">Ward Status</p>
          {[
            { color: '#d73027', label: 'Affected' },
            { color: '#fd8d3c', label: 'Below threshold' },
            { color: '#e8e8e8', label: 'No violence' },
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
        <p className="font-semibold text-gray-700 mb-1.5">Ward Share Affected</p>
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
          Loading{level === 3 ? ' ward data…' : '…'}
        </div>
      )}
      {error && (
        <div className="absolute top-3 left-3 bg-red-50 border border-red-200 px-3 py-1.5 rounded shadow text-sm text-red-600">
          {error}
        </div>
      )}
      <button
        onClick={() => map.current?.flyTo({ center: [8.6753, 9.082], zoom: 5.2, duration: 700 })}
        className="absolute top-[100px] right-[10px] bg-white rounded shadow p-1.5 hover:bg-gray-50 transition-colors z-10"
        title="Reset to full Nigeria view"
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
        {showWbProjects && (
          <div className="border-t border-gray-200 mt-2 pt-2">
            <p className="font-semibold text-gray-700 mb-1.5">WB Projects</p>
            {[
              { color: '#009fda', label: 'Active' },
              { color: '#888888', label: 'Closed' },
              { color: '#f59e0b', label: 'Other' },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5 mb-0.5">
                <svg width="8" height="10" viewBox="0 0 22 28" className="shrink-0">
                  <path
                    d="M11 1.5 C6.3 1.5 2.5 5.3 2.5 10 C2.5 14 11 26.5 11 26.5 C11 26.5 19.5 14 19.5 10 C19.5 5.3 15.7 1.5 11 1.5 Z"
                    fill={color} stroke="white" strokeWidth="1.5"
                  />
                  <circle cx="11" cy="10" r="3.5" fill="rgba(255,255,255,0.9)" />
                </svg>
                <span className="text-gray-600">{label}</span>
              </div>
            ))}
          </div>
        )}
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
