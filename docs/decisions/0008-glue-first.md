# 0008: Glue first: use maintained tools before writing our own

Status: Accepted
Date: 2026-11-08

## Context

PR #106 built EMD's own tap step runner (about 1,400 lines).
[XcodeBuildMCP](https://github.com/getsentry/XcodeBuildMCP) already taps by
accessibility id or label, types, swipes, takes screenshots and captures
simulator logs. EMD closed PRs #106, #110 and #111 and rescoped issue #11.

## Options

### A: build our own tools
EMD controls each feature. EMD also writes, tests and maintains all the code.

### B: glue first
EMD writes and keeps less code. Each tool's changes and bugs become ours.

## Decision

B. Use a maintained tool when all four conditions are true:

1. It does the job today on our setup: the iOS simulator and Expo apps.
2. A real team maintains it, and its license lets us depend on it.
3. EMD calls it through a boundary, its CLI or MCP server, so a swap is cheap.
4. EMD pins its version, and e2e tests that version.

When one condition is false, EMD writes the code. EMD's own code covers only
the gaps and the glue: setup, version pins and agent instructions.

## Consequences

- EMD has less code to keep.
- Each tool's breaking changes become ours. Version pins and e2e find them.
- A feature audit decides which EMD parts move to a maintained tool.
