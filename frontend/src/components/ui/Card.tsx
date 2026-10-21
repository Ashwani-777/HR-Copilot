import type { HTMLAttributes, ReactNode } from 'react';
import { cn } from '../../lib/cn';

type CardProps = HTMLAttributes<HTMLElement> & {
  variant?: 'surface' | 'outline';
  padding?: 'none' | 'md' | 'lg';
  as?: 'div' | 'section' | 'article' | 'li' | 'ul';
};

export function Card({ variant = 'surface', padding = 'md', as = 'div', className, ...rest }: CardProps) {
  const Tag = as as 'div'; // all variants accept the same global attributes
  return (
    <Tag
      className={cn(
        'rounded-card',
        variant === 'surface' ? 'bg-surface' : 'border border-hairline bg-white',
        padding === 'md' && 'p-5 sm:p-6',
        padding === 'lg' && 'p-6 sm:p-8',
        className,
      )}
      {...rest}
    />
  );
}

export function CardTitle({ children, className, as: Tag = 'h2' }: { children: ReactNode; className?: string; as?: 'h2' | 'h3' }) {
  return <Tag className={cn('text-card', className)}>{children}</Tag>;
}

/** Big-number tile used on the dashboard. */
export function StatTile({
  label,
  value,
  sub,
  className,
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn('flex flex-col justify-between gap-6', className)}>
      <p className="text-small text-secondary">{label}</p>
      <div>
        <p className="text-display-sm tabular-nums">{value}</p>
        {sub && <p className="mt-1 text-small text-secondary">{sub}</p>}
      </div>
    </Card>
  );
}
