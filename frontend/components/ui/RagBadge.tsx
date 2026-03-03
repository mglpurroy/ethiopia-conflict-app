import { cn } from '@/lib/utils';
import type { RagStatus } from '@/lib/types';

interface RagBadgeProps {
  status: RagStatus;
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

const config: Record<RagStatus, { label: string; classes: string }> = {
  red: { label: 'Red Alert', classes: 'bg-red-600 text-white' },
  amber: { label: 'Elevated', classes: 'bg-orange-600 text-white' },
  green: { label: 'Normal', classes: 'bg-green-600 text-white' },
};

const sizeClasses = {
  sm: 'px-2 py-0.5 text-xs rounded',
  md: 'px-3 py-1 text-sm rounded-md',
  lg: 'px-4 py-1.5 text-base rounded-md',
};

export function RagBadge({ status, size = 'md', showLabel = true }: RagBadgeProps) {
  const { label, classes } = config[status];
  return (
    <span className={cn('inline-flex items-center gap-1.5 font-semibold', classes, sizeClasses[size])}>
      <span className="inline-block h-2 w-2 rounded-full bg-white/80" />
      {showLabel && label}
    </span>
  );
}
