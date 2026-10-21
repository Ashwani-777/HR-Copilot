import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Inbox, X } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../lib/api';
import { qk } from '../lib/queryClient';
import { formatDateRange, formatDateTime, LEAVE_LABEL, plural, todayInTz } from '../lib/format';
import { useSession } from '../providers/AuthProvider';
import { Page, Section } from '../components/layout/Page';
import { LeaveStatusDot } from '../components/StatusLabels';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  Input,
  SegmentedControl,
  Select,
  Skeleton,
  SkeletonRows,
  Textarea,
  useToast,
} from '../components/ui';
import type { LeaveRequest, LeaveStatus, LeaveType } from '../types';
import { cn } from '../lib/cn';

type Filter = 'ALL' | LeaveStatus;
const FILTERS: Filter[] = ['ALL', 'PENDING', 'APPROVED', 'REJECTED'];
const FILTER_LABEL: Record<Filter, string> = { ALL: 'All', PENDING: 'Pending', APPROVED: 'Approved', REJECTED: 'Rejected' };

export function LeavePage() {
  const { user, isAdmin } = useSession();
  const [params, setParams] = useSearchParams();
  const rawFilter = params.get('status') as Filter | null;
  const filter: Filter = rawFilter && FILTERS.includes(rawFilter) ? rawFilter : 'ALL';
  const status = filter === 'ALL' ? undefined : filter;

  const leaves = useQuery({
    queryKey: qk.leaves(status),
    queryFn: () => api.leaves({ status }),
    placeholderData: keepPreviousData,
  });

  const setFilter = (f: Filter) => {
    const next = new URLSearchParams(params);
    if (f === 'ALL') next.delete('status');
    else next.set('status', f);
    setParams(next, { replace: true });
  };

  return (
    <Page
      title="Leave"
      subtitle={isAdmin ? 'Requests from your team, and your own.' : 'Plan time off and track your requests.'}
    >
      {user.employeeId && <RequestLeave />}

      <Section
        title={isAdmin ? 'Requests' : 'Your requests'}
        flush={!user.employeeId}
        aside={
          <SegmentedControl<Filter>
            label="Filter by status"
            value={filter}
            onChange={setFilter}
            options={FILTERS.map((f) => ({ value: f, label: FILTER_LABEL[f] }))}
          />
        }
      >
        {leaves.isPending ? (
          <SkeletonRows rows={4} />
        ) : leaves.isError ? (
          <Card>
            <ErrorState error={leaves.error} onRetry={() => void leaves.refetch()} />
          </Card>
        ) : leaves.data.leaves.length === 0 ? (
          <Card>
            <EmptyState icon={<Inbox />} title={filter === 'ALL' ? 'No leave requests yet.' : `No ${FILTER_LABEL[filter].toLowerCase()} requests.`}>
              {filter === 'PENDING' && isAdmin ? 'You’re all caught up.' : user.employeeId ? 'Requests you make will appear here.' : undefined}
            </EmptyState>
          </Card>
        ) : (
          <Card
            as="ul"
            padding="none"
            variant="outline"
            className={cn('divide-y divide-hairline/70 overflow-hidden transition-opacity', leaves.isFetching && 'opacity-60')}
          >
            {leaves.data.leaves.map((l) => (
              <LeaveRow key={l.id} leave={l} />
            ))}
          </Card>
        )}
      </Section>
    </Page>
  );
}

function LeaveRow({ leave }: { leave: LeaveRequest }) {
  const { isAdmin, company } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();

  const decide = useMutation({
    mutationFn: (status: 'APPROVED' | 'REJECTED') => api.decideLeave(leave.id, { status }),
    onSuccess: (updated) => {
      toast.success(`${updated.status === 'APPROVED' ? 'Approved' : 'Rejected'} ${updated.employeeName}’s ${LEAVE_LABEL[updated.type].toLowerCase()} leave.`);
      void queryClient.invalidateQueries({ queryKey: qk.leavesAll });
      void queryClient.invalidateQueries({ queryKey: qk.balance });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <li className="flex flex-col gap-4 px-5 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          {isAdmin && <span className="text-body font-semibold">{leave.employeeName}</span>}
          <Badge>{LEAVE_LABEL[leave.type]}</Badge>
          <span className="text-body">
            {formatDateRange(leave.from, leave.to)}
            <span className="text-secondary"> · {plural(leave.days, 'day')}</span>
          </span>
        </div>
        {leave.reason && <p className="mt-1 line-clamp-2 text-small text-secondary">{leave.reason}</p>}
        <p className="mt-1 text-caption text-tertiary">
          Requested {formatDateTime(leave.createdAt, company.timezone)}
          {leave.decidedAt && ` · decided ${formatDateTime(leave.decidedAt, company.timezone)}`}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {isAdmin && leave.status === 'PENDING' ? (
          <>
            <Button
              size="sm"
              variant="secondary"
              icon={<X className="h-3.5 w-3.5" />}
              onClick={() => decide.mutate('REJECTED')}
              loading={decide.isPending && decide.variables === 'REJECTED'}
              disabled={decide.isPending}
            >
              Reject
            </Button>
            <Button
              size="sm"
              icon={<Check className="h-3.5 w-3.5" />}
              onClick={() => decide.mutate('APPROVED')}
              loading={decide.isPending && decide.variables === 'APPROVED'}
              disabled={decide.isPending}
            >
              Approve
            </Button>
          </>
        ) : (
          <LeaveStatusDot status={leave.status} />
        )}
      </div>
    </li>
  );
}

// ---- Request form --------------------------------------------------------------------

function RequestLeave() {
  const { company } = useSession();
  const queryClient = useQueryClient();
  const toast = useToast();
  const today = todayInTz(company.timezone);

  const [type, setType] = useState<LeaveType>('CASUAL');
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState(today);
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  const balance = useQuery({ queryKey: qk.balance, queryFn: api.leaveBalance });
  const selected = balance.data?.balances.find((b) => b.type === type);

  const localErrors = useMemo(() => {
    const e: Record<string, string> = {};
    if (!from) e.from = 'Pick a start date.';
    if (!to) e.to = 'Pick an end date.';
    if (from && to && to < from) e.to = 'End date can’t be before the start date.';
    if (!reason.trim()) e.reason = 'Add a short reason.';
    else if (reason.length > 500) e.reason = 'Keep it under 500 characters.';
    return e;
  }, [from, to, reason]);

  const create = useMutation({
    mutationFn: () => api.createLeave({ type, from, to, reason: reason.trim() }),
    onSuccess: (leave) => {
      toast.success(`Requested ${plural(leave.days, 'day')} of ${LEAVE_LABEL[leave.type].toLowerCase()} leave.`);
      setReason('');
      setTouched(false);
      void queryClient.invalidateQueries({ queryKey: qk.leavesAll });
      void queryClient.invalidateQueries({ queryKey: qk.balance });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
    },
  });

  const serverErrors = fieldErrors(create.error);
  const errors = touched ? { ...serverErrors, ...localErrors } : serverErrors;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(localErrors).length > 0) return;
    create.mutate();
  }

  return (
    <section aria-label="Request leave" className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card padding="lg" as="section">
        <h2 className="text-card">Request leave</h2>
        <form onSubmit={onSubmit} noValidate className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field
            label="Type"
            className="sm:col-span-2"
            hint={selected ? `${plural(selected.remaining, 'day')} of ${LEAVE_LABEL[type].toLowerCase()} leave left` : undefined}
          >
            <Select value={type} onChange={(e) => setType(e.target.value as LeaveType)}>
              {(Object.keys(LEAVE_LABEL) as LeaveType[]).map((t) => (
                <option key={t} value={t}>
                  {LEAVE_LABEL[t]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="From" error={errors.from}>
            <Input
              type="date"
              value={from}
              onChange={(e) => {
                setFrom(e.target.value);
                if (to && e.target.value > to) setTo(e.target.value);
              }}
            />
          </Field>
          <Field label="To" error={errors.to}>
            <Input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </Field>
          <Field label="Reason" className="sm:col-span-2" error={errors.reason}>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Family function in Jaipur"
              maxLength={500}
              rows={3}
            />
          </Field>
          <div className="flex flex-col gap-3 sm:col-span-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-h-[20px]">
              {create.isError && Object.keys(serverErrors).length === 0 && <InlineError>{errorMessage(create.error)}</InlineError>}
            </div>
            <Button type="submit" loading={create.isPending}>
              Submit request
            </Button>
          </div>
        </form>
      </Card>

      <Card padding="lg" as="section" aria-label="Balances">
        <h2 className="text-card">Balance</h2>
        {balance.isPending ? (
          <div className="mt-6 flex flex-col gap-4">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-10 w-full bg-white" />
            ))}
          </div>
        ) : balance.isError ? (
          <InlineError className="mt-6">{errorMessage(balance.error)}</InlineError>
        ) : (
          <dl className="mt-6 flex flex-col divide-y divide-hairline/70">
            {balance.data.balances.map((b) => (
              <div key={b.type} className="flex items-baseline justify-between py-3 first:pt-0">
                <dt className="text-body">{LEAVE_LABEL[b.type]}</dt>
                <dd className="text-body tabular-nums">
                  <span className="font-semibold">{b.remaining}</span>
                  <span className="text-secondary"> / {b.allowed}</span>
                </dd>
              </div>
            ))}
          </dl>
        )}
      </Card>
    </section>
  );
}
