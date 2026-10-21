import { useId, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

/** Standard page frame: generous top spacing, big title, optional subtitle and actions. */
export function Page({
  title,
  subtitle,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('container-page pb-24 pt-12 sm:pt-16 animate-fade-up', className)}>
      <header className="mb-10 flex flex-col gap-6 sm:mb-14 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <h1 className="page-title">{title}</h1>
          {subtitle && <p className="mt-3 text-[19px] leading-[1.42] tracking-[-0.012em] text-secondary">{subtitle}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-3">{actions}</div>}
      </header>
      {children}
    </div>
  );
}

export function Section({
  title,
  aside,
  children,
  className,
  flush = false,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
  /** No top margin (first thing on the page). */
  flush?: boolean;
}) {
  const id = useId();
  return (
    <section className={cn(!flush && 'mt-14 sm:mt-20', className)} aria-labelledby={id}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-4">
        <h2 id={id} className="text-section">
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
