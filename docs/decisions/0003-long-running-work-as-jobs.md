# 0003: Long-running work is a job: start, then poll

Status: Accepted (2026-10-24)

## Context

`launch` takes about 40 s warm and minutes cold. Codex's default MCP tool
timeout is 60 s (`tool_timeout_sec`, Codex docs), so one blocking call fails
there. M2 must queue builds and device runs across agents, and each agent runs
its own `emd mcp` process.

## Options

- A: one blocking call. Simplest; fails where a tool timeout is shorter than a
  cold build.
- B: one call plus progress notifications. Needs every client to reset its
  timeout on progress; not all do.
- C: start, then poll. Works with any client, and is the shape a queue needs.

## Decision

C. A long-running tool returns a job within seconds; `job_status` returns its
state and, once finished, the result. Today that is `launch`. The CLI still
blocks for humans (`emd launch`); `emd job status <id>` reads a job.

A job is a JSON file in the shared state dir (`EMD_STATE_DIR`, default `emd/`
under the temp dir), run by a detached worker (`emd job run <id>`). Statuses:
queued, running, succeeded, failed. A view has the status, current step,
seconds and result. Reading a job settles one whose worker died or never started.

## Consequences

- Any process can read any job, and a job outlives the server that started it.
  The M2 queue adds a scheduler that decides when a queued job's worker starts,
  with a global limit.
- Job files are not deleted yet; `emd gc` will.
- Agents must poll (every 5 to 10 s), and `launch` no longer returns the launch
  result directly.
