# 0011: Publish to npm

Status: Accepted
Date: 2026-11-14

## Context

vision.md installs EMD with `npx -y emd-agents@latest setup`. Until #169, `setup` registered the absolute path of its own build, which under npx is in npx's cache. `setup` copies the skill once, so the registered server must stay at the skill's version. npm trusted publishing (OIDC) needs no token, but a trusted publisher can be added only to a package that exists ([npm](https://docs.npmjs.com/trusted-publishers)). With staged publishing, CI stages a version and a maintainer approves it with 2FA ([npm](https://docs.npmjs.com/staged-publishing)).

## Options

### A: Register `npx -y emd-agents@latest mcp`
New versions reach users without a new setup, but the server can move ahead of the skill. XcodeBuildMCP does this.

### B: Register `npx -y emd-agents@<setup's version> mcp`
Server and skill stay one version. Users run setup again to upgrade. REA does this ([REA](https://github.com/morluto/rea/blob/main/docs/installation.md)).

### C: Global install with absolute paths
Two commands, and the one-command npx install would still point into npx's cache.

## Decision

B. Each release is published from the Release Please workflow with `npm stage publish` through trusted publishing, and the owner approves it. The first version is published by hand, because the trusted publisher needs the package to exist.

## Consequences

- To upgrade, users run `npx -y emd-agents@latest setup` again.
- A GitHub release appears before npm has its version, until the owner approves it.
- A version number on npm can't be used again, even after unpublish.
- Revisit A if users ask for upgrades without setup.
