# 0001: Architecture

Status: Accepted (2026-10-24)

## Context

EMD ships an MCP server and a CLI (`emd`) that must behave the same, plus stack
adapters (Expo/React Native, native iOS, native Android). See docs/vision.md.
Tool results stay small. Builds and device runs are queued across parallel agents.

## Options

### A: One package, layered

- `src/core/`: detect, isolate, run, check, evidence, queue, ownership registry.
  Plain async functions that return structured results.
- `src/mcp/` and `src/cli/`: thin adapters that call core and format output.
- Stack adapters: in-tree modules implementing one `StackAdapter` interface
  (`detect`, `build`, `launch`, `logs`, `ui`), listed in a static registry.
- Pros: least overhead, one npm package, cheap refactors, small surface for
  agents to navigate while the design is still moving.
- Cons: third-party stacks need a PR here. Every install carries every adapter.

### B: Monorepo with adapter packages

- `@emd/core`, `@emd/mcp`, `@emd/cli`, and `@emd/adapter-expo|ios|android`.
  `emd-agents` is a meta package that discovers adapters from config.
- Pros: hard boundaries, external adapters possible, per-adapter dependencies.
- Cons: workspaces and multi-package Release Please from day one, versioned
  interfaces between packages, slower early iteration.

## Decision

A. Core owns behavior; MCP and CLI only format. Adapters load lazily and
import boundaries are lint-enforced. Revisit (split to B) when an outside
party wants to ship an adapter or an adapter needs a heavy dependency.

## Consequences

Long-running work goes through the core queue.
