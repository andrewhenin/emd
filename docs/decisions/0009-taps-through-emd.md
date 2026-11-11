# 0009: How agents tap, type and swipe

Status: Proposed
Date: 2026-11-11

## Context

Agents tap through MobileBuildMCP, which `setup` registers next to EMD (decisions
0002, 0008). Its tap runs the AXe it bundles. Measured in experiments/tap-tools.md:

- Tool list: MobileBuildMCP (`simulator,ui-automation`) adds 36 tools, about 5.7k
  tokens, and 0.5k of server instructions. A tap, type and swipe in EMD would add
  3 tools, about 0.4k. Where an agent defers tool definitions (Claude Code does
  by default), names and instructions stay on every turn: about 1k tokens against 25.
- One tap, 10 runs each, all reached the app. MobileBuildMCP's MCP tools: 2 calls
  (`snapshot_ui`, then `tap` by ref) after one `session_set_defaults`, about 380
  tokens back, median 3.8 s. AXe by testID: 1 call, median 1.4 s. MobileBuildMCP's
  CLI: median 11.5 s. Maestro: 104 s (1 run).
- MobileBuildMCP's instructions tell agents to build with `build_run_sim`, which
  competes with EMD's `launch`.

## Options

### A: keep MobileBuildMCP registered
No tap code in EMD. Two servers in each agent. The agent carries the device id
and element refs between them. Taps get no fallback (0004) and no EMD result.

### B: EMD tools over MobileBuildMCP's CLI
One server for agents. EMD reaches the same AXe through a 44 MB package that npx
starts on every call, and through its element refs. The slowest way.

### C: EMD tools over AXe, Maestro as the fallback (0004)
One server, 3 tools, testIDs as in `check`. EMD writes and keeps the tap, type
and swipe backends, about 250 lines with tests. AXe is pinned and run in e2e.

## Decision

## Consequences

<!-- Limit: 40 lines. Once accepted, don't rewrite; supersede with a new decision. -->
