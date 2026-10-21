import { QueryClient } from '@tanstack/react-query';
import { ApiError } from './api';

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Never retry client errors (4xx): the contract message is the answer.
      retry: (failureCount, error) =>
        !(error instanceof ApiError && error.status >= 400 && error.status < 500) && failureCount < 2,
      refetchOnWindowFocus: true,
    },
    mutations: { retry: false },
  },
});

/** Query keys in one place so invalidations can't drift. */
export const qk = {
  dashboard: ['dashboard'] as const,
  attendance: (q: { from: string; to: string; employeeId?: string }) => ['attendance', q] as const,
  attendanceAll: ['attendance'] as const,
  leaves: (status?: string) => ['leaves', status ?? 'ALL'] as const,
  leavesAll: ['leaves'] as const,
  balance: ['leaves-balance'] as const,
  employees: ['employees'] as const,
  documents: ['documents'] as const,
};
