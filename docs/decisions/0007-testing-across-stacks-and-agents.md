# 0007: Test across stacks and agents with one suite

Status: Accepted (2026-10-30)

## Context

e2e runs one Expo app on the iOS simulator, from `~/emd-sandbox` outside the
repo. The vision adds Expo on Android, native iOS and native Android, and
`setup` for Claude Code, Codex and Cursor. Agent runs vary and cost tokens.
GitHub-hosted runners are free for public repos, 5 macOS jobs at once
([limits](https://docs.github.com/en/actions/reference/limits)). The Android
emulator runs 2-3x faster on Linux runners than on macOS
([android-emulator-runner](https://github.com/ReactiveCircus/android-emulator-runner)).

## Options

- A: an e2e suite per stack. Each copy drifts from the others.
- B: one suite, run against a small app per stack; agents tested via EMD's tools.

## Decision

B. What gives the same result every run gets a pass/fail test on every change
that can break it. Agent behavior gets a pass rate, on a schedule.

- Each stack has an app in `fixtures/<stack>/`: a tagged log on tap, an
  element with a testID, `.maestro/smoke.yaml`.
- One e2e suite runs on each stack and platform pair. A pair is supported only
  when it passes. iOS runs on macOS runners, Android on Linux.
- e2e runs nightly on main, by hand, on the `e2e` label, and on non-draft PRs
  touching the e2e workflow's paths. A PR runs only the pairs it touches.
- Adapter detection runs against `fixtures/` with no device, in `check`.
- Agents add no e2e pairs: e2e drives EMD through an MCP client. What `setup`
  writes per agent is tested against expected files. How well an agent uses
  EMD is #14's eval, run before releases.

## Consequences

- Runner image updates show up as nightly failures with no PR behind them.
- Revisit if the 5-job macOS limit slows PRs.
