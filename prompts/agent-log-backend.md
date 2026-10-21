# Agent log — backend

Honest notes from the backend agent (Claude Code). Short bullets: decisions, problems hit, and what I got wrong.

## Key decisions
- **Pinned known-good majors instead of "latest"**: Prisma 6.19, TypeScript 5.9, Vitest 3.2, BullMQ 5, ioredis 5,
  OpenAI SDK 6, Express 5, Zod 4. npm's latest tags were TypeScript 7, Prisma 7/8-rc, Vitest 5, BullMQ 6 and OpenAI 7 —
  new majors with breaking changes I'd be guessing about. `@anthropic-ai/sdk` stays on latest (0.137) so the
  current Claude parameters are typed.
- **ESM + NodeNext** (`"type": "module"`, `.js` import suffixes). tsx for dev, tsc for build.
- **Raw-SQL migration** generated with `prisma migrate diff`, then hand-edited: `CREATE EXTENSION vector`,
  `tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', content)) STORED`, GIN + HNSW indexes. Chunks are
  written and read with `$executeRaw`/`$queryRaw` (Prisma models them as `Unsupported`).
- **Full-text query = OR of question words** fed to `websearch_to_tsquery`. Plain websearch AND-semantics match nothing
  for natural questions ("how many casual leaves do I get").
- **Vector search filters by `embeddingModel`** stored on Document, so switching embedding providers can't silently
  compare incompatible vectors. Also `SET LOCAL hnsw.iterative_scan = relaxed_order` so the tenant filter doesn't starve HNSW.
- **Provider-neutral agent loop** (`ai/types.ts`): mock / OpenAI-compatible / Anthropic implement one `turn()`
  interface. The mock *is* a model for the loop: turn 1 routes to a tool, turn 2 writes a cited answer from the tool
  results, and it reads "today" from the system prompt like a real LLM would. Tests run the real loop.
- **Preamble gate**: LLM text before a tool call is held back (up to 200 chars) so `tool` events always precede `token`
  events, as the contract's SSE order requires. Final round uses `tool_choice: "none"` (tools stay declared, history stays valid).
- **Anthropic provider** written after invoking the `claude-api` skill (as the brief asked): model `claude-haiku-5-5`,
  streaming manual loop with `finalMessage()`, assistant content replayed verbatim (thinking blocks round-trip),
  `eager_input_streaming` on tools with Zod re-validation, no sampling params, refusal/max_tokens handling,
  typed SDK errors mapped to readable messages.
- **Seed uses stable, hash-derived IDs + a seeded PRNG**, so re-seeding gives the same data and doesn't invalidate
  JWTs the frontend holds. It refuses to touch any database not named `hr_copilot*`, and wipes only its own tables.
- Admin users are also employees (HR Manager), so the "login as admin → check-in" smoke test works. Demo users
  (admin, Riya) get no "today" attendance, so check-in can be shown live.
- **Leave rules**: days = Mon–Fri working days; `used` = APPROVED days in the calendar year; requests check
  remaining − pending; overlap with pending/approved → 400. Contract has no generic 409, so conflicts are `VALIDATION_ERROR`.

## Environment
- Postgres on this Mac is **Postgres.app 18** already on :5432 (pgvector 0.8.2 available), not Homebrew PG16.
  The brew `postgresql@16` service is in a failing restart loop because :5432 is taken. I didn't start it and left it alone.
- Redis wasn't running → `brew services start redis` (allowed by the brief). App uses DB 5 + prefix `hrc`.
- Created only `hr_copilot` and `hr_copilot_test` (plus a throwaway `hr_copilot_fresh` to prove seeding on a fresh DB,
  dropped afterwards). No other database touched.
- **Port change (orchestrator)**: :4000 belongs to another local project (Scroll-up backend). Switched to **:4100** in
  config default, `.env`, `.env.example`, README. I hadn't sent anything to :4000. The orchestrator runs its own copy on
  :4101 against the same DB; I left that port alone.
- **Priority change (orchestrator)**: the user couldn't log in, so I paused the chat providers and shipped seed + login + /me
  first (seeded `hr_copilot`, verified with curl, messaged the orchestrator), then continued.

## Problems hit / things I got wrong (and how they were caught)
- **Broke my own migration**: generated SQL with `2>&1`, so a Prisma CLI deprecation warning went into
  `migration.sql` → `migrate deploy` failed with a syntax error. Fixed the file, `migrate resolve --rolled-back`, redeployed.
  Also removed the deprecated `package.json#prisma` key that caused the warning.
- **Agent loop bug**: I used the text gate's "committed" flag to mean "the answer has started". For providers without
  preambles (mock) the gate starts committed, so every tool call was ignored and chat said "I don't know".
  **Caught by the first curl smoke test**; fixed by tracking "has this turn emitted text" instead.
- **Realtime across instances**: a document upload stayed at QUEUED on my socket. The orchestrator's :4101 copy shares the
  BullMQ queue, its worker took the job, and it emitted `document:status` on *its own* Socket.IO server. Fixed properly
  with the **Socket.IO Redis adapter** (`@socket.io/redis-adapter`, key `hrc:socket.io`). Re-tested: QUEUED → PROCESSING
  5/25/35/90 → READY 100 arrives on :4100 whichever instance runs the job.
- **pdf-parse "bad XRef entry"** on small PDFs, **caught by the unit test** with a generated 3-page PDF. Cause: pdf.js reads
  the Buffer's whole underlying ArrayBuffer; small Node Buffers live in a shared 8 KB pool at an offset (and under Vitest
  any Buffer failed). Fix: pass pdf.js a fresh exact-size `Uint8Array`. This would have broken real uploads of small PDFs.
- **Listener leak** in the mock's word-by-word streaming (one abort listener per word → MaxListenersExceededWarning).
  Seen in server logs; fixed by removing the listener when each timer fires.
- `/api/health` reported `redis:false` on the first call (lazy client not yet connected, offline queue off). Fixed by
  waiting for `ready` (bounded by the 1 s timeout). Also stopped re-adding the error listener on every call.
- I first typed a made-up bcrypt "dummy hash" for constant-time login. I replaced it before running with one computed at
  startup, because an invalid hash could have thrown.
- Seed's "repeat late-comer is late on the most recent working day" landed on **Dussehra (20 Oct)**, a holiday the seed
  skips. Fixed to pick the latest non-holiday day.
- The policy text said public holidays are excluded from leave counts, but the code only excludes weekends. I changed the
  policy wording to match the code (holiday-aware counting is listed as a limitation).
- Citation snippets started mid-sentence ("to Friday); weekends…") because chunk overlaps only aligned to words. Seen in the
  final smoke test; overlaps now start at a sentence boundary when ≥ 40 chars of overlap remain (eval: vector hit@3 88% → 94%,
  hybrid MRR 0.93 → 0.97). Re-ingested just the two policy docs in `hr_copilot` rather than re-seeding, so the user's preview
  actions weren't wiped.
- Prisma logged every handled unique-violation (the expected 409 path) as `prisma:error`. Reduced Prisma logging to warnings;
  unexpected errors are still logged by the central error handler.

## Verified (actually run)
- `npm run typecheck` clean; `npm test` → 98 tests / 13 files pass; `npm run build` + `node dist/index.js` serve health/login.
- `npm run seed` on a fresh DB; `npm run eval` (hit@3: FTS 100%, mock-vector 94%, hybrid 100%; MRR 0.93 / 0.84 / 0.97).
- curl smoke on :4100: login (3 seed users), /me, dashboard, check-in outside (422 + distance) / inside (201) / again (409),
  check-out, list, CSV, leaves, employees, documents upload → READY via Socket.IO, delete, chat SSE with citations for
  "How many casual leaves do I get?" and a `getLateArrivals` tool call for "Who was late this week?".
  Smoke artefacts (my check-in, uploaded test docs) were removed afterwards.

## Not verified
- OpenAI / Anthropic providers were **not called live** (no keys used). They're exercised offline against the real SDKs with
  a stubbed `fetch` replaying SSE streams (request shape, streaming, tool-call parsing, history replay).
- Dockerfile not built (no Docker on this machine by design). Note: root `docker-compose.yml` / frontend nginx assumed
  `backend:4000`; the image listens on 4100.
- `npm audit`: 3 high in Prisma CLI's config dependency (`deepmerge-ts`) and a critical in Vitest's `tinypool`. These are
  dev/build-time tools, not request-path code; upgrading means moving to Prisma 7 / Vitest 4 majors.
