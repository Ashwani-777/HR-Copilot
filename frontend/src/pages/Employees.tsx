import { useMemo, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Users } from 'lucide-react';
import { api, errorMessage, fieldErrors } from '../lib/api';
import { qk } from '../lib/queryClient';
import { formatDate, initials, plural } from '../lib/format';
import { Page } from '../components/layout/Page';
import {
  Button,
  Card,
  EmptyState,
  ErrorState,
  Field,
  InlineError,
  Input,
  Sheet,
  SkeletonRows,
  useToast,
} from '../components/ui';
import type { CreateEmployeeRequest, EmployeesResponse } from '../types';

export function EmployeesPage() {
  const employees = useQuery({ queryKey: qk.employees, queryFn: api.employees });
  const [search, setSearch] = useState('');
  const [adding, setAdding] = useState(false);

  const filtered = useMemo(() => {
    const list = [...(employees.data?.employees ?? [])].sort((a, b) => a.name.localeCompare(b.name));
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter((e) =>
      [e.name, e.email, e.department, e.designation].some((v) => v.toLowerCase().includes(q)),
    );
  }, [employees.data, search]);

  const total = employees.data?.employees.length ?? 0;
  const departments = new Set(employees.data?.employees.map((e) => e.department)).size;

  return (
    <Page
      title="Employees"
      subtitle={employees.data ? `${plural(total, 'person', 'people')} across ${plural(departments, 'department')}.` : 'Your team.'}
      actions={
        <Button icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>
          Add employee
        </Button>
      }
    >
      <div className="relative mb-6 max-w-sm">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-tertiary" />
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, team…"
          aria-label="Search employees"
          className="pl-10"
        />
      </div>

      {employees.isPending ? (
        <SkeletonRows rows={6} />
      ) : employees.isError ? (
        <Card>
          <ErrorState error={employees.error} onRetry={() => void employees.refetch()} />
        </Card>
      ) : filtered.length === 0 ? (
        <Card>
          <EmptyState icon={<Users />} title={search ? 'No one matches that search.' : 'No employees yet.'}>
            {search ? 'Try a different name, email or department.' : 'Add your first employee to get started.'}
          </EmptyState>
        </Card>
      ) : (
        <div className="overflow-x-auto rounded-card border border-hairline">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead>
              <tr className="border-b border-hairline bg-surface/60 text-caption uppercase tracking-[0.04em] text-secondary">
                <th scope="col" className="px-5 py-3 font-medium">Name</th>
                <th scope="col" className="px-5 py-3 font-medium">Department</th>
                <th scope="col" className="px-5 py-3 font-medium">Designation</th>
                <th scope="col" className="px-5 py-3 font-medium">Joined</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="border-b border-hairline/70 last:border-0 hover:bg-surface/50">
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-3">
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface text-caption font-semibold text-secondary">
                        {initials(e.name)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-small font-medium">{e.name}</p>
                        <p className="truncate text-caption text-secondary">{e.email}</p>
                      </div>
                    </div>
                  </td>
                  <td className="px-5 py-3 text-small">{e.department}</td>
                  <td className="px-5 py-3 text-small text-secondary">{e.designation}</td>
                  <td className="whitespace-nowrap px-5 py-3 text-small text-secondary">
                    {formatDate(e.joinedAt.slice(0, 10), { year: true, weekday: false })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <AddEmployeeSheet open={adding} onClose={() => setAdding(false)} />
    </Page>
  );
}

const EMPTY: CreateEmployeeRequest = { name: '', email: '', department: '', designation: '', password: '' };
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AddEmployeeSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const queryClient = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState<CreateEmployeeRequest>(EMPTY);
  const [touched, setTouched] = useState(false);

  const create = useMutation({
    mutationFn: (body: CreateEmployeeRequest) => api.createEmployee(body),
    onSuccess: (emp) => {
      queryClient.setQueryData<EmployeesResponse>(qk.employees, (d) => (d ? { employees: [...d.employees, emp] } : d));
      void queryClient.invalidateQueries({ queryKey: qk.employees });
      void queryClient.invalidateQueries({ queryKey: qk.dashboard });
      toast.success(`${emp.name} added.`);
      close();
    },
  });

  function close() {
    setForm(EMPTY);
    setTouched(false);
    create.reset();
    onClose();
  }

  const localErrors = useMemo(() => {
    const e: Partial<Record<keyof CreateEmployeeRequest, string>> = {};
    if (!form.name.trim()) e.name = 'Enter a name.';
    if (!EMAIL_RE.test(form.email.trim())) e.email = 'Enter a valid email.';
    if (!form.department.trim()) e.department = 'Enter a department.';
    if (!form.designation.trim()) e.designation = 'Enter a designation.';
    if (form.password.length < 8) e.password = 'Use at least 8 characters.';
    return e;
  }, [form]);

  const serverErrors = fieldErrors(create.error);
  const errors: Record<string, string | undefined> = touched ? { ...serverErrors, ...localErrors } : serverErrors;
  const set = (k: keyof CreateEmployeeRequest) => (e: { target: { value: string } }) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    if (create.isError) create.reset(); // stale server errors disappear as soon as you edit
  };

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    setTouched(true);
    if (Object.keys(localErrors).length > 0) return;
    create.mutate({
      name: form.name.trim(),
      email: form.email.trim().toLowerCase(),
      department: form.department.trim(),
      designation: form.designation.trim(),
      password: form.password,
    });
  }

  return (
    <Sheet
      open={open}
      onClose={close}
      title="Add employee"
      description="They can sign in right away with this email and password."
      footer={
        <div className="flex justify-end gap-3">
          <Button variant="secondary" onClick={close} disabled={create.isPending}>
            Cancel
          </Button>
          <Button type="submit" form="add-employee" loading={create.isPending}>
            Add employee
          </Button>
        </div>
      }
    >
      <form id="add-employee" onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
        <Field label="Full name" error={errors.name}>
          <Input value={form.name} onChange={set('name')} autoComplete="off" placeholder="Aarav Sharma" />
        </Field>
        <Field label="Work email" error={errors.email}>
          <Input type="email" value={form.email} onChange={set('email')} autoComplete="off" placeholder="aarav@acme.test" />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department" error={errors.department}>
            <Input value={form.department} onChange={set('department')} placeholder="Operations" />
          </Field>
          <Field label="Designation" error={errors.designation}>
            <Input value={form.designation} onChange={set('designation')} placeholder="Associate" />
          </Field>
        </div>
        <Field label="Temporary password" error={errors.password} hint="At least 8 characters. Share it with them securely.">
          <Input type="password" value={form.password} onChange={set('password')} autoComplete="new-password" />
        </Field>
        {create.isError && Object.keys(serverErrors).length === 0 && <InlineError>{errorMessage(create.error)}</InlineError>}
      </form>
    </Sheet>
  );
}
