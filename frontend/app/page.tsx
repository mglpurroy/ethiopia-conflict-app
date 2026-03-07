'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, BarChart3, Map, TrendingUp } from 'lucide-react';

import { api } from '@/lib/api';
import type { SummaryKPIs } from '@/lib/types';

// ── Trajectory arc data ────────────────────────────────────────────────────
// Pre-calculated points along: M 20 200 C 140 55, 720 55, 900 200
const ARC_STEPS: {
  label: string[];
  color: string;
  above: boolean;
  x: number;
  y: number;
}[] = [
  { label: ['Below',    'Threshold'],          color: '#9ca3af', above: false, x: 20,  y: 200 },
  { label: ['At-Risk'],                         color: '#f97316', above: true,  x: 69,  y: 161 },
  { label: ['Onset'],                           color: '#dc2626', above: false, x: 140, y: 130 },
  { label: ['LT',       'Conflict'],            color: '#b91c1c', above: true,  x: 229, y: 109 },
  { label: ['Escalation'],                      color: '#ea580c', above: false, x: 330, y: 96  },
  { label: ['LT High',  'Conflict'],            color: '#7f1d1d', above: true,  x: 438, y: 91  },
  { label: ['Decreasing','Conflict'],           color: '#0284c7', above: false, x: 618, y: 103 },
  { label: ['Recovery'],                        color: '#16a34a', above: true,  x: 781, y: 140 },
  { label: ['Below',    'Threshold'],           color: '#9ca3af', above: false, x: 900, y: 200 },
];

const TRAJECTORY_ROWS = [
  { color: '#7f1d1d', name: 'LT High Conflict',    desc: '≥ 3 highly conflict-affected periods in the last 4 cycles.' },
  { color: '#b91c1c', name: 'LT Conflict',          desc: '≥ 3 conflict-affected periods in the last 4 cycles.' },
  { color: '#ea580c', name: 'Escalation',            desc: 'Recent transition into a highly conflict-affected status.' },
  { color: '#dc2626', name: 'Onset',                 desc: 'New conflict emergence following a period of relative calm.' },
  { color: '#f97316', name: 'At-Risk',               desc: 'Early warning — at least one conflict episode in the last 3 cycles.' },
  { color: '#0284c7', name: 'Decreasing Conflict',   desc: 'Decline from highly conflict-affected status in recent cycles.' },
  { color: '#16a34a', name: 'Recovery',              desc: 'Transitioning toward peace within 6 cycles of last conflict.' },
  { color: '#9ca3af', name: 'Below Threshold',       desc: 'No persistent conflict detected. Default classification.' },
];

const STATUS_ROWS = [
  { dot: '#d1d5db', label: 'Below threshold',         criteria: 'Zero events recorded, or events recorded but classification thresholds not met.' },
  { dot: '#ef4444', label: 'Conflict-Affected',       criteria: 'Death rate ≥ 2.0 / 100k population AND ≥ 5 deaths AND ≥ 2 events.' },
  { dot: '#7f1d1d', label: 'Highly Conflict-Affected',criteria: 'Death rate ≥ 10.0 / 100k population AND ≥ 20 deaths AND ≥ 3 events.' },
];

// ── Components ────────────────────────────────────────────────────────────

export default function HomePage() {
  const [summary, setSummary] = useState<SummaryKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api.summary()
      .then((data) => { if (mounted) setSummary(data); })
      .catch((e) => { if (mounted) setError(e instanceof Error ? e.message : 'Failed to load summary'); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  const updated = summary?.last_update
    ? new Date(summary.last_update).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })
    : 'N/A';

  return (
    <div className="space-y-5">

      {/* Hero */}
      <section className="rounded-xl bg-gradient-to-r from-[#2f6f85] to-[#3f8a67] p-6 text-white">
        <div className="flex items-center gap-2 text-sm text-white/90">
          <AlertTriangle className="h-4 w-4" />
          Ethiopia Conflict Dashboard
        </div>
        <h1 className="mt-2 text-2xl font-bold">Current Situation</h1>
        <p className="mt-1 text-sm text-white/85">
          Ethiopia-first monitoring baseline with ACLED event analytics and admin-level drilldowns.
        </p>
      </section>

      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</div>
      )}

      {/* KPIs */}
      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <KpiCard title="Total Events"    value={loading ? '...' : (summary?.total_events.toLocaleString() ?? '0')}   icon={<BarChart3 className="h-4 w-4" />} />
        <KpiCard title="Total Fatalities" value={loading ? '...' : (summary?.total_deaths.toLocaleString() ?? '0')}   icon={<TrendingUp className="h-4 w-4" />} />
        <KpiCard title="Affected Woredas" value={loading ? '...' : `${summary?.woredas_affected.toLocaleString() ?? '0'} / ${summary?.total_woredas.toLocaleString() ?? '0'}`} icon={<Map className="h-4 w-4" />} />
        <KpiCard title="Last Update"      value={updated} icon={<AlertTriangle className="h-4 w-4" />} />
      </section>

      {/* Quick links */}
      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Quick Start</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <QuickLink href="/spatial"       title="Interactive Maps"  body="Explore classification layers, incidents, and admin-level drilldowns." />
          <QuickLink href="/explorer"      title="Trend Analysis"    body="Inspect location trajectories and period-based conflict trend history." />
          <QuickLink href="/absolute-data" title="Absolute Data"     body="Compare fatalities/events across selected locations with aligned series." />
        </div>
      </section>

      {/* Trajectory arc */}
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Conflict Trajectory Framework</h2>
        <p className="mt-1 text-xs text-gray-500 max-w-2xl">
          Each woreda is assigned a trajectory category based on how its conflict status has evolved across recent
          12-month analysis periods. The arch below shows the full conflict lifecycle — from peace through
          escalation and back to recovery.
        </p>
        <div className="mt-4 overflow-x-auto">
          <TrajectoryArc />
        </div>
        <div className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {TRAJECTORY_ROWS.map((r) => (
            <div key={r.name} className="flex items-start gap-2 rounded-md border border-gray-100 px-3 py-2">
              <span className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{ background: r.color }} />
              <div>
                <p className="text-xs font-semibold text-gray-800">{r.name}</p>
                <p className="text-[11px] text-gray-500 leading-snug mt-0.5">{r.desc}</p>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Conflict metrics methodology */}
      <section className="rounded-lg bg-white p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">How Conflict Metrics Are Constructed</h2>
        <p className="mt-1 text-xs text-gray-500 max-w-2xl">
          Classification is based on ACLED data aggregated over 12-month periods (January–December and
          July–June), refreshed every 6 months. Each woreda is evaluated against three combined thresholds.
        </p>

        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-gray-100">
                <th className="pb-2 text-left font-semibold text-gray-600 pr-4">Status</th>
                <th className="pb-2 text-left font-semibold text-gray-600">Classification criteria</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {STATUS_ROWS.map((r) => (
                <tr key={r.label}>
                  <td className="py-2 pr-4">
                    <div className="flex items-center gap-2">
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full border border-gray-200" style={{ background: r.dot }} />
                      <span className="font-medium text-gray-800 whitespace-nowrap">{r.label}</span>
                    </div>
                  </td>
                  <td className="py-2 text-gray-500">{r.criteria}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-4 rounded-md bg-gray-50 px-3 py-2.5 text-[11px] text-gray-500 leading-relaxed">
          <span className="font-semibold text-gray-700">Analysis periods: </span>
          Strictly Jan–Dec and Jul–Jun 12-month windows, generated every 6 months. Only fully covered
          periods are included. Population denominators use WorldPop 2025 zonal statistics at woreda level.
        </div>
      </section>

    </div>
  );
}

function TrajectoryArc() {
  return (
    <svg viewBox="0 0 920 248" className="w-full" style={{ minWidth: 600 }}>
      {/* Arch baseline */}
      <path d="M 20 200 C 140 55, 720 55, 900 200" fill="none" stroke="#e5e7eb" strokeWidth="2.5" strokeLinecap="round" />

      {/* Arrowhead at end */}
      <path d="M 888 193 L 902 200 L 888 207" fill="none" stroke="#d1d5db" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />

      {/* Phase labels on arch */}
      <text x="200" y="72" textAnchor="middle" fontSize="9" fill="#d1d5db" letterSpacing="1">ESCALATING →</text>
      <text x="660" y="72" textAnchor="middle" fontSize="9" fill="#d1d5db" letterSpacing="1">← DE-ESCALATING</text>

      {ARC_STEPS.map((step, i) => {
        const anchor = i === 0 ? 'start' : i === 8 ? 'end' : 'middle';
        const isPeak = i === 5;
        const labelY = step.above ? step.y - 30 : step.y + 20;

        return (
          <g key={i}>
            {/* Tick from dot to label */}
            <line
              x1={step.x} y1={step.y}
              x2={step.x} y2={step.above ? step.y - 12 : step.y + 10}
              stroke={step.color} strokeWidth="1.5"
            />
            {/* Dot */}
            <circle
              cx={step.x} cy={step.y}
              r={isPeak ? 7 : 5}
              fill={step.color}
              stroke={isPeak ? '#fff' : 'none'}
              strokeWidth={isPeak ? 2 : 0}
            />
            {/* Label lines */}
            {step.label.map((line, li) => (
              <text
                key={li}
                x={step.x}
                y={labelY + li * 13}
                textAnchor={anchor}
                fontSize={isPeak ? 11 : 10}
                fontWeight={isPeak ? '700' : '500'}
                fill={isPeak ? step.color : '#374151'}
              >
                {line}
              </text>
            ))}
          </g>
        );
      })}
    </svg>
  );
}

function KpiCard({ title, value, icon }: { title: string; value: string; icon: ReactNode }) {
  return (
    <div className="rounded-lg bg-white p-4 shadow-sm">
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{title}</span>
        {icon}
      </div>
      <p className="mt-2 text-lg font-semibold text-gray-900">{value}</p>
    </div>
  );
}

function QuickLink({ href, title, body }: { href: string; title: string; body: string }) {
  return (
    <Link href={href} className="rounded-lg border border-gray-200 p-3 transition-colors hover:border-[#3f8a67] hover:bg-gray-50">
      <p className="text-sm font-semibold text-gray-900">{title}</p>
      <p className="mt-1 text-xs text-gray-600">{body}</p>
    </Link>
  );
}
