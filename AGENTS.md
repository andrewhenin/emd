# AGENTS.md

EMD builds, runs, checks and proves mobile changes for coding agents. What it is, the loop, principles and scope: [docs/vision.md](docs/vision.md). That file is the source of truth.

Notes, findings and decisions: follow [docs/logging.md](docs/logging.md) exactly. Read it before writing any .md file.

## Commands

- `npm ci` install
- `npm run lint` Biome lint and format check (`npx biome check --write .` to fix)
- `npm run typecheck` TypeScript, no emit
- `npm test` build, then run Vitest (tests call the built CLI)
- `npm run test:fast` same set the pre-push hook runs
- `npm run check:sizes` doc size limits (also runs in CI)

## Folder map

- `src/` TypeScript source. `src/cli.ts` is the `emd` entry point.
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
- Fix problems where they originate. Remove replaced code in the same change.
- Prefer tests through the real CLI and MCP tools over mocks.
- `setup` installs only what the detected stack needs. Never install unrelated software.
- Use Conventional Commit messages (`feat:`, `fix:`, `docs:`, `chore:`). Release Please reads them.
- Never touch signing, provisioning or release settings of a user's project.
- Don't weaken checks: don't delete a log tag, loosen an assertion, or skip a test or Maestro step. If it is unavoidable, list it in the PR.
- `gc` removes only resources EMD marked as its own.
- Keep docs within limits: AGENTS.md 200 lines, vision.md 120, findings.md 50 entries, each decision file 40.
- Don't write about why the project exists or where it came from. Private context stays outside this repo.

## Definition of done

1. `npm run lint`, `npm run typecheck`, `npm test` and `npm run check:sizes` pass locally.
2. Mobile behavior changes include evidence: steps, screenshots, matching log lines.
3. Notes updated in the same PR per docs/logging.md (finding, decision or rule), or the PR says nothing needed one.
4. PR opened as a draft, linked to its issue, with the PR template filled in honestly.
