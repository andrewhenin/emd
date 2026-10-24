# 0004: Device actions go through backends, chosen per machine

Status: Accepted (2026-10-24)

## Context

EMD reads the simulator's screen and will tap. The tools that can do this differ
in speed and in where they run: Maestro restarts its driver on every call, and
AXe is only installable with Xcode 27 or newer. EMD supports the latest two major
Xcode versions (vision.md), so no single tool works on every supported setup.
Measurements: experiments/screen-read.md.

## Options

- A: one tool everywhere (Maestro). Works on any Xcode; slow.
- B: AXe only. Fast; unavailable below Xcode 27.
- C: a backend interface, best available backend per machine, with fallback.

## Decision

C. Every device action (read the screen, tap) goes through a backend interface in
core: an id and the actions it supports. For each action core tries the backends
in order of preference and uses the first one that can run here: AXe when Xcode is
27 or newer and `axe` is installed, otherwise Maestro. A backend that cannot run
here is skipped, and one that fails on a call is passed over for the next.

Every result names the backend that produced it (`backend`), and lists any it
skipped or passed over with the reason (`fellBack`). Adapters, the CLI and the
MCP tools never name a tool. Backends sit behind core like other behavior
(decision 0001).

## Consequences

- Replacing or adding a tool is a new backend and a place in the order; callers
  do not change.
- Backends must return the same shape, so results compare across machines.
- Only "read the screen" has two backends so far. Tap, and Maestro as the home of
  saved, replayable flows, come with the step runner.
- CI runs on each supported Xcode version (M2) so each backend and the fallback
  run for real.
