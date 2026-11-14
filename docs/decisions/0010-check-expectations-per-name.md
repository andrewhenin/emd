# 0010: A check's first expectations are its bar

Status: Accepted
Date: 2026-11-13

## Context

- An agent could call `check` again with fewer or looser expectations and pass. The retry count (decision 0006) stops endless retries, not this.
- In ImpossibleBench, Claude models cheat mostly by changing the tests. Tests the agent cannot edit stopped it and kept real success ([arXiv 2510.20270](https://arxiv.org/abs/2510.20270)).
- One task often checks several moments (before and after a tap), each with its own expectations.

## Options

### A: Flag only
Record each change in the evidence. The weakened check still passes, and a reviewer must notice.

### B: Lock per name, list what never passed
A later check under a name must keep the name's first expectations. A new name starts fresh, so the evidence lists each name whose last verdict is not passed.

### C: Lock per worktree
One set of expectations for the whole task. It breaks checks of different moments.

## Decision

B. Refusing a weakened check is ImpossibleBench's read-only test. The `notPassed` list covers the way around it: a new name.

- Kept with the failed-check count in `~/.emd/checks/<key>.json`, outside the worktree. `emd check reset` and `gc` clear both.
- Exact match: tag and message, id and text. A later check can add expectations; added ones are not kept.
- This replaces "`name` only labels evidence" in decision 0006. All names still share one count.

## Consequences

- A typo in a first expectation needs a new name or a person's reset. The old name then shows in `notPassed`.
- A weak first check stays weak. Who writes the expectations is still open.
- An agent with a raw shell can still edit the file (as 0006 says of the count).
