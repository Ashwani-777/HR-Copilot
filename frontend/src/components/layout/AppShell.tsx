import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ChevronDown, LogOut, Menu, X } from 'lucide-react';
import { useSession } from '../../providers/AuthProvider';
import { SocketProvider } from '../../providers/SocketProvider';
import { ChatProvider } from '../../providers/ChatProvider';
import { cn } from '../../lib/cn';
import { initials } from '../../lib/format';
import { IconButton } from '../ui';

type NavItem = { to: string; label: string; adminOnly?: boolean };

export const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Home' },
  { to: '/attendance', label: 'Attendance' },
  { to: '/leave', label: 'Leave' },
  { to: '/documents', label: 'Documents' },
  { to: '/copilot', label: 'Copilot' },
  { to: '/employees', label: 'Employees', adminOnly: true },
];

export function AppShell() {
  const { token } = useSession();
  return (
    <SocketProvider token={token}>
      <ChatProvider>
        <a
          href="#main"
          className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-2 focus:z-[70] focus:rounded-pill focus:bg-ink focus:px-4 focus:py-2 focus:text-small focus:text-white"
        >
          Skip to content
        </a>
        <TopNav />
        <main id="main" className="min-h-[calc(100dvh-var(--nav-height))]">
          <Outlet />
        </main>
      </ChatProvider>
    </SocketProvider>
  );
}

function TopNav() {
  const { user, isAdmin } = useSession();
  const [mobileOpen, setMobileOpen] = useState(false);
  const location = useLocation();
  const items = NAV_ITEMS.filter((i) => !i.adminOnly || isAdmin);

  useEffect(() => setMobileOpen(false), [location.pathname]);

  // Full-screen menu on phones: lock page scroll and close on Escape while it's open.
  useEffect(() => {
    if (!mobileOpen) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = 'hidden';
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setMobileOpen(false);
    document.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen]);

  return (
    <header className="nav-blur sticky top-0 z-40 border-b border-hairline/70">
      <nav aria-label="Main" className="container-page flex h-nav items-center justify-between gap-4">
        <NavLink to="/" className="shrink-0 text-[19px] font-semibold tracking-[-0.02em]" aria-label="HR Copilot home">
          HR Copilot
        </NavLink>

        <ul className="hidden items-center gap-1 md:flex">
          {items.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'rounded-pill px-3 py-1.5 text-small transition-colors duration-200',
                    isActive ? 'text-ink font-medium' : 'text-secondary hover:text-ink',
                  )
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-1">
          <UserMenu />
          <IconButton
            label={mobileOpen ? 'Close menu' : 'Open menu'}
            className="md:hidden"
            aria-expanded={mobileOpen}
            aria-controls="mobile-menu"
            onClick={() => setMobileOpen((o) => !o)}
          >
            {mobileOpen ? <X /> : <Menu />}
          </IconButton>
        </div>
      </nav>

      {mobileOpen && (
        <div
          id="mobile-menu"
          className="absolute inset-x-0 top-full h-[calc(100dvh-var(--nav-height))] animate-fade-in overflow-y-auto border-t border-hairline/70 bg-white md:hidden"
        >
          <ul className="container-page flex flex-col py-4">
            {items.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  end={item.to === '/'}
                  className={({ isActive }) =>
                    cn('block py-2.5 text-section', isActive ? 'text-ink' : 'text-secondary hover:text-ink')
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
          </ul>
          <p className="container-page pb-5 text-small text-secondary">Signed in as {user.email}</p>
        </div>
      )}
    </header>
  );
}

function UserMenu() {
  const { user, company, isAdmin, logout } = useSession();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-9 items-center gap-1.5 rounded-pill pl-1 pr-2 transition-colors duration-200 hover:bg-surface"
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-ink text-[11px] font-semibold text-white">
          {initials(user.name)}
        </span>
        <span className="sr-only">Account menu for {user.name}</span>
        <ChevronDown className={cn('h-3.5 w-3.5 text-secondary transition-transform duration-200', open && 'rotate-180')} />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 w-72 animate-fade-up rounded-card border border-hairline/70 bg-white p-2 shadow-soft"
        >
          <div className="px-3 pb-3 pt-2">
            <p className="text-body font-semibold">{user.name}</p>
            <p className="truncate text-small text-secondary">{user.email}</p>
            <p className="mt-2 text-caption text-tertiary">
              {company.name} · {isAdmin ? 'Admin' : 'Employee'}
            </p>
          </div>
          <div className="h-px bg-hairline/70" />
          <button
            type="button"
            role="menuitem"
            onClick={logout}
            className="mt-1 flex w-full items-center gap-2 rounded-input px-3 py-2.5 text-left text-small hover:bg-surface"
          >
            <LogOut className="h-4 w-4" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
