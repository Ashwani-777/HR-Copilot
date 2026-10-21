# HR Copilot — Backend

Multi-tenant HR API for SMEs (employees, GPS attendance, leave) with an **AI copilot** that answers
HR-policy questions from uploaded documents (**hybrid RAG with citations**) and data questions through
**typed tool calls** — never generated SQL.

Node 20 · TypeScript (strict) · Express 5 · Zod · Prisma + PostgreSQL + pgvector · Redis + BullMQ ·
Socket.IO · Vitest. The API contract the frontend builds against is [`../docs/API_CONTRACT.md`](../docs/API_CONTRACT.md).

## Setup (5 commands)

Needs Node 20, PostgreSQL 16+ with [pgvector](https://github.com/pgvector/pgvector) (`brew install pgvector`),
and Redis running locally.

```bash
npm install
sed "s/YOUR_USER/$USER/" .env.example > .env          # then set JWT_SECRET to a long random string
createdb hr_copilot && createdb hr_copilot_test
npm run db:migrate && npm run seed
npm run dev                                           # http://localhost:4100
```

Demo logins (test values): `admin@acme.test` / `Admin@123`, `riya@acme.test` / `Employee@123`,
`admin@globex.test` / `Admin@123` (second tenant). Every other seeded employee is `<firstname>@acme.test` / `Employee@123`.

| Script | What it does |
|---|---|
| `npm run dev` | API + Socket.IO + ingestion worker, auto-reload (tsx) |
| `npm run build` / `npm start` | Compile to `dist/` / run the compiled server |
| `npm run db:migrate` | `prisma migrate deploy` (creates pgvector extension, tables, GIN + HNSW indexes) |
| `npm run seed` | Resets **only** `hr_copilot*` databases: 2 companies, 30 working days of attendance, leaves, policies ingested |
| `npm test` | 98 tests (unit + integration) against `hr_copilot_test`, re-seeded per run |
| `npm run eval` | Retrieval hit-rate@3 / MRR for full-text vs vector vs hybrid on 17 policy questions |
| `npm run typecheck` | `tsc --noEmit` over src, tests, seed and scripts |

The AI runs fully offline by default (`LLM_PROVIDER=mock`, `EMBEDDING_PROVIDER=mock`). To use real models:

```bash
LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=… ANTHROPIC_MODEL=claude-haiku-5-5          # Claude
LLM_PROVIDER=openai OPENAI_API_KEY=… OPENAI_MODEL=…                               # OpenAI
LLM_PROVIDER=openai OPENAI_BASE_URL=http://localhost:11434/v1 OPENAI_MODEL=llama3.1  # Ollama / Groq / any compatible API
EMBEDDING_PROVIDER=openai OPENAI_EMBEDDING_MODEL=text-embedding-3-small             # then `npm run seed` (re-embed)
```

## Architecture

```
                        ┌─────────────────────────── Node process (src/index.ts) ───────────────────────────┐
 React SPA (5173)       │                                                                                    │
  fetch /api/* ────────►│ Express 5: helmet · cors · pino-http · JWT auth · role guards · Zod · error mapper  │
  SSE  POST /api/chat ◄─┤   ├─ auth · dashboard · attendance · leaves · employees · documents                │
  socket.io ◄──────────►│   └─ chat ──► agent loop (≤4 tool rounds) ──► ChatProvider (mock│openai│anthropic) │
                        │                    │                                                               │
                        │                    ▼ typed tools (Zod-validated, companyId + role scoped)          │
                        │      searchPolicy · getAttendanceSummary · getLateArrivals · getLeaveBalance ·     │
                        │      getWhoIsOnLeave                                                               │
                        │                    │                                                               │
                        │   POST /documents ─┼─► uploads/ + Document(QUEUED) ─► BullMQ "document-ingestion"  │
                        │                    │                                        │                      │
                        │   BullMQ Worker ◄──┼────────────────────────────────────────┘                      │
                        │   extract per page → chunk 800/150 → embed (batch 64) → INSERT Chunk ──┐           │
                        │                    │                     emit document:status ─────────┼─► socket.io
                        └────────────────────┼──────────────────────────────────────────────────┼───────────┘
                                             ▼                                                  ▼
                 PostgreSQL + pgvector: Company, User, Employee,          Redis (db 5, prefix "hrc"): BullMQ jobs
                 Attendance, LeaveRequest, Document, Chunk(vector(1536),  + Socket.IO Redis adapter (pub/sub) so
                 tsvector GENERATED, GIN + HNSW indexes)                  any instance's worker reaches every client
```

```
src/
  index.ts            http server, Socket.IO, worker, graceful shutdown
  app.ts              express app factory (used by tests via supertest)
  config.ts           Zod-validated env (fails fast with a readable message)
  middleware/         auth (JWT, requireRole, requireEmployee), error → contract error shape
  modules/<auth|attendance|leaves|employees|documents|chat|dashboard>/   routes + services
  ai/                 provider interfaces, mock / OpenAI-compatible / Anthropic chat, embeddings
  rag/                extract (pdf-parse per page), chunker, ingest pipeline, hybrid search, RRF
  jobs/               BullMQ queue + worker
  realtime/           Socket.IO (JWT handshake, company rooms, Redis adapter)
prisma/               schema + hand-edited init migration (extension, generated tsvector, indexes)
seed/                 seed script + policies/*.md
scripts/eval.ts       retrieval eval
tests/                unit + integration (Vitest + supertest + socket.io-client)
```

## RAG design

**Ingestion** (`rag/ingest.ts`, run by the BullMQ worker; the seed calls it synchronously):
upload → file saved under a server-chosen name → `202 QUEUED` → job → **extract text per page**
(pdf-parse `pagerender`; `.md`/`.txt` are split into ~3,000-char pseudo-pages at paragraph boundaries)
→ **chunk each page separately** (~800 chars, ~150 overlap, breaking at paragraph → sentence → word; overlaps start at a sentence boundary when possible),
so every chunk has an exact page number for citations → **embed in batches** → one transaction replaces
the document's chunks (idempotent re-runs). `document:status` is emitted after every step
(QUEUED → PROCESSING 5/25/35…90 → READY 100, or FAILED + error).

**Retrieval** (`rag/search.ts`) — hybrid, always `WHERE companyId = $1`:

1. **Full-text**: `websearch_to_tsquery('english', …)` against a `GENERATED` `tsvector` column (GIN index),
   ranked by `ts_rank`. Question words are OR-ed (`casual or leaves or get`), because AND semantics make
   natural-language questions match nothing; ranking still prefers chunks matching more terms.
2. **Vector**: pgvector cosine distance `<=>` on `vector(1536)` (HNSW index), with
   `hnsw.iterative_scan = relaxed_order` so the tenant filter can't starve the ANN result; hits below a
   provider-specific similarity floor are dropped, and only chunks embedded by the *current* model are compared.
3. **Reciprocal Rank Fusion**: `score = Σ 1/(60 + rank)` over both lists, top 5.

**Why hybrid + RRF?** HR questions mix exact tokens (“EL”, “₹500”, “POSH”, “09:30”) that embeddings blur,
with paraphrases (“doctor’s note” ↔ “medical certificate”, “mileage” ↔ “per kilometre”) that keyword search
misses. RRF fuses the two by **rank**, so there's no need to calibrate `ts_rank` against cosine similarity
or tune weights, and a chunk both retrievers like rises to the top.

**Citations**: each `searchPolicy` result gets a global number per chat turn (deduplicated by chunk); the
model is told to cite `[n]`; the `citations` SSE event contains only the numbers that actually appear in the answer.

**Eval** (`npm run eval`, 17 questions, mock embeddings):

| | full-text | vector (mock) | hybrid |
|---|---|---|---|
| hit-rate@3 | 100% | 94% | 100% |
| MRR@5 | 0.93 | 0.84 | 0.97 |

The mock embedder is a hashed bag-of-words (lexical), so it misses paraphrase questions ("mileage … car" vs "per
kilometre … vehicle"); fusion still lifts hybrid's MRR above either retriever alone. With `EMBEDDING_PROVIDER=openai` the vector side handles paraphrases, and that's where RRF earns
its keep. The corpus is small (11 chunks), so treat these numbers as a regression check, not a benchmark.

## The copilot: tools, not text-to-SQL

`POST /api/chat` streams SSE exactly as in the contract: `tool`* → `token`+ → `citations` → `done` (or `error`).

The agent loop (`modules/chat/agent.ts`) gives the model five **typed functions**. Each one has a Zod schema that is
exported as JSON Schema for the model and **re-validated on every call** (model output is untrusted). Invalid
arguments go back to the model as an error result instead of crashing. The loop runs at most **4 tool rounds**; the
5th call uses `tool_choice: "none"` to force an answer while keeping the tool definitions, so the history stays valid.
Text a model writes *before* deciding to call a tool (“Let me check…”) is held back, so `tool` events always
precede `token` events.

Why tools instead of letting the model write SQL:

- **Security is enforced in code, not in a prompt.** Every tool query is built with Prisma and filtered by the
  JWT's `companyId`; EMPLOYEE callers are forced to their own `employeeId` inside the tool. A prompt-injected or
  jailbroken model can't reach another tenant's rows because there is no query surface to reach them with.
- **Correctness**: business rules (working days, timezone-aware lateness, approved-leave overlap, balances) live
  in one tested place instead of being re-derived by the model on every question.
- **Reliability and cost**: small JSON results, predictable latency, no schema dump in every prompt, no
  destructive statements to sandbox.
- The trade-off is coverage: questions outside the five tools get “I don't know”. Adding a tool is a small, reviewable change.

Providers implement one interface (`ai/types.ts`): **mock** (deterministic keyword router plus templated answers that
quote the best-matching policy sentences with `[n]`, streamed word by word; no keys needed and used by the tests),
**openai** (any OpenAI-compatible endpoint), and **anthropic** (Claude via `@anthropic-ai/sdk`: streaming, eager
tool-input streaming, assistant content replayed verbatim so thinking blocks round-trip, refusal and max-token stops
handled). Both real providers are tested offline against their official SDKs with a stubbed `fetch` that replays
SSE streams.

## Security notes

- **Tenant scoping**: `companyId` comes only from the verified JWT and is part of every `where` clause, raw SQL
  included. Cross-tenant ids return **404**, not 403, so they don't leak existence. Socket.IO clients only join
  `company:<their id>`. All of this is covered by `tests/integration/isolation.test.ts` (REST, CSV, retrieval,
  chat tools, chat endpoint, sockets).
- **Role checks** in route middleware (`requireRole('ADMIN')`, `requireEmployee`) *and* inside the copilot
  tools (EMPLOYEE gets self-only data, even when asking about a colleague).
- **Auth**: bcrypt hashes; HS256 JWT (7-day expiry) with algorithm pinned and claims validated by Zod; constant-cost
  login for unknown emails; login rate limit (20/min/IP).
- **Input**: Zod on every body/query; uploads limited to .pdf/.txt/.md and 10 MB and stored under a server-generated
  UUID name (no user-controlled paths); CSV export neutralises spreadsheet formulas.
- **Prompt injection**: document text reaches the model only as tool-result data, the system prompt says to treat it
  as data, and the tools can't do anything the user couldn't already do.
- helmet headers, CORS allow-list, `x-powered-by` off, secrets redacted from logs; DB/Redis isolation
  (own databases, Redis DB 5 + `hrc` prefix).

## Limitations / next steps

- The ingestion worker runs inside the API process (simple to run; a separate worker deployment is a one-file change).
  BullMQ jobs use one attempt and failures surface as `FAILED`; there's no retry UI.
- Mock embeddings are lexical; real semantic retrieval needs `EMBEDDING_PROVIDER=openai` (1536-dim). Switching
  providers requires re-ingesting (vector search ignores chunks from another model).
- Leave days exclude weekends but not public holidays. Balances are per calendar year with no carry-forward or
  accrual logic, and allowances are global constants (12/8/15), not per company.
- Check-out isn't geofenced, and re-checking-out overwrites the time. No attendance correction workflow.
- No refresh tokens or token revocation (stateless 7-day JWT); no password reset.
- Chat history is client-held (last 10 messages); conversations are not persisted server-side.
- Scanned PDFs (no text layer) fail with a clear error; there's no OCR.
- `prisma migrate dev` would try to drop the hand-written vector/FTS indexes it can't model, so use `migrate deploy`
  and write raw SQL migrations for retrieval changes.
