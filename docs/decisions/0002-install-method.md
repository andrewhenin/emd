# 0002: Install with EMD's own setup

Status: Accepted
Date: 2026-11-09

## Context

Installing EMD means registering two MCP servers with each agent (EMD, and MobileBuildMCP with its tap tools on), installing the skill, and checking the stack's toolchain. Until #28, users registered MobileBuildMCP by hand, and the README told the agent how to tap. Tools like EMD install in four ways (#28): their own setup that writes each agent's config, README commands, cross-agent installers (`npx add-mcp`, `npx skills add`), or agent plugins.

## Options

### A: EMD's own `setup` (REA's way)
One command, one plan, one approval. Writes each agent's config with backups, installs the skill, checks the toolchain. More code: each agent has its own config format. [REA's flow](https://github.com/morluto/rea/blob/main/docs/installation.md).

### B: An agent plugin per agent
Each agent's plugin system places the MCP servers and the skill, so EMD writes no agent config. Each agent installs plugins its own way, and the toolchain step (Xcode, AXe, Maestro) still needs a command the user approves, so the user installs twice.

## Decision

A. The user types one command and approves once, and `vision.md` already describes it. The skill can also start it: `npx skills add andrewhenin/emd`, then "set up EMD".

## Consequences

- `setup` owns config writes for Claude Code, Codex and Cursor. Each format needs a test against a temporary config.
- One place pins the EMD and MobileBuildMCP versions.
- Revisit B if users ask to install EMD as a plugin.
