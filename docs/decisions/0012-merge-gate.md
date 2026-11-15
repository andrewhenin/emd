# 0012: A machine gate decides which PRs may merge without a person

Status: Accepted
Date: 2026-11-15

## Context

Agents open most PRs, and the ruleset needs 0 approvals, so each merge waits on a person applying the same rules. Teams that let PRs merge without review route them by risk, run the classifier silently first, and set kill switches ([Vercel](https://vercel.com/blog/58-percent-of-prs-in-our-largest-monorepo-merge-without-human-review)). A job skipped by a conditional reports "Success", even as a required check ([GitHub](https://docs.github.com/en/pull-requests/how-tos/merge-and-close-pull-requests/troubleshooting-required-status-checks)), and `e2e` skips on label events.

## Options

### A: A person merges every PR
Safe, but merges wait on one person's time.

### B: A rule engine app (Mergify)
Rich conditions, but a third-party app with write access, for one repo (decision 0008).

### C: Our own status plus native auto-merge
A script checks the rules and posts the `merge-gate` status; GitHub auto-merge does the merge.

## Decision

C. `scripts/merge-gate.ts` runs from the default branch (`pull_request_target`, `workflow_run`), never the PR's code. It passes a PR only when `check`, `pr-title` and, for e2e paths, an e2e run that ran all passed on the head commit; `mentor:ready` was added after the last push; "Needs you" and "Weakened checks" say none; it is not a draft or release PR; it touches no governance file; and it changes 400 lines or fewer. Anything else waits for a person. Errors fail closed.

## Consequences

- Phase 1 is shadow: the status is not required. After about 10 PRs whose verdicts match the manual merges, a person makes it required and turns on auto-merge.
- Kill switch: an auto-merged PR is reverted, or a nightly fails on its code. Then merges go back to manual until the gate is fixed.
- Releases stay manual (decision 0011).
- A change to the gate itself needs a person.
