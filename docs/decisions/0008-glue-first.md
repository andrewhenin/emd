# 0008: Glue first: use maintained tools before writing our own

Status: Accepted
Date: 2026-11-08

## Context

[XcodeBuildMCP](https://github.com/getsentry/XcodeBuildMCP) (MIT, Sentry)
already taps by accessibility id or label, types, swipes, takes screenshots
and captures simulator logs: the device actions EMD began to build in #106.

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

No tool meets condition 4 yet. #11 adds the first e2e test, for XcodeBuildMCP.

## Consequences

- EMD has less code to keep.
- Each tool's breaking changes become ours. Version pins and e2e find them.
