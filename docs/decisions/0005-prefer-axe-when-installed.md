# 0005: Prefer AXe whenever it is installed

Status: Accepted (2026-10-25)

## Context

Decision 0004 chose AXe only when Xcode is 27 or newer and `axe` is installed.
The Xcode 27 rule came from Homebrew refusing to install AXe on older toolchains
while macOS 27 was current, not from AXe: its README lists Xcode 26 as supported.
A machine that has AXe installed has already got past that. Maestro read the
screen in 31.8 s against 0.8 s for AXe (experiments/screen-read.md).

## Options

- A: keep the Xcode 27 rule. Xcode 26 machines with AXe still use slow Maestro.
- B: use AXe whenever it is installed. If it fails on a call, 0004's fallback
  passes to Maestro and the result says why.

## Decision

B. The order of preference stays AXe, then Maestro. A backend can run here when
its tool is installed; nothing else is checked. Everything else in 0004 stands:
the backend interface, fallback on failure, `backend` and `fellBack` in results.

## Consequences

- EMD no longer reads the Xcode version; `xcodebuild -version` is not called.
- Xcode 26 with AXe is not tested end to end here (Xcode 26.6 was removed). A
  failure there shows up as `fellBack` with the reason, and Maestro answers.
- CI on each supported Xcode version (M2) is what proves it.
