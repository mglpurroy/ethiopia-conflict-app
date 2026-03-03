'use client';

import { useState } from 'react';
import { useActors } from '@/lib/hooks/useConflicts';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import { Users, RefreshCw } from 'lucide-react';

const ALL_EVENT_TYPES = [
  'Battles',
  'Violence against civilians',
  'Explosions/Remote violence',
  'Strategic developments',
  'Riots',
  'Protests',
] as const;

const ALL_ACTOR_TYPES = [
  'State forces',
  'Rebel group',
  'Political militia',
  'Identity militia',
  'External/Other forces',
  'Civilians',
  'Rioters',
  'Protesters',
] as const;

const DEFAULT_EXCLUDED_EVENTS = new Set(['Protests', 'Riots']);
const DEFAULT_EXCLUDED_ACTORS = new Set(['Rioters', 'Civilians', 'State forces', 'Protesters']);

type DetailTab = 'timeline' | 'geography' | 'profile';

export default function ActorsPage() {
  const [selectedActor, setSelectedActor] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DetailTab>('timeline');
  const [profileRefreshKey, setProfileRefreshKey] = useState(0);
  const [topN, setTopN] = useState(20);
  const [sortKey, setSortKey] = useState<'deaths' | 'events'>('deaths');
  const [includedEventTypes, setIncludedEventTypes] = useState<Set<string>>(
    new Set(ALL_EVENT_TYPES.filter((t) => !DEFAULT_EXCLUDED_EVENTS.has(t))),
  );
  const [includedActorTypes, setIncludedActorTypes] = useState<Set<string>>(
    new Set(ALL_ACTOR_TYPES.filter((t) => !DEFAULT_EXCLUDED_ACTORS.has(t))),
  );

  const eventTypesParam =
    includedEventTypes.size === ALL_EVENT_TYPES.length
      ? undefined
      : [...includedEventTypes].join(',') || undefined;

  const actorTypesParam =
    includedActorTypes.size === ALL_ACTOR_TYPES.length
      ? undefined
      : [...includedActorTypes].join(',') || undefined;

  const { data: actors, isLoading } = useActors({
    top_n: topN,
    event_types: eventTypesParam,
    actor_types: actorTypesParam,
  });

  const { data: timeline } = useQuery({
    queryKey: ['actor-timeline', selectedActor, eventTypesParam],
    queryFn: () => api.actorTimeline(selectedActor!, 'monthly', eventTypesParam),
    enabled: !!selectedActor,
  });

  const { data: geography } = useQuery({
    queryKey: ['actor-geo', selectedActor, eventTypesParam],
    queryFn: () => api.actorGeography(selectedActor!, eventTypesParam),
    enabled: !!selectedActor,
  });

  const { data: profile, isLoading: profileLoading } = useQuery({
    queryKey: ['actor-profile', selectedActor, profileRefreshKey],
    queryFn: () => api.actorProfile(selectedActor!),
    enabled: !!selectedActor && detailTab === 'profile',
    staleTime: 60 * 60 * 1000, // 1 hour — matches server cache TTL
  });

  const resetActor = () => {
    setSelectedActor(null);
    setDetailTab('timeline');
  };

  const toggleEventType = (type: string) => {
    setIncludedEventTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
    resetActor();
  };

  const toggleActorType = (type: string) => {
    setIncludedActorTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type); else next.add(type);
      return next;
    });
    resetActor();
  };

  const sorted = [...(actors ?? [])].sort((a, b) => b[sortKey] - a[sortKey]);

  const TABS: { key: DetailTab; label: string }[] = [
    { key: 'timeline', label: 'Timeline' },
    { key: 'geography', label: 'Geography' },
    { key: 'profile', label: 'AI Profile' },
  ];

  return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-[#667eea] to-[#764ba2] rounded-xl p-4 text-white flex items-center gap-3">
        <Users className="h-5 w-5" />
        <div>
          <h1 className="text-lg font-bold">Actor Profiles</h1>
          <p className="text-white/80 text-xs">Top armed actors by fatalities and activity patterns</p>
        </div>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Actor Table */}
        <div className="bg-white rounded-lg shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b bg-gray-50">
            <div className="flex items-center justify-between mb-2.5">
              <h2 className="font-semibold text-sm text-gray-900">Top Actors by Fatalities</h2>
              <div className="flex gap-2 items-center">
                <div className="flex gap-1">
                  {(['deaths', 'events'] as const).map((k) => (
                    <button
                      key={k}
                      onClick={() => setSortKey(k)}
                      className={`text-xs px-2 py-1 rounded border capitalize ${
                        sortKey === k ? 'bg-[#667eea] text-white border-[#667eea]' : 'border-gray-200 text-gray-600'
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                <select
                  value={topN}
                  onChange={(e) => setTopN(Number(e.target.value))}
                  className="text-xs border border-gray-200 rounded px-2 py-1"
                >
                  <option value={10}>Top 10</option>
                  <option value={20}>Top 20</option>
                  <option value={50}>Top 50</option>
                </select>
              </div>
            </div>
            {/* Event type filter */}
            <div className="flex flex-wrap gap-1.5 mb-1.5">
              <span className="text-xs text-gray-400 self-center mr-0.5">Events:</span>
              {ALL_EVENT_TYPES.map((type) => {
                const active = includedEventTypes.has(type);
                return (
                  <button
                    key={type}
                    onClick={() => toggleEventType(type)}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                      active
                        ? 'bg-[#667eea] text-white border-[#667eea]'
                        : 'bg-white text-gray-400 border-gray-200 line-through'
                    }`}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
            {/* Actor type filter */}
            <div className="flex flex-wrap gap-1.5">
              <span className="text-xs text-gray-400 self-center mr-0.5">Actors:</span>
              {ALL_ACTOR_TYPES.map((type) => {
                const active = includedActorTypes.has(type);
                return (
                  <button
                    key={type}
                    onClick={() => toggleActorType(type)}
                    className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${
                      active
                        ? 'bg-[#764ba2] text-white border-[#764ba2]'
                        : 'bg-white text-gray-400 border-gray-200 line-through'
                    }`}
                  >
                    {type}
                  </button>
                );
              })}
            </div>
          </div>
          {isLoading ? (
            <div className="p-8 text-center text-gray-400">Loading…</div>
          ) : (
            <div className="overflow-y-auto max-h-[500px]">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b sticky top-0">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-semibold text-gray-600">#</th>
                    <th className="px-4 py-2.5 text-left font-semibold text-gray-600">Actor</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Deaths</th>
                    <th className="px-4 py-2.5 text-right font-semibold text-gray-600">Events</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((actor, i) => (
                    <tr
                      key={actor.actor}
                      onClick={() => {
                        setSelectedActor(actor.actor);
                        setDetailTab('timeline');
                      }}
                      className={`border-b last:border-0 cursor-pointer transition-colors ${
                        selectedActor === actor.actor ? 'bg-indigo-50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <td className="px-4 py-2.5 text-gray-400 font-mono text-xs">{i + 1}</td>
                      <td className="px-4 py-2.5 text-gray-900 max-w-[220px] truncate">{actor.actor}</td>
                      <td className="px-4 py-2.5 text-right font-mono font-semibold">
                        {actor.deaths.toLocaleString()}
                      </td>
                      <td className="px-4 py-2.5 text-right font-mono">{actor.events.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Actor Detail */}
        <div className="space-y-0">
          {!selectedActor ? (
            <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-400">
              <Users className="h-8 w-8 mx-auto mb-2 opacity-30" />
              <p className="text-sm">Select an actor from the table to view their profile</p>
            </div>
          ) : (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              {/* Actor header */}
              <div className="px-4 pt-4 pb-3 border-b">
                <h3 className="font-semibold text-gray-900 text-sm truncate">{selectedActor}</h3>
                <div className="flex items-center gap-4 mt-1">
                  {actors && (() => {
                    const a = actors.find(x => x.actor === selectedActor);
                    return a ? (
                      <>
                        <span className="text-xs text-gray-500">{a.deaths.toLocaleString()} deaths</span>
                        <span className="text-xs text-gray-400">·</span>
                        <span className="text-xs text-gray-500">{a.events.toLocaleString()} events</span>
                      </>
                    ) : null;
                  })()}
                </div>
              </div>

              {/* Tab bar */}
              <div className="flex border-b bg-gray-50">
                {TABS.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setDetailTab(tab.key)}
                    className={`px-4 py-2.5 text-xs font-medium border-b-2 transition-colors ${
                      detailTab === tab.key
                        ? 'border-[#667eea] text-[#667eea] bg-white'
                        : 'border-transparent text-gray-500 hover:text-gray-700'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>

              {/* Tab content */}
              <div className="p-4">
                {detailTab === 'timeline' && (
                  <>
                    <p className="text-xs text-gray-500 mb-3">Activity Timeline (monthly)</p>
                    {timeline ? (
                      <ResponsiveContainer width="100%" height={220}>
                        <LineChart data={timeline} margin={{ top: 4, right: 8, left: 0, bottom: 4 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#e1e4e8" />
                          <XAxis
                            dataKey="period"
                            tick={{ fontSize: 9 }}
                            tickFormatter={(v) => String(v).slice(0, 7)}
                            interval="preserveStartEnd"
                          />
                          <YAxis tick={{ fontSize: 10 }} />
                          <Tooltip />
                          <Line type="monotone" dataKey="deaths" stroke="#c0392b" strokeWidth={2} dot={false} name="Deaths" />
                          <Line type="monotone" dataKey="events" stroke="#667eea" strokeWidth={1.5} dot={false} name="Events" />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-52 bg-gray-100 animate-pulse rounded" />
                    )}
                  </>
                )}

                {detailTab === 'geography' && (
                  <>
                    <p className="text-xs text-gray-500 mb-3">Geographic Distribution (by state)</p>
                    {geography ? (
                      <ResponsiveContainer width="100%" height={240}>
                        <BarChart
                          data={Object.values(
                            geography.reduce((acc: Record<string, { admin1: string; deaths: number; events: number }>, row: any) => {
                              const key = row.admin1;
                              if (!acc[key]) acc[key] = { admin1: key, deaths: 0, events: 0 };
                              acc[key].deaths += row.deaths;
                              acc[key].events += row.events;
                              return acc;
                            }, {})
                          ).sort((a, b) => b.deaths - a.deaths).slice(0, 10)}
                          layout="vertical"
                          margin={{ left: 70, right: 8 }}
                        >
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#e1e4e8" />
                          <XAxis type="number" tick={{ fontSize: 9 }} />
                          <YAxis type="category" dataKey="admin1" tick={{ fontSize: 10 }} width={80} />
                          <Tooltip />
                          <Bar dataKey="deaths" fill="#667eea" radius={[0, 3, 3, 0]} name="Deaths" />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-56 bg-gray-100 animate-pulse rounded" />
                    )}
                  </>
                )}

                {detailTab === 'profile' && (
                  <div>
                    {profileLoading ? (
                      <div className="space-y-2 py-2">
                        <div className="h-4 bg-gray-100 animate-pulse rounded w-full" />
                        <div className="h-4 bg-gray-100 animate-pulse rounded w-5/6" />
                        <div className="h-4 bg-gray-100 animate-pulse rounded w-full" />
                        <div className="h-4 bg-gray-100 animate-pulse rounded w-4/5" />
                        <div className="h-4 bg-gray-100 animate-pulse rounded w-full" />
                        <div className="h-4 bg-gray-100 animate-pulse rounded w-3/4" />
                        <p className="text-xs text-gray-400 pt-1 text-center">Generating intelligence profile…</p>
                      </div>
                    ) : profile ? (
                      <>
                        <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded px-2.5 py-1.5 mb-2">
                          <span>⚠</span>
                          <span>AI-generated analysis · Based on ACLED data · Verify before operational use</span>
                        </div>
                        <div className="bg-gray-50 rounded-lg p-3 text-xs text-gray-700 leading-relaxed whitespace-pre-wrap border border-gray-100">
                          {profile.profile}
                        </div>
                        <div className="flex items-center justify-between mt-2 text-xs text-gray-400">
                          <span>
                            {profile.event_count.toLocaleString()} events · generated{' '}
                            {new Date(profile.generated_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <button
                            onClick={() => setProfileRefreshKey((k) => k + 1)}
                            className="flex items-center gap-1 text-[#667eea] hover:underline"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Regenerate
                          </button>
                        </div>
                      </>
                    ) : null}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
