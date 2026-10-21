# HR Copilot — Frontend

React SPA for HR Copilot: GPS attendance, leave, employees, policy documents and an AI copilot that
streams answers with citations. Built against [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md).

**Stack:** Vite 6 · React 18 · TypeScript (strict) · Tailwind CSS 3 · React Router 7 · TanStack Query 5 ·
socket.io-client · lucide-react · Vitest

## Setup

```bash
cd frontend
npm install
npm run dev          # http://localhost:5173 — proxies /api and /socket.io to http://localhost:4100
```

The backend must be running on `:4100` (see `../backend/README.md`). To point the dev proxy somewhere
else, set `VITE_BACKEND_URL` in your shell or in `frontend/.env` (see `.env.example`).

Demo accounts (seed data, test values only) are one click away on the login screen:
**Admin** `admin@acme.test` / `Admin@123` · **Employee** `riya@acme.test` / `Employee@123`.

| Script | What it does |
|---|---|
| `npm run dev` | Vite dev server on 5173 with API + WebSocket proxy |
| `npm run build` | `tsc -b` (strict type-check) then production build to `dist/` |
| `npm test` | Vitest: SSE parser + Markdown renderer unit tests |
| `npm run typecheck` | Type-check only |
| `npm run preview` | Serve the production build locally |

**Docker (later):** `Dockerfile` is a two-stage build (Node 20 → nginx 1.27). `nginx.conf` serves the SPA
with a history fallback and proxies `/api` (buffering off, so SSE streams token-by-token) and
`/socket.io` (WebSocket upgrade) to `backend:4100`. Used by `../docker-compose.yml`.

## Pages

| Route | Who | What |
|---|---|---|
| `/login` | public | Big "HR Copilot." title, email/password, demo quick-fill chips |
| `/` | all | Greeting, **Check in / Check out** with `navigator.geolocation` (friendly "You're 1.2 km from the office" on `OUTSIDE_GEOFENCE`, plus a "Use office location (demo)" link), leave balance tiles, ADMIN stat tiles, Copilot shortcuts |
| `/attendance` | all | Date-range filter + quick ranges, ADMIN employee filter, table with status dots, ADMIN **Export CSV** (fetch with auth header → blob → download) |
| `/leave` | all | Request form (type/from/to/reason, live balance hint), status filter, ADMIN approve/reject |
| `/documents` | all (upload/delete: ADMIN) | Drag-and-drop upload with upload %, live indexing progress from Socket.IO `document:status`, delete with inline confirm; polling fallback if the socket is down |
| `/copilot` | all | Streaming chat: tool steps as a shimmering line, live tokens, light Markdown, `[n]` superscript links, source pills with a snippet popover, stop button, retry, last-10-message history |
| `/employees` | ADMIN | Searchable list + "Add employee" sheet (client + server field errors) |

Every page has skeleton loading, empty and error states (errors show the contract `message`).
Unauthenticated users are redirected to `/login` (and sent back afterwards); ADMIN-only pages are hidden
from the nav and redirect employees home. Any `401` clears the session and shows "Your session ended".

## Design system

Apple-like, monochrome, lots of air. Tokens live as CSS variables in `src/index.css` and are mapped into
the Tailwind theme in `tailwind.config.ts` (RGB channels, so opacity modifiers work).

| Token | Value |
|---|---|
| Font | `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Helvetica Neue", Arial` (Inter 400–700 loaded as fallback), antialiased |
| Colours | bg `#ffffff` · surface `#f5f5f7` · text `#1d1d1f` · secondary `#6e6e73` · tertiary `#86868b` · hairline `#d2d2d7` · primary button `#1d1d1f` → `#000` |
| Status (dots/text only) | green `#248a3d` · orange `#c93400` · red `#d70015` |
| Type scale | page title 48/1.08 semibold −0.02em (40 on mobile) · section 28 · card 21 · body 17/1.47 −0.01em · small 14 · caption 12 |
| Shape | cards 18px radius on surface (or white + hairline) · inputs 44px tall, 12px radius, hairline border, 2px black focus ring · buttons are pills (980px) |
| Elevation | one soft shadow only: `0 4px 24px rgba(0,0,0,.06)` |
| Layout | sticky 52px translucent nav (`saturate(180%) blur(20px)`), content max-width 1080px, 48–80px section spacing; chat column 720px |
| Motion | 200–300ms ease-out fades/slides, surface-coloured skeletons; all disabled under `prefers-reduced-motion` |
| Icons | lucide-react, stroke width 1.5 |

UI kit (`src/components/ui/`): `Button`/`ButtonLink`/`IconButton`, `Input`/`Select`/`Textarea`/`Field`
(label + hint/error wired with `aria-describedby`), `Card`/`StatTile`, `StatusDot`/`Badge`, `Sheet`
(focus trap, Esc, scroll lock; bottom sheet on phones), `Skeleton`, `Toast`, `ProgressBar`,
`SegmentedControl`, `EmptyState`/`ErrorState`/`InlineError`.

## Structure

```
src/
  main.tsx, App.tsx            routes + providers (Query, Toast, Router, Auth)
  types.ts                     types copied verbatim from the API contract
  lib/
    api.ts                     typed client: JWT, contract error shape → ApiError, 401 handler,
                               XHR upload with progress, authenticated CSV download
    sse.ts (+ .test.ts)        fetch/ReadableStream SSE parser + contract chat-event mapping
    markdown.ts (+ .test.ts)   tiny safe Markdown subset (no innerHTML) incl. [n] citations
    queryClient.ts             TanStack Query client + central query keys
    format.ts, geo.ts, cn.ts   dates/times in company TZ, geolocation wrapper, class joiner
  providers/
    AuthProvider.tsx           session restore via /auth/me, login/logout, offline state
    SocketProvider.tsx         one Socket.IO connection per session (auth: { token })
    ChatProvider.tsx           copilot conversation state (survives page switches), streaming, stop, retry
  components/
    ui/                        design-system kit (see above)
    layout/                    AppShell + nav/user menu, route guards, Page/Section
    copilot/                   Composer, Messages, Markdown, Citations
  pages/                       Login, Dashboard, Attendance, Leave, Documents, Copilot, Employees, NotFound
```

### How the copilot stream works

`POST /api/chat` can't use `EventSource` (needs a body + `Authorization`), so `api.chat()` returns the
raw `fetch` response and `readSSE()` decodes the `ReadableStream` with a streaming `TextDecoder` and a
line-buffering parser. Chunks can split anywhere — mid-field, between `\r` and `\n`, inside a multi-byte
character — and the unit tests replay the stream split at **every** byte offset to prove it. Tokens are
coalesced per animation frame; a half-typed `**bold` is hidden until it closes; `AbortController` powers
the stop button.
