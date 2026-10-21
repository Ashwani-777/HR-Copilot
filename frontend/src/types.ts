// Types copied verbatim from docs/API_CONTRACT.md — the single source of truth.
// Keep in sync with the contract; do not "improve" shapes here.

export type Role = 'ADMIN' | 'EMPLOYEE';

export type User = {
  id: string;
  name: string;
  email: string;
  role: Role;
  companyId: string;
  employeeId: string | null;
};

export type Company = {
  id: string;
  name: string;
  officeLat: number;
  officeLng: number;
  geofenceRadiusM: number;
  shiftStart: string /* "09:30" */;
  timezone: string;
};

export type Employee = {
  id: string;
  name: string;
  email: string;
  department: string;
  designation: string;
  joinedAt: string;
};

export type AttendanceStatus = 'ON_TIME' | 'LATE';

export type AttendanceRecord = {
  id: string;
  employeeId: string;
  employeeName: string;
  date: string;
  checkInAt: string;
  checkOutAt: string | null;
  distanceM: number;
  status: AttendanceStatus;
};

export type LeaveType = 'CASUAL' | 'SICK' | 'EARNED';
export type LeaveStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export type LeaveRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  type: LeaveType;
  from: string;
  to: string;
  days: number;
  reason: string;
  status: LeaveStatus;
  createdAt: string;
  decidedAt: string | null;
};

export type LeaveBalance = { type: LeaveType; allowed: number; used: number; remaining: number };

export type DocumentStatus = 'QUEUED' | 'PROCESSING' | 'READY' | 'FAILED';

export type Doc = {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  status: DocumentStatus;
  progress: number /* 0-100 */;
  pages: number | null;
  chunks: number | null;
  error: string | null;
  createdAt: string;
};

export type Citation = {
  index: number /* 1-based, matches [1] in text */;
  documentId: string;
  documentTitle: string;
  page: number | null;
  snippet: string;
};

export type ChatMessage = { role: 'user' | 'assistant'; content: string };

// ---- Response envelopes ----------------------------------------------------

export type HealthResponse = { status: 'ok'; db: boolean; redis: boolean };
export type LoginRequest = { email: string; password: string };
export type LoginResponse = { token: string; user: User; company: Company };
export type MeResponse = { user: User; company: Company };

export type DashboardStats = {
  totalEmployees: number;
  presentToday: number;
  lateToday: number;
  onLeaveToday: number;
  pendingLeaves: number;
};

export type DashboardResponse = {
  today: { date: string; record: AttendanceRecord | null };
  leaveBalances: LeaveBalance[];
  stats: null | DashboardStats;
};

export type CheckInRequest = { lat: number; lng: number };
export type AttendanceListResponse = { records: AttendanceRecord[] };
export type LeavesResponse = { leaves: LeaveRequest[] };
export type CreateLeaveRequest = { type: LeaveType; from: string; to: string; reason: string };
export type DecideLeaveRequest = { status: 'APPROVED' | 'REJECTED' };
export type LeaveBalanceResponse = { balances: LeaveBalance[] };
export type EmployeesResponse = { employees: Employee[] };
export type CreateEmployeeRequest = {
  name: string;
  email: string;
  department: string;
  designation: string;
  password: string;
};
export type DocumentsResponse = { documents: Doc[] };
export type ChatRequest = { message: string; history?: ChatMessage[] /* last ≤10 */ };

// ---- Errors ----------------------------------------------------------------

export type ErrorCode =
  | 'VALIDATION_ERROR'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'ALREADY_CHECKED_IN'
  | 'NOT_CHECKED_IN'
  | 'OUTSIDE_GEOFENCE'
  | 'INTERNAL';

export type ApiErrorBody = {
  error: { code: ErrorCode | string; message: string; details?: unknown };
};

/** `details` of `422 OUTSIDE_GEOFENCE`. */
export type GeofenceErrorDetails = { distanceM: number; radiusM: number };

// ---- Chat SSE events (POST /api/chat) ---------------------------------------

export type ChatStreamEvent =
  | { type: 'tool'; name: string; label: string }
  | { type: 'token'; text: string }
  | { type: 'citations'; citations: Citation[] }
  | { type: 'done' }
  | { type: 'error'; message: string };
