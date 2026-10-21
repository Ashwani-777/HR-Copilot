import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, ArrowUpRight, MapPin, Sparkles } from 'lucide-react';
import { api, ApiError, errorMessage } from '../lib/api';
import { getCurrentCoords, LocationError, type Coords } from '../lib/geo';
import { qk } from '../lib/queryClient';
import {
  firstName,
  formatDistance,
  formatDuration,
  formatLongToday,
  formatTime,
  greeting,
  LEAVE_LABEL,
  plural,
} from '../lib/format';
import { useSession } from '../providers/AuthProvider';
import { Button, Card, ErrorState, InlineError, ProgressBar, Skeleton, StatTile, StatusDot, useToast } from '../components/ui';
import { Section } from '../components/layout/Page';
import { AttendanceStatusDot } from '../components/StatusLabels';
import type { AttendanceRecord, DashboardResponse, GeofenceErrorDetails, LeaveBalance } from '../types';

export function DashboardPage() {
  const { user, company, isAdmin } = useSession();
  const dashboard = useQuery({ queryKey: qk.dashboard, queryFn: api.dashboard });
  const tz = company.timezone;

  return (
    <div className="container-page pb-24 pt-12 sm:pt-16 animate-fade-up">
      <header className="mb-10 sm:mb-14">
        <h1 className="page-title">
          {greeting(tz)}, {firstName(user.name)}.
        </h1>
        <p className="mt-3 text-[19px] leading-[1.42] tracking-[-0.012em] text-secondary">
          {formatLongToday(tz)} · {company.name}
        </p>
      </header>

      {dashboard.isPending ? (
        <DashboardSkeleton admin={isAdmin} />
      ) : dashboard.isError ? (
        <Card>
          <ErrorState error={dashboard.error} onRetry={() => void dashboard.refetch()} />
        </Card>
      ) : (
        <DashboardContent data={dashboard.data} />
      )}
    </div>
  );
}

function DashboardContent({ data }: { data: DashboardResponse }) {
  const { user, isAdmin } = useSession();
  return (
    <>
      {user.employeeId ? (
        <TodayCard record={data.today.record} />
      ) : (
        <Card padding="lg">
          <p className="text-small text-secondary">Today</p>
          <p className="mt-2 text-card">Attendance isn’t set up for your account.</p>
          <p className="mt-1 text-body text-secondary">
            Your login isn’t linked to an employee profile, so there’s nothing to check in to.
          </p>
        </Card>
      )}

      {isAdmin && data.stats && (
        <Section title="Your team today" aside={<SeeAll to="/attendance" label="Attendance" />}>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
            <StatTile label="Present" value={data.stats.presentToday} sub={`of ${data.stats.totalEmployees}`} />
            <StatTile
              label="Late"
              value={data.stats.lateToday}
              sub={data.stats.lateToday > 0 ? <StatusDot tone="orange">After shift start</StatusDot> : 'Nobody yet'}
            />
            <StatTile label="On leave" value={data.stats.onLeaveToday} sub="Approved for today" />
            <StatTile label="Employees" value={data.stats.totalEmployees} sub="Active" />
            <Link
              to="/leave?status=PENDING"
              className="group col-span-2 rounded-card sm:col-span-1"
              aria-label={`${data.stats.pendingLeaves} pending leave requests — review`}
            >
              <StatTile
                className="h-full transition-colors duration-200 group-hover:bg-hairline/50"
                label="Pending leaves"
                value={data.stats.pendingLeaves}
                sub={
                  <span className="inline-flex items-center gap-1 text-ink">
                    Review <ArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-0.5" />
                  </span>
                }
              />
            </Link>
          </div>
        </Section>
      )}

      {data.leaveBalances.length > 0 && (
        <Section title="Leave balance" aside={<SeeAll to="/leave" label="Request leave" />}>
          <div className="grid gap-3 sm:grid-cols-3 sm:gap-4">
            {data.leaveBalances.map((b) => (
              <BalanceTile key={b.type} balance={b} />
            ))}
          </div>
        </Section>
      )}

      <CopilotTeaser />
    </>
  );
}

function SeeAll({ to, label }: { to: string; label: string }) {
  return (
    <Link to={to} className="group inline-flex items-center gap-1 text-small text-secondary hover:text-ink">
      {label}
      <ArrowUpRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
    </Link>
  );
}

// ---- Today / check-in ------------------------------------------------------------

type CheckInProblem =
  | { kind: 'geofence'; distanceM: number; radiusM: number }
  | { kind: 'message'; message: string };

function TodayCard({ record }: { record: AttendanceRecord | null }) {
  const { company } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [locating, setLocating] = useState(false);
  const [problem, setProblem] = useState<CheckInProblem | null>(null);
  const tz = company.timezone;

  const applyRecord = (rec: AttendanceRecord) => {
    queryClient.setQueryData<DashboardResponse>(qk.dashboard, (d) => (d ? { ...d, today: { ...d.today, record: rec } } : d));
    void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    void queryClient.invalidateQueries({ queryKey: qk.attendanceAll });
  };

  const handleError = (e: unknown) => {
    if (e instanceof ApiError && e.code === 'OUTSIDE_GEOFENCE') {
      const d = (e.details ?? {}) as Partial<GeofenceErrorDetails>;
      setProblem({
        kind: 'geofence',
        distanceM: typeof d.distanceM === 'number' ? d.distanceM : NaN,
        radiusM: typeof d.radiusM === 'number' ? d.radiusM : company.geofenceRadiusM,
      });
      return;
    }
    if (e instanceof ApiError && (e.code === 'ALREADY_CHECKED_IN' || e.code === 'NOT_CHECKED_IN')) {
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    }
    setProblem({ kind: 'message', message: errorMessage(e) });
  };

  const checkIn = useMutation({
    mutationFn: (coords: Coords) => api.checkIn(coords),
    onSuccess: (rec) => {
      setProblem(null);
      applyRecord(rec);
      toast.success(
        rec.status === 'LATE'
          ? `Checked in at ${formatTime(rec.checkInAt, tz)} — marked late.`
          : `Checked in at ${formatTime(rec.checkInAt, tz)}. Have a good day.`,
      );
    },
    onError: handleError,
  });

  const checkOut = useMutation({
    mutationFn: () => api.checkOut(),
    onSuccess: (rec) => {
      setProblem(null);
      applyRecord(rec);
      toast.success(`Checked out at ${formatTime(rec.checkOutAt, tz)}.`);
    },
    onError: handleError,
  });

  async function onCheckIn() {
    setProblem(null);
    setLocating(true);
    try {
      const coords = await getCurrentCoords();
      setLocating(false);
      checkIn.mutate(coords);
    } catch (e) {
      setLocating(false);
      setProblem({ kind: 'message', message: e instanceof LocationError ? e.message : errorMessage(e) });
    }
  }

  function onUseOffice() {
    setProblem(null);
    checkIn.mutate({ lat: company.officeLat, lng: company.officeLng });
  }

  const busy = locating || checkIn.isPending || checkOut.isPending;
  const state: 'out' | 'in' | 'done' = !record ? 'out' : record.checkOutAt ? 'done' : 'in';

  return (
    <Card padding="lg" className="animate-fade-in">
      <div className="flex flex-col gap-8 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-small text-secondary">Today</p>
          {state === 'out' && (
            <>
              <p className="mt-2 text-section">You haven’t checked in yet.</p>
              <p className="mt-2 text-body text-secondary">
                Shift starts at {company.shiftStart}. Check-in works within {formatDistance(company.geofenceRadiusM)} of the
                office.
              </p>
            </>
          )}
          {state === 'in' && record && (
            <>
              <p className="mt-2 text-section">Checked in at {formatTime(record.checkInAt, tz)}.</p>
              <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <AttendanceStatusDot status={record.status} />
                <span className="text-small text-secondary">{formatDistance(record.distanceM)} from the office</span>
              </div>
            </>
          )}
          {state === 'done' && record?.checkOutAt && (
            <>
              <p className="mt-2 text-section">That’s a wrap for today.</p>
              <p className="mt-2 text-body text-secondary">
                {formatTime(record.checkInAt, tz)} – {formatTime(record.checkOutAt, tz)} · worked{' '}
                {formatDuration(record.checkInAt, record.checkOutAt)}
              </p>
              <div className="mt-3">
                <AttendanceStatusDot status={record.status} />
              </div>
            </>
          )}
        </div>

        <div className="flex shrink-0 flex-col items-stretch gap-3 sm:items-end">
          {state === 'out' && (
            <Button size="xl" onClick={() => void onCheckIn()} loading={locating || checkIn.isPending} disabled={busy}>
              {locating ? 'Finding you…' : 'Check in'}
            </Button>
          )}
          {state === 'in' && (
            <Button size="xl" onClick={() => checkOut.mutate()} loading={checkOut.isPending} disabled={busy}>
              Check out
            </Button>
          )}
          {state === 'done' && (
            <Button size="xl" variant="secondary" disabled>
              Done for today
            </Button>
          )}
          {state === 'out' && (
            <button
              type="button"
              onClick={onUseOffice}
              disabled={busy}
              className="self-center text-small text-secondary underline-offset-4 hover:text-ink hover:underline disabled:opacity-40 sm:self-end"
            >
              Use office location (demo)
            </button>
          )}
        </div>
      </div>

      {problem && (
        <div className="mt-8 border-t border-hairline pt-6 animate-fade-up" role="alert">
          {problem.kind === 'geofence' ? (
            <div className="flex items-start gap-3">
              <MapPin className="mt-0.5 h-5 w-5 shrink-0 text-orange" />
              <div>
                <p className="text-body font-semibold">
                  {Number.isFinite(problem.distanceM)
                    ? `You’re ${formatDistance(problem.distanceM)} from the office.`
                    : 'You’re outside the office area.'}
                </p>
                <p className="mt-1 text-small text-secondary">
                  Check-in works within {formatDistance(problem.radiusM)} of {company.name}. Move closer and try again — or,
                  for this demo,{' '}
                  <button type="button" onClick={onUseOffice} className="font-medium text-ink underline underline-offset-4">
                    use the office location
                  </button>
                  .
                </p>
              </div>
            </div>
          ) : (
            <InlineError>{problem.message}</InlineError>
          )}
        </div>
      )}
    </Card>
  );
}

// ---- Leave balances -----------------------------------------------------------------

function BalanceTile({ balance }: { balance: LeaveBalance }) {
  const usedPct = balance.allowed > 0 ? (balance.used / balance.allowed) * 100 : 0;
  return (
    <Card className="flex flex-col gap-5">
      <p className="text-small text-secondary">{LEAVE_LABEL[balance.type]} leave</p>
      <div>
        <p className="text-display-sm tabular-nums">
          {balance.remaining}
          <span className="ml-2 text-body font-normal text-secondary">{balance.remaining === 1 ? 'day left' : 'days left'}</span>
        </p>
        <p className="mt-1 text-small text-secondary">
          {plural(balance.used, 'day')} used of {balance.allowed}
        </p>
      </div>
      <ProgressBar value={usedPct} label={`${LEAVE_LABEL[balance.type]} leave used`} />
    </Card>
  );
}

// ---- Copilot teaser ---------------------------------------------------------------------

function CopilotTeaser() {
  const { isAdmin } = useSession();
  const navigate = useNavigate();
  const questions = isAdmin
    ? ['Who was late this week?', 'Who is on leave today?']
    : ['How many casual leaves do I get?', 'What’s the work-from-home policy?'];
  return (
    <Section title="Ask Copilot">
      <Card padding="lg" className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-white">
            <Sparkles className="h-5 w-5" />
          </span>
          <div>
            <p className="text-card">Questions about policy or your team?</p>
            <p className="mt-1 text-body text-secondary">Answers come from your documents and live HR data, with sources.</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {questions.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => navigate(`/copilot?q=${encodeURIComponent(q)}`)}
              className="h-9 rounded-pill bg-white px-4 text-small font-medium text-ink transition-shadow duration-200 hover:shadow-soft"
            >
              {q}
            </button>
          ))}
        </div>
      </Card>
    </Section>
  );
}

function DashboardSkeleton({ admin }: { admin: boolean }) {
  return (
    <div role="status" aria-label="Loading dashboard">
      <Skeleton className="h-[184px] w-full rounded-card" />
      {admin && (
        <div className="mt-14 grid grid-cols-2 gap-3 sm:mt-20 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
          {Array.from({ length: 5 }, (_, i) => (
            <Skeleton key={i} className="h-[150px] rounded-card" />
          ))}
        </div>
      )}
      <div className="mt-14 grid gap-3 sm:mt-20 sm:grid-cols-3 sm:gap-4">
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} className="h-[170px] rounded-card" />
        ))}
      </div>
    </div>
  );
}
