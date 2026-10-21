import { useState, type FormEvent } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Eye, EyeOff, ShieldCheck, User as UserIcon } from 'lucide-react';
import { useAuth } from '../providers/AuthProvider';
import { errorMessage } from '../lib/api';
import { Button, Field, InlineError, Input } from '../components/ui';
import { FullScreenLoader } from '../components/layout/Guards';

/** Seed accounts from docs/API_CONTRACT.md ("test values only"). */
const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'admin@acme.test', password: 'Admin@123', icon: ShieldCheck },
  { label: 'Employee', email: 'riya@acme.test', password: 'Employee@123', icon: UserIcon },
] as const;

type LocationState = { from?: string; expired?: boolean } | null;

export function LoginPage() {
  const { state, login } = useAuth();
  const location = useLocation();
  const locState = location.state as LocationState;
  const from = locState?.from && locState.from !== '/login' ? locState.from : '/';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (state.status === 'loading') return <FullScreenLoader />;
  if (state.status === 'authenticated') return <Navigate to={from} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Enter your email and password.');
      return;
    }
    setSubmitting(true);
    try {
      await login(email.trim(), password); // state flips to authenticated → <Navigate to={from}>
    } catch (err) {
      setError(errorMessage(err));
      setSubmitting(false);
    }
  }

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-[400px] animate-fade-up">
        <div className="text-center">
          <h1 className="text-display-sm sm:text-display">HR Copilot.</h1>
          <p className="mt-3 text-[21px] leading-[1.38] tracking-[-0.012em] text-secondary">Your HR, answered.</p>
        </div>

        {locState?.expired && (
          <p className="mt-8 rounded-input bg-surface px-4 py-3 text-center text-small text-secondary" role="status">
            Your session ended. Please sign in again.
          </p>
        )}

        <form onSubmit={onSubmit} className="mt-10 flex flex-col gap-4" noValidate>
          <Field label="Email">
            <Input
              type="email"
              autoComplete="username"
              inputMode="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
            />
          </Field>
          <Field label="Password">
            <PasswordInput value={password} onChange={setPassword} show={showPassword} onToggle={() => setShowPassword((s) => !s)} />
          </Field>

          {error && <InlineError>{error}</InlineError>}

          <Button type="submit" size="lg" loading={submitting} className="mt-2 w-full">
            Sign in
          </Button>
        </form>

        <div className="mt-10">
          <p className="text-center text-caption text-tertiary">Try the demo</p>
          <div className="mt-3 flex justify-center gap-2">
            {DEMO_ACCOUNTS.map(({ label, email: demoEmail, password: demoPassword, icon: Icon }) => (
              <button
                key={label}
                type="button"
                onClick={() => {
                  setEmail(demoEmail);
                  setPassword(demoPassword);
                  setError(null);
                }}
                className="inline-flex h-9 items-center gap-2 rounded-pill bg-surface px-4 text-small font-medium text-ink transition-colors duration-200 hover:bg-hairline/60"
                aria-label={`Fill in the ${label} demo account (${demoEmail})`}
              >
                <Icon className="h-4 w-4 text-secondary" />
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}

function PasswordInput({
  value,
  onChange,
  show,
  onToggle,
  ...rest
}: {
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  id?: string;
  'aria-describedby'?: string;
  invalid?: boolean;
}) {
  return (
    <div className="relative">
      <Input
        {...rest}
        type={show ? 'text' : 'password'}
        autoComplete="current-password"
        placeholder="Password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="pr-12"
      />
      <button
        type="button"
        onClick={onToggle}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-1.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full text-secondary hover:bg-surface hover:text-ink"
      >
        {show ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
      </button>
    </div>
  );
}
