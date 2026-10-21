# Prompt log — orchestration

## 1. My request to the AI (Claude Code)
> create a folder named HR Copilot and create two folders inside it, frontend and backend, and run
> multiple agents to build both side by side. Make sure you are keeping the correct prompts. Theme should
> be like Apple, white and black, classy, good font and text size. Open the folder in VS Code.
> (follow-up) No Docker — ship as fast as possible.

## 2. Plan the AI proposed
- Write a shared **API contract** first (`docs/API_CONTRACT.md`) so two agents can build in parallel
  without talking to each other.
- Run 2 agents in parallel: **backend** (`01-backend-agent.md`) and **frontend** (`02-frontend-agent.md`).
- Each agent keeps an honest log (`agent-log-backend.md`, `agent-log-frontend.md`).
- Then integrate: run both, smoke-test end to end, fix mismatches (logged in `03-integration.md`).

## 3. Exact instruction given to each agent
> Read `~/Documents/HR Copilot/prompts/0X-<role>-agent.md` and follow it exactly. It is your full brief.
> The API contract is in `~/Documents/HR Copilot/docs/API_CONTRACT.md`.
> (follow-up) "Fast doesn't mean basic — make sure it is more than enough for that job." → appended a "Quality bar" section to both agent prompts.
