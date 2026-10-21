# HR Copilot — API Contract (single source of truth)

Frontend and backend are built in parallel against THIS file. Do not change it silently.

## Basics
- Backend: Node 20 + TypeScript, port **4100**, all routes under **`/api`**.
- Frontend dev server: port **5173**, Vite proxies `/api` and `/socket.io` → `http://localhost:4100`.
- Auth: `Authorization: Bearer <jwt>` (7-day expiry). Roles: `ADMIN`, `EMPLOYEE`.
- Every row belongs to a company (`companyId`). A user can NEVER read/write another company's data.
- Dates: `YYYY-MM-DD`; timestamps: ISO 8601 strings. Company timezone `Asia/Kolkata`.
- Error shape (all non-2xx):
  ```json
  { "error": { "code": "VALIDATION_ERROR", "message": "Human readable", "details": {} } }
  ```
  Codes: `VALIDATION_ERROR` 400, `UNAUTHORIZED` 401, `FORBIDDEN` 403, `NOT_FOUND` 404,
  `ALREADY_CHECKED_IN` 409, `NOT_CHECKED_IN` 409, `OUTSIDE_GEOFENCE` 422, `INTERNAL` 500.

## Types
```ts
type Role = "ADMIN" | "EMPLOYEE";
type User = { id: string; name: string; email: string; role: Role; companyId: string; employeeId: string | null };
type Company = { id: string; name: string; officeLat: number; officeLng: number; geofenceRadiusM: number; shiftStart: string /* "09:30" */; timezone: string };
type Employee = { id: string; name: string; email: string; department: string; designation: string; joinedAt: string };
type AttendanceRecord = {
  id: string; employeeId: string; employeeName: string; date: string;
  checkInAt: string; checkOutAt: string | null; distanceM: number; status: "ON_TIME" | "LATE";
};
type LeaveType = "CASUAL" | "SICK" | "EARNED";
type LeaveRequest = {
  id: string; employeeId: string; employeeName: string; type: LeaveType; from: string; to: string;
  days: number; reason: string; status: "PENDING" | "APPROVED" | "REJECTED"; createdAt: string; decidedAt: string | null;
};
type LeaveBalance = { type: LeaveType; allowed: number; used: number; remaining: number };
type DocumentStatus = "QUEUED" | "PROCESSING" | "READY" | "FAILED";
type Doc = {
  id: string; title: string; filename: string; mimeType: string; status: DocumentStatus;
  progress: number /* 0-100 */; pages: number | null; chunks: number | null; error: string | null; createdAt: string;
};
type Citation = { index: number /* 1-based, matches [1] in text */; documentId: string; documentTitle: string; page: number | null; snippet: string };
type ChatMessage = { role: "user" | "assistant"; content: string };
```

## Endpoints

| Method | Path | Role | Body / Query | Response |
|---|---|---|---|---|
| GET | `/api/health` | public | – | `{ status: "ok", db: boolean, redis: boolean }` |
| POST | `/api/auth/login` | public | `{ email, password }` | `{ token, user: User, company: Company }` |
| GET | `/api/auth/me` | any | – | `{ user: User, company: Company }` |
| GET | `/api/dashboard` | any | – | see below |
| POST | `/api/attendance/check-in` | any w/ employeeId | `{ lat: number, lng: number }` | `201 AttendanceRecord` · `422 OUTSIDE_GEOFENCE` (`details: { distanceM, radiusM }`) · `409 ALREADY_CHECKED_IN` |
| POST | `/api/attendance/check-out` | any w/ employeeId | – | `AttendanceRecord` · `409 NOT_CHECKED_IN` |
| GET | `/api/attendance` | any | `?from&to&employeeId` (defaults: last 30 days) | `{ records: AttendanceRecord[] }` — EMPLOYEE only ever gets own records |
| GET | `/api/attendance/export.csv` | ADMIN | `?from&to` | `text/csv` file download |
| GET | `/api/leaves` | any | `?status` | `{ leaves: LeaveRequest[] }` — EMPLOYEE gets own, ADMIN gets all |
| POST | `/api/leaves` | any w/ employeeId | `{ type, from, to, reason }` | `201 LeaveRequest` |
| PATCH | `/api/leaves/:id` | ADMIN | `{ status: "APPROVED" \| "REJECTED" }` | `LeaveRequest` |
| GET | `/api/leaves/balance` | any w/ employeeId | – | `{ balances: LeaveBalance[] }` |
| GET | `/api/employees` | ADMIN | – | `{ employees: Employee[] }` |
| POST | `/api/employees` | ADMIN | `{ name, email, department, designation, password }` | `201 Employee` |
| GET | `/api/documents` | any | – | `{ documents: Doc[] }` |
| POST | `/api/documents` | ADMIN | `multipart/form-data`, field **`file`** (.pdf/.txt/.md, ≤ 10 MB), optional field `title` | `202 Doc` (status `QUEUED`) |
| DELETE | `/api/documents/:id` | ADMIN | – | `204` |
| POST | `/api/chat` | any | `{ message: string, history?: ChatMessage[] /* last ≤10 */ }` | **SSE stream**, see below |

### `GET /api/dashboard`
```ts
{
  today: { date: string; record: AttendanceRecord | null };   // null if user has no employeeId or not checked in
  leaveBalances: LeaveBalance[];                               // [] if no employeeId
  stats: null | {                                              // null for EMPLOYEE
    totalEmployees: number; presentToday: number; lateToday: number; onLeaveToday: number; pendingLeaves: number;
  };
}
```

### `POST /api/chat` — Server-Sent Events
Response `Content-Type: text/event-stream`. Frontend reads it with `fetch()` + `ReadableStream`
(EventSource cannot POST or send headers). Events, in order:
```
event: tool        data: {"name":"getLateArrivals","label":"Checking late arrivals…"}   (0..n times)
event: token       data: {"text":"partial answer text"}                                   (1..n times)
event: citations   data: {"citations":[Citation, ...]}                                     (exactly once, may be [])
event: done        data: {}
event: error       data: {"message":"..."}                                                 (instead of done, on failure)
```
Answer text references sources as `[1]`, `[2]` matching `Citation.index`.
If nothing relevant is found the assistant says it doesn't know instead of guessing.

## Realtime — Socket.IO (path `/socket.io`)
- Client connects with `io({ auth: { token } })`; server verifies JWT and joins room `company:<companyId>`.
- Server emits **`document:status`** with payload `Doc` whenever a document's status/progress changes.

## Seed data (test values only)
- Company **Acme Staffing Pvt Ltd** — office Noida Sector 62 (`28.6270, 77.3727`), radius 200 m, shift 09:30.
  - Admin: `admin@acme.test` / `Admin@123`
  - Employee: `riya@acme.test` / `Employee@123` (+ ~10 more employees, 30 days of attendance, some leaves)
  - HR policy document ingested (leave, attendance, WFH, reimbursement, holidays).
- Company **Globex Retail** (second tenant, used to prove isolation): `admin@globex.test` / `Admin@123`.
