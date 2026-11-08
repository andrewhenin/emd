# 0008: Steps are Maestro commands; an action falls back only if it did not act

Status: Accepted (2026-11-08)

## Context

Issue #11: an agent runs steps on the app, and each step gets a screenshot and
the tagged log lines that appeared during it. Decision 0004 passes to the next
backend on any failure. A screen read is safe to repeat. A tap is not: if AXe
taps and then fails, Maestro taps again, and the proof shows one tap that was two.

## Options

- A: fall back on any failure (0004). Hides a double action.
- B: never fall back from an installed backend. One AXe hiccup fails the step.
- C: fall back only when the tool proves it did not act.

## Decision

C, for every action that changes the app. Screen reads keep 0004.
- Fall back when the backend is not installed, or when its error proves it did
  not act. AXe's proof: `Warning: No accessibility element matched … No tap
  performed.` on stderr (Sources/AXe/Commands/Tap.swift, v1.5.0 to v1.8.0).
- On a timeout or any other error the step fails. The result names the backend
  and the error.

Steps:
- A step is the JSON form of a Maestro command, saved as a replayable
  `flow.yaml`. A new action adds a Maestro command, never new syntax.
- An action ships only when e2e proves it on a real simulator (now: `tapOn`).
- A step's lines are the tagged lines from its start to the next step's start.
- The first failed step ends the run.
- Per step: a screenshot file name, the 5 newest lines, the total. All lines
  are in `steps.json`.

## Consequences

- A target AXe cannot find costs AXe's 10 s wait, then Maestro's.
- A new backend falls back on an action only after it names its proof.
- The 1 s waits are guesses; e2e logs the delay to each step's first line.
