import type {
  ApiErrorBody,
  AttendanceListResponse,
  AttendanceRecord,
  ChatRequest,
  CheckInRequest,
  CreateEmployeeRequest,
  CreateLeaveRequest,
  DashboardResponse,
  DecideLeaveRequest,
  Doc,
  DocumentsResponse,
  Employee,
  EmployeesResponse,
  ErrorCode,
  HealthResponse,
  LeaveBalanceResponse,
  LeaveRequest,
  LeavesResponse,
  LeaveStatus,
  LoginRequest,
  LoginResponse,
  MeResponse,
} from '../types';

// ---- Token storage ------------------------------------------------------------

const TOKEN_KEY = 'hrc.token';

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable (private mode) — session-only auth */
  }
}

// ---- Errors -------------------------------------------------------------------

/** Every failed request becomes an ApiError carrying the contract's `{ code, message, details }`. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: ErrorCode | 'NETWORK_ERROR' | 'ABORTED' | (string & {}),
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export const isApiError = (e: unknown): e is ApiError => e instanceof ApiError;

export function errorMessage(e: unknown, fallback = 'Something went wrong. Please try again.'): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  return fallback;
}

/** Best-effort extraction of per-field messages from `details` (zod-style or flat). */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || typeof e.details !== 'object' || e.details === null) return {};
  const raw = e.details as Record<string, unknown>;
  const source =
    typeof raw.fieldErrors === 'object' && raw.fieldErrors !== null
      ? (raw.fieldErrors as Record<string, unknown>)
      : raw;
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'string') out[key] = value;
    else if (Array.isArray(value) && typeof value[0] === 'string') out[key] = value[0];
  }
  return out;
}

const FALLBACK_CODES: Record<number, ErrorCode> = {
  400: 'VALIDATION_ERROR',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  422: 'VALIDATION_ERROR',
};

async function toApiError(res: Response): Promise<ApiError> {
  let body: unknown;
  try {
    body = await res.json();
  } catch {
    body = undefined;
  }
  const err = (body as Partial<ApiErrorBody> | undefined)?.error;
  if (err && typeof err.message === 'string') {
    return new ApiError(res.status, err.code ?? FALLBACK_CODES[res.status] ?? 'INTERNAL', err.message, err.details);
  }
  // No contract body on a 5xx means a proxy answered (nginx 502, Vite dev proxy 500): backend is down.
  const message =
    res.status >= 500
      ? "The HR Copilot server isn't responding. Is the backend running?"
      : `Request failed (${res.status}).`;
  return new ApiError(res.status, FALLBACK_CODES[res.status] ?? 'INTERNAL', message);
}

function networkError(e: unknown): ApiError {
  if (e instanceof DOMException && e.name === 'AbortError') return new ApiError(0, 'ABORTED', 'Request was cancelled.');
  return new ApiError(0, 'NETWORK_ERROR', "Can't reach the server. Check your connection and try again.");
}

// ---- 401 handling ---------------------------------------------------------------

let onUnauthorized: () => void = () => {
  setToken(null);
  if (window.location.pathname !== '/login') window.location.assign('/login');
};

/** The auth provider registers a handler that clears state and routes to /login (keeping `from`). */
export function setUnauthorizedHandler(handler: () => void): void {
  onUnauthorized = handler;
}

// ---- Core request -----------------------------------------------------------------

type Query = Record<string, string | number | undefined | null>;

type RequestOptions = {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  query?: Query;
  signal?: AbortSignal;
  /** false for /auth/login: a 401 there means "wrong password", not "session expired". */
  auth?: boolean;
  headers?: Record<string, string>;
};

export function buildUrl(path: string, query?: Query): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  }
  const s = qs.toString();
  return `/api${path}${s ? `?${s}` : ''}`;
}

function authHeaders(auth: boolean): Record<string, string> {
  const token = auth ? getToken() : null;
  return token ? { Authorization: `Bearer ${token}` } : {};
}

/** Low-level fetch: attaches JWT, throws ApiError on non-2xx, triggers the 401 handler. */
export async function rawRequest(path: string, opts: RequestOptions = {}): Promise<Response> {
  const { method = 'GET', body, query, signal, auth = true, headers = {} } = opts;
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      method,
      signal,
      headers: {
        Accept: 'application/json',
        ...(body !== undefined && !isForm ? { 'Content-Type': 'application/json' } : {}),
        ...authHeaders(auth),
        ...headers,
      },
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch (e) {
    throw networkError(e);
  }
  if (!res.ok) {
    const err = await toApiError(res);
    if (res.status === 401 && auth) onUnauthorized();
    throw err;
  }
  return res;
}

export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const res = await rawRequest(path, opts);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

// ---- Upload with progress (fetch can't report upload progress) ----------------------

export function uploadWithProgress<T>(
  path: string,
  form: FormData,
  onProgress?: (fraction: number) => void,
  signal?: AbortSignal,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', buildUrl(path));
    xhr.setRequestHeader('Accept', 'application/json');
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) onProgress(e.loaded / e.total);
    };
    xhr.onerror = () => reject(networkError(new Error('network')));
    xhr.onabort = () => reject(new ApiError(0, 'ABORTED', 'Upload cancelled.'));
    xhr.onload = () => {
      let body: unknown;
      try {
        body = xhr.responseText ? JSON.parse(xhr.responseText) : undefined;
      } catch {
        body = undefined;
      }
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(body as T);
        return;
      }
      const err = (body as Partial<ApiErrorBody> | undefined)?.error;
      if (xhr.status === 401) onUnauthorized();
      reject(
        new ApiError(
          xhr.status,
          err?.code ?? FALLBACK_CODES[xhr.status] ?? 'INTERNAL',
          err?.message ?? (xhr.status === 413 ? 'That file is too large (max 10 MB).' : `Upload failed (${xhr.status}).`),
          err?.details,
        ),
      );
    };
    signal?.addEventListener('abort', () => xhr.abort(), { once: true });
    xhr.send(form);
  });
}

// ---- File download (auth header → blob → <a download>) ------------------------------

export async function downloadFile(path: string, query: Query, fallbackName: string): Promise<void> {
  const res = await rawRequest(path, { query, headers: { Accept: 'text/csv' } });
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match?.[1] ? decodeURIComponent(match[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ---- Typed endpoints (one per contract row) --------------------------------------------

export const api = {
  health: () => request<HealthResponse>('/health', { auth: false }),

  login: (body: LoginRequest) => request<LoginResponse>('/auth/login', { method: 'POST', body, auth: false }),
  me: () => request<MeResponse>('/auth/me'),

  dashboard: () => request<DashboardResponse>('/dashboard'),

  checkIn: (body: CheckInRequest) =>
    request<AttendanceRecord>('/attendance/check-in', { method: 'POST', body }),
  checkOut: () => request<AttendanceRecord>('/attendance/check-out', { method: 'POST' }),
  attendance: (q: { from?: string; to?: string; employeeId?: string }) =>
    request<AttendanceListResponse>('/attendance', { query: q }),
  exportAttendanceCsv: (q: { from: string; to: string }) =>
    downloadFile('/attendance/export.csv', q, `attendance-${q.from}-to-${q.to}.csv`),

  leaves: (q: { status?: LeaveStatus }) => request<LeavesResponse>('/leaves', { query: q }),
  createLeave: (body: CreateLeaveRequest) => request<LeaveRequest>('/leaves', { method: 'POST', body }),
  decideLeave: (id: string, body: DecideLeaveRequest) =>
    request<LeaveRequest>(`/leaves/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  leaveBalance: () => request<LeaveBalanceResponse>('/leaves/balance'),

  employees: () => request<EmployeesResponse>('/employees'),
  createEmployee: (body: CreateEmployeeRequest) => request<Employee>('/employees', { method: 'POST', body }),

  documents: () => request<DocumentsResponse>('/documents'),
  uploadDocument: (file: File, title?: string, onProgress?: (f: number) => void, signal?: AbortSignal) => {
    const form = new FormData();
    form.append('file', file);
    if (title?.trim()) form.append('title', title.trim());
    return uploadWithProgress<Doc>('/documents', form, onProgress, signal);
  },
  deleteDocument: (id: string) => request<void>(`/documents/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  /** Returns the raw streaming Response; read it with `readSSE(res.body)`. */
  chat: (body: ChatRequest, signal?: AbortSignal) =>
    rawRequest('/chat', { method: 'POST', body, signal, headers: { Accept: 'text/event-stream' } }),
};
