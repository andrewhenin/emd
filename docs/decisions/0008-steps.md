# 0008: Steps are Maestro commands; an action falls back only if it did not act

Status: Accepted (2026-11-08)

## Context

Issue #11: each step gets a screenshot and its tagged lines. 0004 falls back
on any failure: a read is safe to repeat, a tap is not (AXe taps, fails, and
Maestro taps again). In e2e the app reacted ~3 s after AXe's tap, past a 1 s wait.

## Options

- A: fall back on any failure (0004). B: never fall back from an installed
  backend. C: fall back only when the tool proves it did not act.

## Decision

C, for every action that changes the app. Screen reads keep 0004.
- Fall back when the backend is not installed, or when its error proves it did
  not act. AXe's proof: `Warning: No accessibility element matched … No tap
  performed.` on stderr (Sources/AXe/Commands/Tap.swift, v1.5.0 to v1.8.0).
- On a timeout or any other error the step fails, naming backend and error.

Steps:
- A step is the JSON form of a Maestro command, saved as a replayable
  `flow.yaml`. A new action adds a Maestro command, never new syntax.
- An action ships only when e2e proves it on a real simulator (now: `tapOn`).
- EMD waits for the app, not the clock, with AXe reads: before an action until
  two reads match with the target on screen; after it until the screen differs
  and then holds for two reads (10 s cap each). The step says changed,
  unchanged, unstable or unread; the screenshot follows the wait.
- A step's lines run from its action to the next step's action; the last
  step's to its settle plus 2 s for log delivery (0.7 s measured).
- The first failed step ends the run. Per step: screenshot file, 5 newest
  lines, total. All lines are in `steps.json`.

## Consequences

- A new backend falls back on an action only after it names its proof.
- The waits rest on one e2e run; e2e prints the delays to retune them.
