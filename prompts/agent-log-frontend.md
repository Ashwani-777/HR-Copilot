# Agent log — frontend

Honest log of the frontend agent's work (Claude Code, following `02-frontend-agent.md`).

## Key decisions
- **Versions pinned** (exact): Vite 6.4, React 18.3, TS 5.9 strict (+ `noUncheckedIndexedAccess`), Tailwind 3.4,
  TanStack Query 5, socket.io-client 4.8, lucide-react, Vitest 4.
- **React Router 7 instead of 6.** Started on 6.30; `npm audit` flagged it (moderate) and the fix is only in 7.x,
  which still supports React 18. Same declarative `<Routes>` API, so no code changes.
  Remaining audit items are build-time only (Tailwind 3's glob/postcss deps); the only fix is Tailwind 4 (breaking).
- **Design tokens as CSS variables (RGB channels) mapped into the Tailwind theme**, so `bg-ink/60`-style opacity
  modifiers keep working and colours stay in one place.
- **SSE via `fetch` + `ReadableStream`** (`src/lib/sse.ts`): line-buffering parser per the WHATWG spec (CRLF/CR/LF,
  comments, multi-line `data`, held-back trailing `\r`), streaming `TextDecoder` for split UTF-8. Tests replay the
  stream split at every byte offset. Malformed frames are dropped, not fatal.
- **Own tiny Markdown renderer** (no `dangerouslySetInnerHTML`, no dependency): paragraphs, lists, tables, code,
  bold/italic, http(s)-only links, and `[n]` / `[1, 2]` citation markers.
- **Chat state in a provider above the routes** so leaving /copilot and coming back keeps the conversation.
  Tokens are batched per animation frame. History = last 10 non-error messages.
- **Upload uses XHR** (fetch has no upload progress), then Socket.IO `document:status` drives indexing progress;
  polling fallback (3 s) only while the socket is down and something is in flight. Re-sync on reconnect.
- **401 anywhere** → central handler clears token + query cache → guard redirects to /login with "session ended"
  and remembers `from`. Login's own 401 is excluded (it means wrong password).
- **Backend unreachable on boot** (network/5xx on `/auth/me`) shows an offline screen with Retry instead of
  logging the user out.

## Port change (from orchestrator)
- Port 4000 on this machine is taken by an unrelated project, so the backend moved to **4100**. Updated the Vite
  proxy default to `http://localhost:4100` (override with `VITE_BACKEND_URL`, now also read from `frontend/.env`
  via `loadEnv`), README, and `nginx.conf` → `backend:4100`. Did not touch the orchestrator's preview on 5174.

## Problems hit / things I (the AI) got wrong, and how they were caught
- **StrictMode killed the first chat request.** The chat provider aborted in-flight requests in an unmount cleanup;
  React 18 StrictMode runs mount→unmount→mount in dev, so `/copilot?q=…` deep links showed "Stopped" instantly.
  Caught in the browser smoke test; fixed with a deferred "really unmounted?" check before aborting.
- **Citation marker wrapped onto its own line** ("year¹" / ". Unused…") because the marker was an inline-block
  `<button>`. Caught visually on the phone viewport; switched to an inline `<a href="#…-cite-n">` superscript link
  (also matches the brief: "superscript links to the pill") and trimmed the space before markers.
- **Raw `**12` flashed mid-stream.** Added `tidyStreaming()` that hides an unmatched `**`/`` ` `` until it closes.
- **Invalid HTML**: first version of the leave list put `<li>` inside a `<div>` inside `<ul>`; fixed by letting
  `Card` render as `ul`. Polymorphic `Card` typing also failed `tsc` initially; fixed.
- `Section` relied on `first:mt-0`, which never matched (the page header is the first child) — replaced with a
  `flush` prop.
- `.env` value would have been ignored: `process.env` in `vite.config.ts` doesn't see `.env` files — switched to `loadEnv`.
- My own throwaway contract mock (scratchpad only, not in the repo) first interleaved tool and token events
  because of a `setTimeout` race — a mock bug, not an app bug, but it briefly made the stream look garbled.
- Server field errors on "Add employee" stayed visible after editing the field; now cleared on change.

## Verification
- `npm run build` (tsc strict + vite) ✅ · `npm test` 21 tests ✅ (SSE parser incl. every-offset splits and
  split multi-byte chars, chat-event mapping, Markdown).
- Browser smoke test (desktop + 375 px phone) against a contract mock: login chips, geolocation denied,
  geofence 1.2 km message, office-location check-in, stats tiles, chat streaming with tool shimmer, Markdown,
  citation pills + popover from both pill and `[n]`, stop, error + retry, history sent, deep link, documents
  drag-and-drop (type validation, upload, live progress via Socket.IO, FAILED state, delete), leave approve +
  validation, CSV export (filename from Content-Disposition), add employee incl. duplicate-email field error,
  401 → "session ended", employee role hides admin UI, no horizontal scroll on phone.
- Against the **real backend on :4100**: login, dashboard, attendance (230 records), leaves, documents, employees
  and the Socket.IO connection all render correctly with real data. At first `POST /api/chat` returned
  `404 No route for POST /chat` (backend not finished; the UI showed that contract message with "Try again").
  Re-tested once it was mounted: "How many casual leaves do I get?" streamed with the `searchPolicy` step,
  Markdown and two citation pills; "Who was late this week?" streamed the `getLateArrivals` step and a list.
  No writes were made against the real backend's database (no check-in/leave/upload there).
- Backend-down boot: Vite's proxy answers 500 with no body → now shown as "Can't reach HR Copilot. The HR Copilot
  server isn't responding. Is the backend running?" with Retry / Sign out (verified).

## Mistake: I stopped the orchestrator's preview on :5174
- When stopping my own dev server at the end I used `pkill -f "HR Copilot/frontend/node_modules/.bin/vite"`
  **without an anchor**, which also matched the orchestrator's `vite --port 5174` preview and killed it.
  Earlier stops used an anchored pattern and were fine. My attempt to restart it was (correctly) blocked by
  the permission system, so it has to be restarted by the orchestrator/user:
  `cd frontend && npx vite --port 5174`. Lesson: stop processes by PID I started, never by a broad pattern.
