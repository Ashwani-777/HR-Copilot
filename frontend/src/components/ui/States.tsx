import type { ReactNode } from 'react';
import { AlertCircle } from 'lucide-react';
import { cn } from '../../lib/cn';
import { errorMessage } from '../../lib/api';
import { Button } from './Button';

export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center px-6 py-14 text-center animate-fade-in', className)}>
      {icon && <div className="mb-4 text-tertiary [&_svg]:h-8 [&_svg]:w-8">{icon}</div>}
      <p className="text-card">{title}</p>
      {children && <p className="mt-2 max-w-sm text-body text-secondary">{children}</p>}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}

/** Shows the contract error `message` and an optional retry. */
export function ErrorState({ error, onRetry, className }: { error: unknown; onRetry?: () => void; className?: string }) {
  return (
    <div role="alert" className={cn('flex flex-col items-center px-6 py-12 text-center animate-fade-in', className)}>
      <AlertCircle className="mb-3 h-7 w-7 text-red" />
      <p className="text-body font-medium">Couldn’t load this.</p>
      <p className="mt-1 max-w-md text-small text-secondary">{errorMessage(error)}</p>
      {onRetry && (
        <Button variant="secondary" size="sm" className="mt-5" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

/** Inline error line inside forms/cards. */
export function InlineError({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <p role="alert" className={cn('flex items-start gap-2 text-small text-red', className)}>
      <AlertCircle className="mt-[2px] h-4 w-4 shrink-0" />
      <span>{children}</span>
    </p>
  );
}
