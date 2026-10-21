import { cn } from '../../lib/cn';

export function ProgressBar({
  value,
  indeterminate = false,
  label,
  className,
}: {
  value: number;
  indeterminate?: boolean;
  label: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={indeterminate ? undefined : pct}
      className={cn('relative h-1 w-full overflow-hidden rounded-pill bg-hairline/60', className)}
    >
      {indeterminate ? (
        <div className="absolute inset-y-0 left-0 w-2/5 animate-indeterminate rounded-pill bg-ink" />
      ) : (
        <div className="h-full rounded-pill bg-ink transition-[width] duration-300 ease-out" style={{ width: `${pct}%` }} />
      )}
    </div>
  );
}
