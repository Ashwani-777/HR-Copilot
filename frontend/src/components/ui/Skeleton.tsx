import { cn } from '../../lib/cn';

/** Surface-coloured placeholder that gently pulses (static under reduced motion). */
export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('animate-pulse rounded-input bg-surface', className)} aria-hidden="true" />;
}

export function SkeletonRows({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('flex flex-col gap-3', className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
