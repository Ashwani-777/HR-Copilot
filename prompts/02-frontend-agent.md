# Prompt — Frontend agent

You are building the **frontend** of "HR Copilot": a small HR system for SMEs (GPS attendance, leave,
employees, policy documents) with an AI copilot chat that answers with citations. Portfolio project for a
"Full-Stack Developer (AI-Native)" job — it must look **premium**. **Ship fast; working > perfect.**

Project root: `~/Documents/HR Copilot/`. Work ONLY inside `frontend/` (you may read `docs/`).
The backend is being built in parallel by another agent against `docs/API_CONTRACT.md` — follow that
contract **exactly** (paths, types, error codes, SSE events, Socket.IO event). Don't wait for the backend.

## Stack
Vite + React 18 + TypeScript (strict) + Tailwind CSS + React Router + TanStack Query + socket.io-client +
lucide-react (stroke-width 1.5). Vite dev server on 5173 proxying `/api` and `/socket.io` (ws) to
`http://localhost:4000`. Typed API client in `src/lib/api.ts` (attaches JWT, parses contract error shape,
redirects to /login on 401). Types copied from the contract into `src/types.ts`.

## Design — Apple-like, white & black, classy
- **Font**: `-apple-system, BlinkMacSystemFont, "SF Pro Display", "SF Pro Text", "Inter", "Helvetica Neue", Arial, sans-serif`;
  load **Inter** (400/500/600/700) from Google Fonts as fallback. `-webkit-font-smoothing: antialiased`.
- **Colours** (CSS variables + Tailwind theme): background `#ffffff`, surface `#f5f5f7`, text `#1d1d1f`,
  secondary `#6e6e73`, tertiary `#86868b`, hairline `#d2d2d7`, primary button `#1d1d1f` → hover `#000`.
  Monochrome everywhere. Colour only as tiny status dots/text: green `#248a3d`, orange `#c93400`, red `#d70015`.
  No gradients. Shadows only very soft (`0 4px 24px rgba(0,0,0,.06)`).
- **Type scale**: page title 48px/1.08 semibold, tracking -0.02em (40px on mobile); section title 28px semibold;
  card title 21px semibold; body **17px/1.47**, tracking -0.01em; small 14px; caption 12px secondary.
- **Shape**: cards radius 18px on `#f5f5f7` (or white with hairline border); inputs radius 12px, 44px tall,
  hairline border, black 2px focus ring; buttons are **pills** (radius 980px), primary black/white,
  secondary = surface bg with text colour.
- **Layout**: sticky top nav 52px, `rgba(255,255,255,.72)` + `backdrop-filter: saturate(180%) blur(20px)`,
  hairline bottom border; wordmark "HR Copilot" left, links centre, user menu right. Content max-width 1080px,
  generous whitespace (48–80px section spacing). Fully responsive (phone width, no horizontal scroll;
  nav collapses into a menu).
- **Motion**: subtle 200–300ms ease-out fades/slides, skeleton loaders on surface colour; honour
  `prefers-reduced-motion`.
- Visible keyboard focus, proper labels, semantic HTML.

## Pages
1. **Login** — centred, big "HR Copilot." title, grey subtitle "Your HR, answered.", email/password, demo
   credential quick-fill chips (Admin / Employee from the contract's seed data).
2. **Home / Dashboard** — greeting "Good morning, Riya." large; Today card with big **Check in** / **Check out**
   pill (uses `navigator.geolocation`; on `OUTSIDE_GEOFENCE` show "You're 1.2 km from the office" nicely;
   plus a subtle "Use office location (demo)" link that sends the company's office coords for demos);
   leave balance tiles; for ADMIN a row of stat tiles (present, late, on leave, employees, pending leaves).
3. **Attendance** — date-range filter, clean table (date, name, check-in, check-out, status dot), ADMIN
   "Export CSV" button (download with auth header via fetch → blob).
4. **Leave** — request form (type, from, to, reason) + list with status; ADMIN sees approve/reject buttons.
5. **Documents** — ADMIN drag-and-drop upload (.pdf/.txt/.md), list with live status/progress bar via
   Socket.IO `document:status`, delete. Employees see the list read-only.
6. **Copilot** (the hero feature) — centred 720px chat column. Empty state: big "Ask anything about HR."
   + 4 suggestion chips ("How many casual leaves do I get?", "Who was late this week?",
   "What's the work-from-home policy?", "Who is on leave today?"). User messages = black pill bubbles
   right-aligned; assistant = plain text left, rendered with light markdown (bold, lists). Stream via
   `fetch` + `ReadableStream` SSE parser (`src/lib/sse.ts`): show tool events as a shimmering grey line
   ("Checking late arrivals…"), append tokens live, then show citations as small grey pills
   "[1] Acme HR Policy · p.2" — clicking one opens a popover/sheet with the snippet. `[n]` markers in the
   text are rendered as small superscript links to the pill. Send `history` (last 10 messages). Input bar
   pinned at bottom, Enter to send, Shift+Enter newline, stop button while streaming.
7. **Employees** (ADMIN) — list + "Add employee" sheet.

## Quality
- Loading, empty and error states on every page (errors show the contract `message`).
- Route guard: unauthenticated → /login; ADMIN-only pages hidden for EMPLOYEE.
- Small reusable UI kit in `src/components/ui/` (Button, Input, Card, Badge/StatusDot, Sheet, Skeleton, Toast).
- Unit test for the SSE parser with Vitest (chunks split mid-event must still parse).

## Definition of done (verify yourself)
- `npm run build` (incl. `tsc`) and `npm test` pass; `npm run dev` serves on 5173.
- If the backend at :4000 happens to be up, smoke-test login + chat in the browser; if not, that's fine —
  say so in the report.
- `frontend/README.md`: setup, design system summary, structure.
- `frontend/Dockerfile` (multi-stage build → nginx) + `frontend/nginx.conf` serving the SPA and proxying
  `/api` and `/socket.io` to `backend:4000` (for later; don't run Docker).
- Leave the dev server **stopped** when you finish.

## Rules
- Don't `git commit`. Don't modify anything outside `frontend/`.
- If the contract seems wrong, follow it anyway and list the concern in your final report.
- Keep an honest log in `prompts/agent-log-frontend.md`: key decisions, problems hit, anything the AI
  (you) got wrong and how it was caught/fixed. Short bullet points.
- Final report: what works (verified), what doesn't, commands to run, any contract concerns.

## Quality bar (added after user feedback)
"Fast" means no wasted time — it does NOT mean cutting scope. **Every feature in this brief is required**
and must work end to end. This project has to be clearly more than enough for a Full-Stack (AI-Native)
role that tests TypeScript, Node/Express, React, PostgreSQL/Prisma, Redis/queues, WebSockets and real AI
features. No placeholder screens, no TODO stubs for listed features, no fake data in the UI.
