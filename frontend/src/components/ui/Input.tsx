import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from '../../lib/cn';

const control =
  'w-full rounded-input border bg-white px-3.5 text-body text-ink placeholder:text-tertiary ' +
  'transition-[border-color,box-shadow] duration-200 ease-out ' +
  'focus:outline-none focus-visible:outline-none focus:border-transparent focus:ring-2 focus:ring-ink ' +
  'disabled:cursor-not-allowed disabled:bg-surface disabled:text-tertiary';

const stateBorder = (invalid?: boolean) => (invalid ? 'border-red' : 'border-hairline hover:border-tertiary');

type ControlProps = { invalid?: boolean };

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & ControlProps>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        aria-invalid={invalid || undefined}
        className={cn(control, 'h-11', stateBorder(invalid), className)}
        {...rest}
      />
    );
  },
);

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & ControlProps>(
  function Textarea({ className, invalid, rows = 3, ...rest }, ref) {
    return (
      <textarea
        ref={ref}
        rows={rows}
        aria-invalid={invalid || undefined}
        className={cn(control, 'resize-y py-2.5 leading-[1.47]', stateBorder(invalid), className)}
        {...rest}
      />
    );
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & ControlProps>(
  function Select({ className, invalid, children, ...rest }, ref) {
    return (
      <div className="relative">
        <select
          ref={ref}
          aria-invalid={invalid || undefined}
          className={cn(control, 'h-11 appearance-none pr-10', stateBorder(invalid), className)}
          {...rest}
        >
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-secondary" />
      </div>
    );
  },
);

type FieldProps = {
  label: string;
  hint?: ReactNode;
  error?: string;
  className?: string;
  /** A single Input / Select / Textarea; `id`, `aria-describedby` and `invalid` are wired automatically. */
  children: ReactElement<Record<string, unknown>>;
};

/** Label + control + hint/error, accessible by construction. */
export function Field({ label, hint, error, className, children }: FieldProps) {
  const autoId = useId();
  const id = (children.props.id as string | undefined) ?? autoId;
  const hintId = `${id}-hint`;
  const describedBy = error || hint ? hintId : undefined;
  const control = isValidElement(children)
    ? cloneElement(children, { id, 'aria-describedby': describedBy, invalid: Boolean(error) || undefined })
    : children;
  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-small font-medium text-ink">
        {label}
      </label>
      {control}
      {(error || hint) && (
        <p id={hintId} className={cn('text-caption', error ? 'text-red' : 'text-secondary')} role={error ? 'alert' : undefined}>
          {error ?? hint}
        </p>
      )}
    </div>
  );
}
