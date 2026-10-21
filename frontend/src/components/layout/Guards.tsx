import type { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { WifiOff } from 'lucide-react';
import { useAuth } from '../../providers/AuthProvider';
import { Button, Spinner } from '../ui';

export function FullScreenLoader() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-5" role="status" aria-label="Loading">
      <p className="text-card">HR Copilot</p>
      <Spinner className="h-5 w-5 text-tertiary" />
    </div>
  );
}

/** Unauthenticated → /login (remembering where you were going). */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { state, retry, logout } = useAuth();
  const location = useLocation();

  if (state.status === 'loading') return <FullScreenLoader />;
  if (state.status === 'offline') {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center px-6 text-center animate-fade-in">
        <WifiOff className="mb-5 h-8 w-8 text-tertiary" />
        <h1 className="text-section">Can’t reach HR Copilot.</h1>
        <p className="mt-2 max-w-md text-body text-secondary">{state.error.message}</p>
        <div className="mt-8 flex gap-3">
          <Button onClick={retry}>Try again</Button>
          <Button variant="secondary" onClick={logout}>
            Sign out
          </Button>
        </div>
      </div>
    );
  }
  if (state.status === 'anonymous') {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search, expired: state.reason === 'expired' }}
      />
    );
  }
  return <>{children}</>;
}

/** ADMIN-only pages: employees get bounced home (the nav never shows them the link). */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const { state } = useAuth();
  if (state.status !== 'authenticated') return null;
  if (state.user.role !== 'ADMIN') return <Navigate to="/" replace />;
  return <>{children}</>;
}
