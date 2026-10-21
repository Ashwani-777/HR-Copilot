import type { ReactNode } from 'react';
import { cn } from '../../lib/cn';

export type Tone = 'green' | 'orange' | 'red' | 'neutral';

const dot: Record<Tone, string> = {
  green: 'bg-green',
  orange: 'bg-orange',
  red: 'bg-red',
  neutral: 'bg-tertiary',
};

const text: Record<Tone, string> = {
  green: 'text-green',
  orange: 'text-orange',
  red: 'text-red',
  neutral: 'text-secondary',
};

/** Colour is used only as a tiny dot + coloured label — never as a fill. */
export function StatusDot({ tone, children, className }: { tone: Tone; children?: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex items-center gap-2 text-small font-medium', text[tone], className)}>
      <span className={cn('h-2 w-2 shrink-0 rounded-full', dot[tone])} aria-hidden="true" />
      {children}
    </span>
  );
}

/** Neutral monochrome pill label, e.g. leave type or role. */
export function Badge({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 items-center rounded-pill bg-white px-2.5 text-caption font-medium text-secondary ring-1 ring-inset ring-hairline',
        className,
      )}
    >
      {children}
    </span>
  );
}
