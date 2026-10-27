# EMD: Everything Mobile Development

Build, run, check and prove mobile changes from any coding agent, without opening Xcode or Android Studio.

Status: early development, not on npm yet.

## Install from source

Requires Node 22 or newer.

```sh
git clone https://github.com/andrewhenin/emd.git
cd emd
npm ci
npm run build
claude mcp add emd -- node "$PWD/dist/bin.js" mcp
```

The last line registers `emd mcp` with Claude Code. The CLI runs the same way: `node dist/bin.js detect`.

See [docs/vision.md](docs/vision.md) for what EMD is and [AGENTS.md](AGENTS.md) for how to work on it.

## Contributing

EMD is open source but not accepting outside pull requests yet. Bug reports and ideas are welcome as issues; report vulnerabilities per [SECURITY.md](SECURITY.md).

License: [Apache-2.0](LICENSE)
