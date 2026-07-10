# GoalMates

A for-fun soccer prediction app for friends. Points only — **no real money anywhere in this product**.

Core concepts:
- **Players**: sign up, join one or more groups.
- **Groups**: created by a player, joined via a **join code**.
- **Competitions**: a group runs competitions over a set of real soccer **fixtures**.
- **Bets**: each player predicts the score of each fixture. Bets **lock at kickoff** and are **hidden from the rest of the group until kickoff** — no copying your friends.
- **Scoring**: 3 points for the exact score, 1 point for the correct direction (win/draw/lose), 0 for wrong.
- **Leaderboard**: per group/competition, columns = total points, exact-hit count, correct-direction count.

## Team

Delegate to the relevant subagent in `.claude/agents/` rather than doing specialist work inline:
`product-manager`, `software-architect`, `backend-developer`, `frontend-developer`, `ux-ui-designer`, `security-engineer`, `qa-engineer`, `devops-engineer`.

For a large, multi-step, or "go build this while I'm away" request, hand it to `big-boss` instead of delegating piecemeal yourself:
1. Spawn `big-boss` with the user's request.
2. It proposes a task list (assigned across the team) and stops — relay that to the user for approval.
3. Resume `big-boss` with the approval (plus any edits). It executes task by task, delegating to specialists and following the git/branch and no-cloud-spend rules below.
4. It sends a milestone update after every finished task — relay each one to the user as it arrives, don't wait for the whole batch.

## Git workflow

- Never commit directly to `main`. All work happens on a dedicated branch (e.g. `feature/bets-api`, `fix/leaderboard-sort`), then merges into `main` via PR.
- Before starting new work, check out a new branch from `main` first.
- Agents open PRs but **never self-merge** — the coordinating session reviews the diff and merges.

## Constraints

- No cloud spend before going to prod: test the app and web locally first (`pnpm dev`, local DB, etc.). Don't provision or deploy paid cloud resources (hosting, managed DB, paid fixture-data APIs, etc.) until we're actually ready to go to production. GitHub Actions free tier is fine.

## Package manager

This project uses **pnpm** (not npm/yarn). Install deps with `pnpm install`, run scripts with `pnpm <script>` (e.g. `pnpm dev`, `pnpm build`, `pnpm lint`). `pnpm-lock.yaml` is committed; `package-lock.json`/`yarn.lock` should not exist. pnpm's content-addressable store lets multiple git worktrees/checkouts share one on-disk package cache instead of each doing a full `npm install` copy — important when running parallel worktrees for multi-agent task runs.

The repo pins the Node version in `.nvmrc` (currently 22.16.0) — `pnpm` isn't installed under the system-default Node. `nvm` is only auto-loaded in *interactive* shells via `~/.bashrc`, so non-interactive shells (including most agent/worktree Bash tool calls) start on the default Node with no `nvm`/`pnpm` on `PATH`. Before running any `pnpm` command in a fresh shell or worktree, run:
```
source "$NVM_DIR/nvm.sh" && nvm use
```
(or `. ~/.nvm/nvm.sh && nvm use` if `$NVM_DIR` isn't set) — this reads `.nvmrc` and switches to the pinned version. If a pnpm command fails oddly, check `node -v` before debugging further.

## Standing engineering rules (learned the hard way on previous projects)

1. **Agents work in isolated `git worktree`s, never in the shared checkout** (the repo root is the founder's live testing env). Verify `git rev-parse --show-toplevel` points inside `.claude/worktrees/` BEFORE any git/file operation — every agent, every time.
2. **Never `pkill -f` by pattern for cleanup** — it kills other sessions' servers. Kill only PIDs you started.
3. **PGlite is not multi-connection Postgres.** Keep the connection pool at max 1 against it (`PGLITE_POOL_MAX=1`); tests run single-fork (`maxWorkers: 1`) for the same reason. A single WASM instance corrupts under concurrent physical connections.
4. **Any `Date` compared against a DB `timestamp` (no tz) column must be built with `Date.UTC(...)`** — never local `new Date(y, m, d)`. Real Node-vs-DB-session timezone mismatch exists in this environment. Matters here for kickoff-time lock checks.
5. **Raw-SQL date arithmetic needs explicit casts** — `timestamp`-vs-`interval` type inference has bitten twice before; write `${param}::timestamp`.
6. **Mockup-first for visual work**: throwaway HTML/CSS preview → founder sign-off → real code. Catches full misses before implementation.
7. **Don't trust orchestrator/sub-agent self-reports** — verify liveness via process state and file mtimes; "still working" claims and completion notifications have both been wrong before.
8. **Swappable-integration-stub for anything needing an external account** (auth, fixture-data APIs, notifications): build a swappable interface with a local stub behind it — including the frontend — so the real implementation drops in later without touching call sites. No account signups until the founder approves.
