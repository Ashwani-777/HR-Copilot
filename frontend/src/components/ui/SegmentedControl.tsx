import { cn } from '../../lib/cn';

type Option<T extends string> = { value: T; label: string; count?: number };

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex max-w-full overflow-x-auto rounded-pill bg-surface p-1 scrollbar-none', className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'h-8 shrink-0 rounded-pill px-4 text-small font-medium transition-[background-color,color,box-shadow] duration-200 ease-out',
              active ? 'bg-white text-ink shadow-soft' : 'text-secondary hover:text-ink',
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="ml-1.5 tabular-nums text-tertiary">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}
