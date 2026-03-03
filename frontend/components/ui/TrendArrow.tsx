import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TrendArrowProps {
  value: number; // fraction, e.g. 0.3 = +30%
  invert?: boolean; // if true, positive = bad (red)
  showValue?: boolean;
}

export function TrendArrow({ value, invert = false, showValue = true }: TrendArrowProps) {
  const isUp = value > 0.005;
  const isDown = value < -0.005;
  const isPositiveGood = invert ? !isUp : isUp;

  const color = isUp
    ? invert
      ? 'text-red-600'
      : 'text-green-600'
    : isDown
      ? invert
        ? 'text-green-600'
        : 'text-red-600'
      : 'text-gray-400';

  const pct = `${value >= 0 ? '+' : ''}${(value * 100).toFixed(1)}%`;

  return (
    <span className={cn('inline-flex items-center gap-0.5 font-medium text-sm', color)}>
      {isUp ? (
        <TrendingUp className="h-4 w-4" />
      ) : isDown ? (
        <TrendingDown className="h-4 w-4" />
      ) : (
        <Minus className="h-4 w-4 text-gray-400" />
      )}
      {showValue && <span>{pct}</span>}
    </span>
  );
}
