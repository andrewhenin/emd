# 0014: A build stops on a hang, not on slow progress

Status: Accepted (2026-11-23)
Date: 2026-11-23

## Context

Timeouts end hangs; they don't measure speed (#65). A 900 s total limit
stopped a cold Expo build on an 8 GB M2 while it still compiled (#178). The
same build finished in 506 s at `--timeout 1800`; the cold build took about
24 minutes. Real native iOS apps take 15 to 20 minutes to build clean. The
timeout result listed the last `› Compiling` lines as errors.

## Options

### A: a higher total limit
One number. Any total either stops slow machines or waits long on a hang.

### B: stop when the build log stops growing, with a high total limit
A hang ends in minutes. A slow build that still prints goes on. A step that
prints nothing for the whole idle limit counts as a hang.

## Decision

B. The build stops when `build.log` has not grown for 600 s, or after
3600 s in total. `timeoutSeconds` (`--timeout` in the CLI) still sets the
total; the idle limit is never longer than it. On a stop for time, the result
gives `lastLines`, not `errors`, unless a line looks like an error.

## Consequences

- A slow machine no longer needs `--timeout` for a cold build.
- A hang costs up to 10 minutes before it fails.
- Revisit if a real build step prints nothing for 600 s.
