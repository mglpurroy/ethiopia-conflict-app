import { cn } from '@/lib/utils';
import { TrendArrow } from './TrendArrow';

interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  trend?: number;
  trendInvert?: boolean;
  icon?: React.ReactNode;
  variant?: 'gradient' | 'default';
  className?: string;
}

export function KpiCard({
  title,
  value,
  subtitle,
  trend,
  trendInvert,
  icon,
  variant = 'default',
  className,
}: KpiCardProps) {
  return (
    <div
      className={cn(
        'rounded-lg p-4 shadow-sm transition-transform hover:-translate-y-0.5 hover:shadow-md',
        variant === 'gradient'
          ? 'bg-gradient-to-br from-[#667eea] to-[#764ba2] text-white'
          : 'bg-white border-l-4 border-l-[#667eea]',
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <p
            className={cn(
              'text-xs font-semibold uppercase tracking-wide mb-1',
              variant === 'gradient' ? 'text-white/80' : 'text-gray-500',
            )}
          >
            {title}
          </p>
          <div
            className={cn(
              'text-2xl font-bold leading-tight',
              variant === 'gradient' ? 'text-white' : 'text-gray-900',
            )}
          >
            {typeof value === 'number' ? value.toLocaleString() : value}
          </div>
          {(subtitle || trend !== undefined) && (
            <div className="mt-1 flex items-center gap-2">
              {trend !== undefined && (
                <TrendArrow value={trend} invert={trendInvert} />
              )}
              {subtitle && (
                <span
                  className={cn(
                    'text-xs',
                    variant === 'gradient' ? 'text-white/70' : 'text-gray-500',
                  )}
                >
                  {subtitle}
                </span>
              )}
            </div>
          )}
        </div>
        {icon && (
          <div
            className={cn(
              'flex-shrink-0 text-2xl',
              variant === 'gradient' ? 'text-white/60' : 'text-[#667eea]/60',
            )}
          >
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}
