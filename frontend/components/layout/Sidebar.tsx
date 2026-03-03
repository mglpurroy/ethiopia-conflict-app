'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
  AlertTriangle,
  BarChart2,
  Map,
  Search,
  Database,
} from 'lucide-react';

const navItems = [
  { href: '/', label: 'Home', icon: AlertTriangle },
  { href: '/spatial', label: 'Interactive Maps', icon: Map },
  { href: '/explorer', label: 'Trend Analysis', icon: Search },
  { href: '/absolute-data', label: 'Absolute Data', icon: Database },
];

export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="flex flex-col w-56 min-h-screen bg-gray-900 text-white shrink-0">
      <div className="px-4 py-5 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded bg-gradient-to-br from-[#667eea] to-[#764ba2] flex items-center justify-center shrink-0">
            <BarChart2 className="h-4 w-4 text-white" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-sm font-bold leading-tight">Ethiopia</p>
              <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-amber-500/20 text-amber-400 leading-none tracking-wide uppercase">Beta</span>
            </div>
            <p className="text-xs text-gray-400 leading-tight">Conflict Monitor</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 py-4 space-y-0.5 px-2">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-md text-sm font-medium transition-colors',
                active
                  ? 'bg-[#667eea] text-white'
                  : 'text-gray-300 hover:bg-gray-800 hover:text-white',
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              {label}
            </Link>
          );
        })}
      </nav>

      <div className="px-4 py-3 border-t border-gray-700">
        <p className="text-xs text-gray-500">ACLED Ethiopia</p>
        <p className="text-xs text-gray-600">2009 - Present</p>
      </div>
    </aside>
  );
}
