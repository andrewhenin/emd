# AGENTS.md

EMD builds, runs, checks and proves mobile changes for coding agents. What it is, the loop, principles and scope: [docs/vision.md](docs/vision.md). That file is the source of truth.

Notes, findings and decisions: follow [docs/logging.md](docs/logging.md) exactly. Read it before writing any .md file.

## Commands

- `npm ci` install
- `npm run lint` Biome lint and format check, import boundaries, unused code (knip), duplicates (jscpd) (`npx biome check --write .` to fix formatting)
- `npm run check:imports` import boundaries only (decision 0001; also part of lint)
- `npm run typecheck` TypeScript, no emit
- `npm test` build, then run Vitest (tests call the built CLI)
- `npm run test:fast` same set the pre-push hook runs
- `npm run test:e2e` real launch on an iOS simulator against `~/emd-sandbox` (macOS, Xcode; minutes; never runs in CI)
- `npm run check:sizes` doc size limits (also runs in CI)
- `npm run check:pr-title` reads a PR title on stdin and checks it is a Conventional Commit (CI runs it on every PR)

## Folder map

- `src/core/` all behavior. Public entry: `src/core/index.ts`. `registry.ts` is the only file that loads adapters.
- `src/bin.ts` the `emd` entry point. Dispatches `emd mcp` to the MCP server (loaded on demand) and everything else to the CLI. Nothing imports it.
- `src/cli/` the CLI commands. Formats core results only.
- `src/mcp/` the MCP server behind `emd mcp` (MCP SDK v2, `serveStdio`). Formats core results only.
- `src/core/device/` device actions behind one backend interface (AXe, Maestro). Core picks the best available backend per machine, falls back, and results name the backend used (decision 0004). Callers never name a tool.
- `src/adapters/<stack>/` one folder per stack, loaded lazily by core.
- `test/` Vitest tests.
- `scripts/` repo tooling (not shipped).
- `docs/vision.md` what EMD is. `docs/logging.md` how we log. `docs/findings.md` observations.
- `docs/decisions/` one file per decision, from `0000-template.md`.
- `experiments/` measurements with their reproduction scripts.
- `.github/` CI, Release Please, issue and PR templates.

## Rules

- Optimize agent tokens per completed task first, then time, then CPU and memory.
- Report only checks that actually ran. Say which ones did not.
- Never mark a PR ready for review. Never claim a human reviewed anything.
- Never tick the author-readiness checkbox in the PR template. Only the human owner does.
- Never push to `main` and never force-push. Always work on a branch and open a draft PR.
- To update a PR branch, merge main into it. Never force-push.
- If scope changes during a PR, update the linked issue's acceptance criteria in the same PR.
- Write the smallest change that meets the acceptance criteria; no code for out-of-scope items; add abstractions only when they remove complexity you've actually seen.
- Fix problems where they originate. Remove replaced code in the same change.
- Prefer tests through the real CLI and MCP tools over mocks.
- Run `npm run test:e2e` only when the change alters a call to the simulator or build tools (command, arguments, timeout, or how its output is read) or launch and job handling, and at most once per PR on a laptop. If skipped, say why in the PR. If it fails in code the PR didn't change, report it; don't rerun.
- Put behavior in `src/core/`. CLI and MCP import core only through `core/index.ts`, never each other. Adapters never import each other and load only through `core/registry.ts`.
- `setup` installs only what the detected stack needs. Never install unrelated software.
- Use Conventional Commit messages and PR titles (`feat:`, `fix:`, `docs:`, `chore:`). Squash merges use the PR title and Release Please reads it; CI checks the title.
- Link an issue for feat and fix PRs; optional for ci, chore and docs.
- Never touch signing, provisioning or release settings of a user's project.
- Don't weaken checks: don't delete a log tag, loosen an assertion, or skip a test or Maestro step. If it is unavoidable, list it in the PR.
- `gc` removes only resources EMD marked as its own.
- Keep docs within limits: AGENTS.md 200 lines, vision.md 120, findings.md 50 entries, each decision file 40.
- Don't write about why the project exists or where it came from. Private context stays outside this repo.

## Review criteria

Flag code that can be deleted or simplified while still meeting the linked issue's acceptance criteria, and any file not named in the plan.

## Definition of done

1. `npm run lint`, `npm run typecheck`, `npm test` and `npm run check:sizes` pass locally.
2. Mobile behavior changes include evidence: steps, screenshots, matching log lines.
3. Notes updated in the same PR per docs/logging.md (finding, decision or rule), or the PR says nothing needed one.
4. PR opened as a draft, linked to its issue, with the PR template filled in honestly.
