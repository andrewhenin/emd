# 0009: How agents tap, type and swipe

Status: Accepted (2026-11-11)
Date: 2026-11-11

## Context

Agents tap through MobileBuildMCP, which `setup` registers next to EMD (decisions
0002, 0008). Its tap runs the AXe it bundles. Its instructions tell agents to
build with `build_run_sim`, which competes with EMD's `launch`. Per tap, from
experiments/tap-tools.md: MobileBuildMCP's tools take 2 calls, ~380 tokens back,
3.8 s; AXe by testID takes 1 call, 1.4 s. Its 36 tools are ~5.7k tokens of
definitions; EMD's 3 would be ~0.4k.

## Options

### A: keep MobileBuildMCP registered
No tap code in EMD. Two servers in each agent. The agent carries the device id
and element refs between them. Taps get no fallback and no EMD result.

### B: EMD tools over MobileBuildMCP's CLI
One server for agents. EMD reaches the same AXe through a 44 MB package that npx
starts on every call (11.5 s a tap), and through its element refs.

### C: EMD tools over AXe and Maestro
One server, 3 tools, testIDs as in `check`, backends in the order of decisions
0004 and 0005. EMD writes and keeps the tap, type and swipe backends, about 250
lines with tests. AXe is pinned and run in e2e already.

## Decision

C. One tap is 1 call and 1.4 s, and agents need one server. The tools name no
platform, so Android backends can join for Linux and Windows hosts.

## Consequences

- `setup` stops registering MobileBuildMCP. On macOS it installs AXe.
- EMD keeps the backends. AXe's pin and e2e show its breaking changes (0008).
- A gesture EMD lacks (long press, drag) is added to EMD, not to a second server.
