# Prompt — Backend agent

You are building the **backend** of "HR Copilot": a small HR system for SMEs (employees, GPS attendance,
leave) with an AI copilot that answers HR policy questions via RAG (with citations) and data questions
via tool calls. This is a portfolio project for a "Full-Stack Developer (AI-Native)" job, so code quality,
clear structure and a working demo matter more than feature count. **Ship fast; working > perfect.**

Project root: `~/Documents/HR Copilot/`. Work ONLY inside `backend/` (you may read `docs/`).
The API contract in `docs/API_CONTRACT.md` is the single source of truth — a frontend is being built
against it in parallel by another agent, so implement it **exactly** (paths, shapes, error codes, SSE events).

## Stack
- Node 20, TypeScript (strict), **Express**, **Zod** validation, **Prisma** + **PostgreSQL 16** + **pgvector**.
- **Redis** + **BullMQ** for document ingestion jobs (worker runs in the same process for simplicity).
- **Socket.IO** for `document:status` events. JWT auth (`jsonwebtoken`), `bcryptjs`, `multer` for upload,
  `pdf-parse` for PDFs. **Vitest** + **supertest** for tests. `tsx` for dev.

## Local environment (no Docker)
- Postgres 16 + Redis are installed via Homebrew (`/opt/homebrew`). Start them if not running
  (`brew services start postgresql@16`, `brew services start redis`).
- pgvector: if `CREATE EXTENSION vector` fails, run `brew install pgvector` and retry.
- Use a NEW database `hr_copilot` (and `hr_copilot_test` for tests). **Never drop, alter or touch any other
  database** on this machine — other projects live there. Redis: use DB index 5 and BullMQ prefix `hrc`;
  never FLUSHALL/FLUSHDB.
- `.env.example` (committed) + `.env` (git-ignored) with: `PORT=4000`, `DATABASE_URL`, `REDIS_URL=redis://localhost:6379/5`,
  `JWT_SECRET`, `LLM_PROVIDER=mock`, `EMBEDDING_PROVIDER=mock`, `OPENAI_API_KEY`, `OPENAI_BASE_URL`, `OPENAI_MODEL`,
  `OPENAI_EMBEDDING_MODEL`, `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL=claude-haiku-5-5`.

## Features
1. **Auth & multi-tenancy** — login, `/me`, role middleware. Every query is scoped by `companyId` from the JWT.
   EMPLOYEE can only see own attendance/leaves.
2. **Attendance** — check-in with `{lat,lng}`: server computes haversine distance to the company office;
   reject with `422 OUTSIDE_GEOFENCE` beyond `geofenceRadiusM`. Status `LATE` if after `shiftStart` in company TZ.
   One check-in per employee per day. Check-out. List + CSV export.
3. **Leave** — request, approve/reject (ADMIN), balances (allowances: CASUAL 12, SICK 8, EARNED 15 per year).
4. **Employees** — list/create (ADMIN).
5. **Documents (RAG ingestion)** — upload → save to `uploads/` → `202` → BullMQ job: extract text **per page**
   (pdf-parse pagerender, or treat .md/.txt as page 1..n by ~3000 chars) → chunk (~800 chars, 150 overlap,
   keep page number) → embed (batch) → insert into `Chunk` table with `vector(1536)` + generated `tsvector`.
   Emit `document:status` with progress at each step. Failed jobs → status `FAILED` + error message.
6. **Retrieval** — **hybrid search**: Postgres full-text (`websearch_to_tsquery`, GIN index) + pgvector cosine
   (HNSW index), merged with **Reciprocal Rank Fusion**, always filtered by `companyId`. Use `$queryRaw`
   (Prisma uses `Unsupported("vector(1536)")`). Write the raw-SQL migration for extension + indexes.
7. **Chat** (`POST /api/chat`, SSE exactly as in the contract) — an LLM with tools:
   `searchPolicy(query)`, `getAttendanceSummary({from,to,department?,employeeName?})`,
   `getLateArrivals({from,to,minCount?})`, `getLeaveBalance({employeeName?})`, `getWhoIsOnLeave({date})`.
   Tools are typed functions over Prisma — the model NEVER writes SQL. Tools enforce role: EMPLOYEE tools
   only return the caller's own data. System prompt: answer only from tool results, cite policy chunks as
   [n], say "I don't know" when nothing relevant is found. Max 4 tool-call rounds.
   **Providers** behind one interface (`src/ai/`):
   - `mock` (default, no keys needed, deterministic): embeddings = hashed bag-of-words into 1536 dims
     (L2-normalised) so retrieval genuinely works; chat = keyword routing to the right tool + a templated
     answer that quotes the top chunks with [n] citations; stream tokens word-by-word.
   - `openai` — any OpenAI-compatible API via `OPENAI_BASE_URL` (OpenAI, Groq, Ollama) for chat + embeddings.
   - `anthropic` — Claude via `@anthropic-ai/sdk` with tool use; **invoke the `claude-api` skill first**
     for correct SDK usage. (Embeddings still come from EMBEDDING_PROVIDER.)
8. **Health** endpoint, central error handler producing the contract error shape, request logging (pino).
9. **Seed** (`npm run seed`): data from the contract's "Seed data" section, attendance for the last 30
   working days (realistic mix of on-time/late, a few repeat late-comers), some leaves, and a ~2–3 page
   `seed/policies/acme-hr-policy.md` (leave, attendance & late policy, WFH, reimbursement, holidays,
   code of conduct) ingested synchronously so chat works right after seeding. Globex gets its own small
   policy so isolation can be demonstrated.
10. **Eval** (`npm run eval`): ~15 questions about the seeded policy with the expected section/keyword;
    print retrieval hit-rate@3 for full-text, vector and hybrid.

## Tests (must pass)
Tenant isolation (Globex admin cannot see Acme docs/attendance/leaves, incl. via chat tools),
geofence accept/reject, late calculation, chunker keeps page numbers, RRF merge, auth/role guards.

## Structure
`src/{index.ts, app.ts, config.ts, db.ts, middleware/, modules/<auth|attendance|leaves|employees|documents|chat|dashboard>/, ai/, rag/, jobs/, realtime/}`,
`prisma/`, `seed/`, `scripts/eval.ts`, `tests/`. Scripts: `dev`, `build`, `start`, `seed`, `test`, `eval`,
`db:migrate`, `typecheck`.

## Definition of done (verify yourself, don't claim without running)
- `npm run typecheck` and `npm test` pass; `npm run seed` works on a fresh `hr_copilot` DB.
- `npm run dev` starts on :4000; smoke-test with curl: login as admin, `/api/dashboard`, check-in inside and
  outside geofence, upload a .md doc and see it reach READY, and `POST /api/chat` streams SSE with
  citations for "How many casual leaves do I get?" and a tool call for "Who was late this week?".
- `backend/README.md`: setup in 5 commands, architecture diagram (ASCII), RAG design (hybrid + RRF, why),
  why tools instead of text-to-SQL, security notes (tenant scoping, role checks in tools), limitations.
- Leave the dev server **stopped** when you finish.

## Rules
- Don't `git commit`. Don't modify anything outside `backend/`.
- If the contract truly can't be followed somewhere, follow it as closely as possible and list the
  deviation in your final report.
- Keep an honest log in `prompts/agent-log-backend.md`: key decisions, problems hit, anything the AI
  (you) got wrong and how it was caught/fixed. Short bullet points.
- Final report: what works (verified), what doesn't, exact commands to run, deviations from contract.

## Quality bar (added after user feedback)
"Fast" means no wasted time — it does NOT mean cutting scope. **Every feature in this brief is required**
and must work end to end. This project has to be clearly more than enough for a Full-Stack (AI-Native)
role that tests TypeScript, Node/Express, React, PostgreSQL/Prisma, Redis/queues, WebSockets and real AI
features. No placeholder screens, no TODO stubs for listed features, no fake data in the UI.
