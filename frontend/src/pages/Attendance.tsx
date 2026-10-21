import { useMemo, useState } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { CalendarX2, Download } from 'lucide-react';
import { api, errorMessage } from '../lib/api';
import { qk } from '../lib/queryClient';
import { addDays, formatDate, formatDistance, formatDuration, formatTime, plural, todayInTz } from '../lib/format';
import { useSession } from '../providers/AuthProvider';
import { Page } from '../components/layout/Page';
import { AttendanceStatusDot } from '../components/StatusLabels';
import { Button, Card, EmptyState, ErrorState, Field, InlineError, Input, Select, SkeletonRows, useToast } from '../components/ui';
import { cn } from '../lib/cn';

type Preset = '7' | '30' | 'month';

export function AttendancePage() {
  const { company, isAdmin } = useSession();
  const toast = useToast();
  const tz = company.timezone;
  const today = todayInTz(tz);

  const [from, setFrom] = useState(() => addDays(today, -29));
  const [to, setTo] = useState(today);
  const [employeeId, setEmployeeId] = useState('');
  const [exporting, setExporting] = useState(false);

  const rangeValid = Boolean(from && to && from <= to);
  const query = { from, to, employeeId: employeeId || undefined };

  const attendance = useQuery({
    queryKey: qk.attendance(query),
    queryFn: () => api.attendance(query),
    enabled: rangeValid,
    placeholderData: keepPreviousData,
  });

  const employees = useQuery({ queryKey: qk.employees, queryFn: api.employees, enabled: isAdmin, staleTime: 5 * 60_000 });

  const records = useMemo(
    () =>
      [...(attendance.data?.records ?? [])].sort(
        (a, b) => b.date.localeCompare(a.date) || a.employeeName.localeCompare(b.employeeName),
      ),
    [attendance.data],
  );
  const lateCount = records.filter((r) => r.status === 'LATE').length;

  function applyPreset(p: Preset) {
    setTo(today);
    if (p === '7') setFrom(addDays(today, -6));
    else if (p === '30') setFrom(addDays(today, -29));
    else setFrom(`${today.slice(0, 8)}01`);
  }
  const activePreset: Preset | null =
    to !== today ? null : from === addDays(today, -6) ? '7' : from === addDays(today, -29) ? '30' : from === `${today.slice(0, 8)}01` ? 'month' : null;

  async function onExport() {
    setExporting(true);
    try {
      await api.exportAttendanceCsv({ from, to });
      toast.success('CSV downloaded.');
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setExporting(false);
    }
  }

  return (
    <Page
      title="Attendance"
      subtitle={isAdmin ? 'Check-ins across your team, verified by location.' : 'Your check-ins, verified by location.'}
      actions={
        isAdmin && (
          <Button
            variant="secondary"
            icon={<Download className="h-4 w-4" />}
            onClick={() => void onExport()}
            loading={exporting}
            disabled={!rangeValid}
          >
            Export CSV
          </Button>
        )
      }
    >
      <Card className="mb-8">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick ranges">
          {(
            [
              ['7', 'Last 7 days'],
              ['30', 'Last 30 days'],
              ['month', 'This month'],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => applyPreset(value)}
              aria-pressed={activePreset === value}
              className={cn(
                'h-8 rounded-pill px-3.5 text-small font-medium transition-colors duration-200',
                activePreset === value ? 'bg-ink text-white' : 'bg-white text-ink hover:bg-hairline/50',
              )}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={cn('mt-5 grid gap-4', isAdmin ? 'sm:grid-cols-3' : 'sm:grid-cols-2')}>
          <Field label="From">
            <Input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </Field>
          <Field label="To">
            <Input type="date" value={to} min={from || undefined} max={today} onChange={(e) => setTo(e.target.value)} />
          </Field>
          {isAdmin && (
            <Field label="Employee">
              <Select value={employeeId} onChange={(e) => setEmployeeId(e.target.value)} disabled={employees.isPending}>
                <option value="">Everyone</option>
                {employees.data?.employees.map((emp) => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        </div>
        {!rangeValid && <InlineError className="mt-4">“From” must be on or before “To”.</InlineError>}
      </Card>

      {attendance.isPending && rangeValid ? (
        <SkeletonRows rows={8} />
      ) : attendance.isError ? (
        <Card>
          <ErrorState error={attendance.error} onRetry={() => void attendance.refetch()} />
        </Card>
      ) : records.length === 0 ? (
        <Card>
          <EmptyState icon={<CalendarX2 />} title="No check-ins in this range.">
            Try a wider date range{isAdmin ? ' or a different employee' : ''}.
          </EmptyState>
        </Card>
      ) : (
        <>
          <p className="mb-4 text-small text-secondary" aria-live="polite">
            {plural(records.length, 'record')} · {lateCount} late
            {attendance.isFetching && <span className="ml-2 text-tertiary">Updating…</span>}
          </p>
          <div className={cn('overflow-x-auto rounded-card border border-hairline transition-opacity', attendance.isFetching && 'opacity-60')}>
            <table className="w-full min-w-[560px] border-collapse text-left">
              <thead>
                <tr className="border-b border-hairline bg-surface/60 text-caption uppercase tracking-[0.04em] text-secondary">
                  <th scope="col" className="px-5 py-3 font-medium">Date</th>
                  {isAdmin && <th scope="col" className="px-5 py-3 font-medium">Name</th>}
                  <th scope="col" className="px-5 py-3 font-medium">Check-in</th>
                  <th scope="col" className="px-5 py-3 font-medium">Check-out</th>
                  <th scope="col" className="hidden px-5 py-3 font-medium md:table-cell">Hours</th>
                  <th scope="col" className="hidden px-5 py-3 font-medium md:table-cell">Distance</th>
                  <th scope="col" className="px-5 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.id} className="border-b border-hairline/70 last:border-0 hover:bg-surface/50">
                    <td className="whitespace-nowrap px-5 py-3.5 text-small">{formatDate(r.date)}</td>
                    {isAdmin && <td className="px-5 py-3.5 text-small font-medium">{r.employeeName}</td>}
                    <td className="px-5 py-3.5 text-small tabular-nums">{formatTime(r.checkInAt, tz)}</td>
                    <td className="px-5 py-3.5 text-small tabular-nums text-secondary">{formatTime(r.checkOutAt, tz)}</td>
                    <td className="hidden px-5 py-3.5 text-small tabular-nums text-secondary md:table-cell">
                      {r.checkOutAt ? formatDuration(r.checkInAt, r.checkOutAt) : '—'}
                    </td>
                    <td className="hidden px-5 py-3.5 text-small tabular-nums text-secondary md:table-cell">
                      {formatDistance(r.distanceM)}
                    </td>
                    <td className="px-5 py-3.5">
                      <AttendanceStatusDot status={r.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Page>
  );
}
