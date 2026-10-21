import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react';
import { Link, type LinkProps } from 'react-router-dom';
import { cn } from '../../lib/cn';
import { Spinner } from './Spinner';

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'outline' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'xl';

const base =
  'inline-flex select-none items-center justify-center gap-2 whitespace-nowrap rounded-pill font-medium ' +
  'transition-[background-color,color,box-shadow,transform,opacity] duration-200 ease-out ' +
  'active:scale-[0.98] disabled:pointer-events-none disabled:opacity-40';

const variants: Record<ButtonVariant, string> = {
  primary: 'bg-ink text-white hover:bg-black',
  secondary: 'bg-surface text-ink hover:bg-hairline/60',
  outline: 'bg-white text-ink border border-hairline hover:border-tertiary',
  ghost: 'bg-transparent text-ink hover:bg-surface',
  danger: 'bg-surface text-red hover:bg-red/10',
};

const sizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-3.5 text-small',
  md: 'h-11 px-5 text-body',
  lg: 'h-12 px-6 text-body',
  xl: 'h-14 px-9 text-[19px] tracking-[-0.01em]',
};

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, icon, className, children, disabled, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={buttonClasses(variant, size, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner className="h-4 w-4" /> : icon}
      {children}
    </button>
  );
});

type ButtonLinkProps = LinkProps & { variant?: ButtonVariant; size?: ButtonSize; icon?: ReactNode };

export function ButtonLink({ variant = 'primary', size = 'md', icon, className, children, ...rest }: ButtonLinkProps) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...rest}>
      {icon}
      {children}
    </Link>
  );
}

/** Round icon-only button; `label` is required for screen readers. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  ButtonHTMLAttributes<HTMLButtonElement> & { label: string; variant?: ButtonVariant; size?: 'sm' | 'md' }
>(function IconButton({ label, variant = 'ghost', size = 'md', className, children, type = 'button', ...rest }, ref) {
  return (
    <button
      ref={ref}
      type={type}
      aria-label={label}
      title={label}
      className={cn(
        base,
        variants[variant],
        size === 'sm' ? 'h-8 w-8' : 'h-10 w-10',
        'px-0 [&_svg]:h-[18px] [&_svg]:w-[18px]',
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
});
