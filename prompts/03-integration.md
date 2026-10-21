# Integration log (orchestrator)

- **Port clash found while agents were running:** port 4000 was already used by another local project
  (Scroll-up mobile backend). The frontend preview's `/api` proxy was hitting that app. Fix: moved HR Copilot
  backend to **4100** (contract updated; both agents messaged). Did not stop the other project's server.
- Seed wasn't written yet when the user first tried to log in → asked the backend agent to prioritise
  seed + auth; ran a separate preview backend on **4101** (same DB) so the user's preview didn't collide
  with the agent's own test server on 4100.
- The frontend agent's cleanup stopped the user's preview Vite on 5174 (despite being told not to);
  restarted it with `VITE_BACKEND_URL=http://localhost:4101`. Lesson: tell agents to kill only PIDs they started.
- Backend agent reported compose/nginx pointing at `backend:4000`; checked — nginx already used 4100, only a
  stale comment in `docker-compose.yml` → fixed.
- Independent verification by the orchestrator (not trusting agent reports): backend `typecheck` clean,
  `npm test` 98/98; frontend `npm run build` clean, `npm test` 21/21.
- End-to-end in a real browser against the real backend: demo admin login → Copilot
  "How many casual leaves do I get?" → streamed answer with "Searching HR policies" step and
  `[1] Acme HR Policy · p.1` citation pills. ✅
- Small UX finding: the demo chip fills the form but focus stays on the chip, so pressing Enter re-fills
  instead of submitting — user must click "Sign in". (Not fixed yet.)
- Wrote the root README.
