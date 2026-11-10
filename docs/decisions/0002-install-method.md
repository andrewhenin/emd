# 0002: Install with EMD's own setup

Status: Accepted
Date: 2026-11-09

## Context

Installing EMD means registering two MCP servers with each agent (EMD, and MobileBuildMCP with its tap tools on), installing the skill, and checking the stack's toolchain. Until #28, users registered MobileBuildMCP by hand, and the README told the agent how to tap. REA installs a similar tool with one setup command ([REA's flow](https://github.com/morluto/rea/blob/main/docs/installation.md)). Maintained installers exist for parts of the job: `npx add-mcp` registers an MCP server with many agents, and `npx skills add` installs a skill.

## Options

### A: EMD's own `setup` command
One command, one plan, one approval. It registers both servers, installs the skill and checks the toolchain. Where a maintained installer meets decision 0008, `setup` calls it; otherwise it writes the agent's config itself, with a backup.

### B: An agent plugin per agent
Each agent's plugin system places the MCP servers and the skill, so EMD writes no agent config. Each agent installs plugins its own way, and the toolchain step (Xcode, AXe, Maestro) still needs a command the user approves, so the user installs twice.

## Decision

A. The user types one command and approves once, and `vision.md` already describes it.

## Consequences

- The installers are a dependency of `setup`, pinned like AXe and Maestro, and checked against decision 0008 before `setup` uses them.
- Where EMD writes a config itself, it owns that format and must follow the agent's changes.
- Revisit B if users ask to install EMD as a plugin.
