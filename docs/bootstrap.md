# Bootstrap (temporary)

The setup session turns this file into GitHub milestones and issues, then deletes it in the same PR.

## Milestones

Each milestone is done when its exit test passes. Only the next one gets detailed issues; later ones stay one line until they're next.

1. **M0 Bootstrap.** Machine checked, smoke test passes, repo + CI + AGENTS.md exist, decision 0001 (architecture) chosen, M1 issues created.
2. **M1 One loop, one stack.** In a worktree on the Expo sandbox app, an agent goes change → build → run on iOS simulator → check → evidence, using EMD's MCP tools. (Proposal: Expo first because one app covers both platforms.) Includes an agent evaluation harness: scripted tasks with known answers on the sandbox app, run through Claude Code headless, recording success, tokens, tool errors and repeated calls, with and without EMD. **Gate before M2:** you use it on your own work for a week, and about 5 mobile developers who use coding agents try it, with at least 2 wanting to keep using it. If not, stop or change direction.
3. **M2 Both platforms, in parallel.** Same loop on the Android emulator; two agents at once, each with its own build folders, device and ports; `emd gc` cleans up. CI lanes on a real iOS simulator (macOS runner) and a real Android emulator (Linux runner with KVM); a claim about a platform requires its lane.
4. **M3 Installable.** `npx emd-agents setup` and `emd doctor` work for Claude Code, Codex and Cursor; native iOS and Android adapters; first public 0.1 release.
5. **M4 PR loop.** Evidence in the PR, CI triage, weakened-check detection.

## Setup prompt (paste into Claude Code in plan mode)

```
Read docs/vision.md, docs/logging.md, docs/findings.md and docs/bootstrap.md first.
vision.md is the source of truth for what EMD is.
Don't write anything about why this project exists or its origin.

1. Check my machine: Node 22+, gh (logged in), Xcode + an iOS simulator
   runtime, Android SDK command-line tools + an emulator image, Maestro.
   List what's missing with install commands. Don't install without asking.
2. Smoke test: create a throwaway Expo app in ~/emd-sandbox, run it on the
   iOS simulator and the Android emulator, and drive one tap with Maestro.
3. Set up this repo and create it on GitHub as private repo `emd`:
   TypeScript, Apache-2.0 (LICENSE + NOTICE), AGENTS.md under 200 lines that
   points to vision.md, links docs/logging.md and tells agents to follow it,
   and adds commands, folder map, rules and definition of done. Rules must
   include: optimize agent tokens per completed task first, then time, then
   CPU and memory; report only checks that actually ran; agents never mark a
   PR ready or claim a human reviewed it; fix problems where they originate
   and remove replaced code in the same change; prefer tests through the
   real CLI/MCP tools over mocks; setup never installs unrelated software;
   use Conventional Commit messages; README stub
   showing `npx emd-agents setup`; docs/decisions/0000-template.md; issue and
   PR templates (the PR template has an author-readiness checkbox only the
   human owner ticks); CI running lint + typecheck + tests on every PR, plus a check
   that fails when AGENTS.md > 200 lines, docs/vision.md > 120,
   docs/findings.md > 50 entries or any docs/decisions file > 40 lines;
   pre-commit lint; pre-push fast tests; Release Please; .gitignore entry
   for .claude/worktrees/.
4. Create GitHub milestones M0–M4 from docs/bootstrap.md (exit test as the
   description). Create detailed issues for M0 and M1 only, each small
   enough for one session, with acceptance criteria and an "out of scope"
   line. Move matching docs/findings.md entries into those issues and delete
   them from findings.
5. Write docs/decisions/0001 proposing the architecture (how the MCP server
   and CLI share one core, and how stack adapters plug in). Give me 2 options
   with tradeoffs; don't pick.
6. Delete docs/bootstrap.md in the same PR.

Show me the plan before doing anything.
```
