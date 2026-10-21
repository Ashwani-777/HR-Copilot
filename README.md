# HR Copilot

**An HR system for small businesses with an AI copilot that answers from your own policies and data — with sources.**

Employees check in with GPS, request leave, and ask questions like *"How many casual leaves do I get?"*
(answered from the uploaded HR policy, with page citations) or *"Who was late this week?"* (answered by
typed tool calls over the database — the model never writes SQL).

## Features

| Area | What it does |
|---|---|
| **AI Copilot** | Streaming chat (SSE) · hybrid RAG with `[n]` citations to document + page · tool calling for attendance/leave data · says "I don't know" instead of guessing · role-aware tools (employees only ever see their own data) |
| **RAG pipeline** | Upload PDF/MD/TXT → **BullMQ** job → per-page extraction → chunking → embeddings → **pgvector** · live progress over **Socket.IO** (fanned out via Redis, works with multiple server instances) |
| **Retrieval** | **Hybrid search**: Postgres full-text (GIN) + vector (HNSW) merged with Reciprocal Rank Fusion · `npm run eval` measures hit-rate@3 for each method |
| **Attendance** | GPS check-in with a server-side geofence (haversine) · late detection in company timezone · CSV export |
| **Leave** | Requests, approve/reject, balances with overlap and balance checks |
| **Multi-tenant** | Every query scoped by company · tests prove one company can't reach another's data via API, CSV, search, chat tools or sockets |
| **UI** | React + Tailwind, Apple-style monochrome design, responsive down to phone width, loading/empty/error states everywhere |

## Architecture

```
 React (Vite, TS) ──/api (REST + SSE)──► Express (TS) ──Prisma──► PostgreSQL + pgvector
        │                                   │    │                    ▲
        └──── Socket.IO (document:status) ──┘    │                    │ chunks + embeddings
                                                 ▼                    │
                                        Redis ── BullMQ ingestion worker
                                                 │
                                   LLM provider: mock | OpenAI-compatible | Anthropic
```

## Tech stack
TypeScript everywhere · **Backend:** Node 20, Express, Zod, Prisma, PostgreSQL + pgvector, Redis, BullMQ,
Socket.IO, JWT, pino, Vitest + Supertest · **Frontend:** React 18, Vite, Tailwind, TanStack Query,
React Router, socket.io-client, Vitest.

## Run it locally (no Docker needed)

Needs Node 20, PostgreSQL with the `pgvector` extension, and Redis.

```bash
# Backend  →  http://localhost:4100
cd backend
npm install
sed "s/YOUR_USER/$USER/" .env.example > .env
createdb hr_copilot && createdb hr_copilot_test
npm run db:migrate && npm run seed
npm run dev

# Frontend →  http://localhost:5173   (new terminal)
cd frontend
npm install
npm run dev
```

Works **without any API key**: the default `mock` provider gives deterministic embeddings and answers.
For a real LLM set `LLM_PROVIDER=openai` (any OpenAI-compatible API, incl. Groq/Ollama) or
`LLM_PROVIDER=anthropic` in `backend/.env`.

### Demo accounts (seed data, test only)
| Role | Email | Password |
|---|---|---|
| Admin (Acme Staffing) | `admin@acme.test` | `Admin@123` |
| Employee (Acme Staffing) | `riya@acme.test` | `Employee@123` |
| Admin (Globex — 2nd tenant) | `admin@globex.test` | `Admin@123` |

On the dashboard use **"Use office location (demo)"** to check in if you're not at the seeded office.

## Quality
- Backend: `npm run typecheck` · `npm test` → **98 tests** (tenant isolation, geofence, late calc, chunker
  page numbers, RRF, role guards, tool-round limit) · `npm run eval` → hit-rate@3: full-text 100%, vector 94%,
  hybrid 100% on 17 policy questions.
- Frontend: `npm run build` · `npm test` → **21 tests** (SSE parser incl. chunks split at every byte, markdown).

## How this was built (AI-native workflow)
Built with Claude Code: a shared API contract (`docs/API_CONTRACT.md`) was written first, then a backend
agent and a frontend agent built in parallel against it, and the orchestrator integrated and verified.
Every prompt and an honest log of what the AI got wrong is in [`prompts/`](prompts/):
`00-orchestrator.md`, `01-backend-agent.md`, `02-frontend-agent.md`, `03-integration.md`, `agent-log-*.md`.

## Known limitations / next steps
- GPS is client-reported (spoofable) — production would add device attestation or Wi-Fi/IP checks.
- Mock embeddings are bag-of-words; real semantic recall needs a real embedding model.
- Deploy to a Linux VPS behind nginx (configs included: `frontend/nginx.conf`, Dockerfiles, `docker-compose.yml`).
- React Native check-in app.
