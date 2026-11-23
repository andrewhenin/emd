# 0015: Each worktree runs the base AVD read-only

Status: Accepted (2026-11-23)
Date: 2026-11-23

## Context

Each worktree gets its own device (vision: isolate). On iOS, EMD clones a
simulator per worktree. An Android AVD folder holds GBs of disk images, and the
emulator can run one AVD several times when each instance is read-only.

## Options

### A: a copy of the AVD per worktree
Full isolation; state lasts after a stop. GBs per worktree, and a slow copy.

### B: read-only instances of one AVD
No copy, so it is fast and small. The emulator writes nothing to the AVD, and
an instance's state (installed apps) ends when it stops.

## Decision

B. Each worktree runs the base AVD with `-read-only` on its own even console
port (5554 to 5682). The port is the owned resource (decision 0006), and `gc`
stops the emulator. EMD's emulators have no window and render in software
(`-gpu swiftshader_indirect`), so they run where no GPU is.

On a 4-core CI runner, two cold boots at once did not finish in 600 s; a
second boot while the first ran took about 75 s for both.

## Consequences

- A launch after an emulator stopped installs the app again.
- Software rendering is slower than a host GPU. Revisit if UI reads time out.
