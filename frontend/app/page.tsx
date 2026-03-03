'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { AlertTriangle, BarChart3, Map, TrendingUp } from 'lucide-react';

import { api } from '@/lib/api';
import type { SummaryKPIs } from '@/lib/types';

export default function HomePage() {
  const [summary, setSummary] = useState<SummaryKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    api
      .summary()
      .then((data) => {
        if (mounted) setSummary(data);
      })
      .catch((e) => {
        if (mounted) setError(e instanceof Error ? e.message : 'Failed to load summary');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
    };
  }, []);

  const updated = summary?.last_update
    ? new Date(summary.last_update).toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      })
    : 'N/A';

  return (
    <div className="space-y-5">
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
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 md:grid-cols-4">
        <KpiCard
          title="Total Events"
          value={loading ? '...' : (summary?.total_events.toLocaleString() ?? '0')}
          icon={<BarChart3 className="h-4 w-4" />}
        />
        <KpiCard
          title="Total Fatalities"
          value={loading ? '...' : (summary?.total_deaths.toLocaleString() ?? '0')}
          icon={<TrendingUp className="h-4 w-4" />}
        />
        <KpiCard
          title="Affected Woredas"
          value={loading ? '...' : `${summary?.wards_affected.toLocaleString() ?? '0'} / ${summary?.total_wards.toLocaleString() ?? '0'}`}
          icon={<Map className="h-4 w-4" />}
        />
        <KpiCard title="Last Update" value={updated} icon={<AlertTriangle className="h-4 w-4" />} />
      </section>

      <section className="rounded-lg bg-white p-4 shadow-sm">
        <h2 className="text-sm font-semibold text-gray-900">Quick Start</h2>
        <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
          <QuickLink
            href="/spatial"
            title="Interactive Maps"
            body="Explore classification layers, incidents, and admin-level drilldowns."
          />
          <QuickLink
            href="/explorer"
            title="Trend Analysis"
            body="Inspect location trajectories and period-based conflict trend history."
          />
          <QuickLink
            href="/absolute-data"
            title="Absolute Data"
            body="Compare fatalities/events across selected locations with aligned series."
          />
        </div>
      </section>
    </div>
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
