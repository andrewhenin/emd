# Changelog

## [0.10.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.9.0...emd-agents-v0.10.0) (2026-11-10)


### Features

* name the fix when an old Expo app fails on Xcode 27 ([#138](https://github.com/andrewhenin/emd/issues/138)) ([cce3a96](https://github.com/andrewhenin/emd/commit/cce3a96d165a109e40fe8c0ce90d8b503c66da9e))


### Bug Fixes

* pick a simulator runtime that the selected Xcode supports ([#135](https://github.com/andrewhenin/emd/issues/135)) ([259e41e](https://github.com/andrewhenin/emd/commit/259e41e9b726794af1a72fd36f3790f84440871f))

## [0.9.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.8.0...emd-agents-v0.9.0) (2026-11-10)


### Features

* detect points to the Expo app from a workspace root ([#137](https://github.com/andrewhenin/emd/issues/137)) ([9423f16](https://github.com/andrewhenin/emd/commit/9423f162c2bb16136c1e73713564e024e2110833))


### Bug Fixes

* accept check names with spaces ([#134](https://github.com/andrewhenin/emd/issues/134)) ([afb7b12](https://github.com/andrewhenin/emd/commit/afb7b12ce25542647bbe633d89e869b6cca4367a))
* detect the package manager of a workspace from its root ([#136](https://github.com/andrewhenin/emd/issues/136)) ([5aed55e](https://github.com/andrewhenin/emd/commit/5aed55e2fc7427282e46cf2b8fee1dd0008fe7cb))
* keep the check screenshot on Xcode 27 ([#149](https://github.com/andrewhenin/emd/issues/149)) ([3fe2ac7](https://github.com/andrewhenin/emd/commit/3fe2ac798aba90c84eae59f5673a2d801ce6e71b))

## [0.8.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.7.2...emd-agents-v0.8.0) (2026-11-09)


### Features

* read the Expo app config with expo config --json ([#118](https://github.com/andrewhenin/emd/issues/118)) ([cb3c237](https://github.com/andrewhenin/emd/commit/cb3c237c6addcc32e10d5f4aa98b0c2b45fac710))
* tap through MobileBuildMCP in e2e, then check with EMD ([#119](https://github.com/andrewhenin/emd/issues/119)) ([651f1ed](https://github.com/andrewhenin/emd/commit/651f1ed3f92c67a7e34164e3a34c5b123fa4502c))


### Bug Fixes

* launch stops the dev server an earlier launch left ([#129](https://github.com/andrewhenin/emd/issues/129)) ([87d0bfb](https://github.com/andrewhenin/emd/commit/87d0bfbe73cd04cc2e79c650302bb5604e399e3e))

## [0.7.2](https://github.com/andrewhenin/emd/compare/emd-agents-v0.7.1...emd-agents-v0.7.2) (2026-11-08)


### Bug Fixes

* route every outside tool call through runTool ([#93](https://github.com/andrewhenin/emd/issues/93)) ([9f471d4](https://github.com/andrewhenin/emd/commit/9f471d4c6f631000273ce83170048f7c8876aa43))

## [0.7.1](https://github.com/andrewhenin/emd/compare/emd-agents-v0.7.0...emd-agents-v0.7.1) (2026-11-07)


### Bug Fixes

* an empty screen read is a failed read, not a missing element ([#88](https://github.com/andrewhenin/emd/issues/88)) ([9d9747b](https://github.com/andrewhenin/emd/commit/9d9747b8a10638021bc95666515ce2917d9582ff))
* continue when only Expo's open step fails; report port, DerivedData and disk on failure ([#85](https://github.com/andrewhenin/emd/issues/85)) ([d438f45](https://github.com/andrewhenin/emd/commit/d438f451d87ff571645f48e52cf76001b9158429))
* give every call to an outside tool a timeout ([#70](https://github.com/andrewhenin/emd/issues/70)) ([a45436e](https://github.com/andrewhenin/emd/commit/a45436e2aefe1c8b8fa7274e9cc7d85988e760c9))
* read only ledger files named like keys ([#83](https://github.com/andrewhenin/emd/issues/83)) ([717ac59](https://github.com/andrewhenin/emd/commit/717ac5985758e1fca12447a3ebb636f3c06561ef))

## [0.7.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.6.1...emd-agents-v0.7.0) (2026-11-01)


### ⚠ BREAKING CHANGES

* name a run by its launch job only ([#71](https://github.com/andrewhenin/emd/issues/71))

### Features

* emd gc removes resources of worktrees that no longer exist ([#79](https://github.com/andrewhenin/emd/issues/79)) ([fa0007e](https://github.com/andrewhenin/emd/commit/fa0007e614605de3c449dc9b4a17cf9e2e277656))
* name a run by its launch job only ([#71](https://github.com/andrewhenin/emd/issues/71)) ([f8f062b](https://github.com/andrewhenin/emd/commit/f8f062b84036374b7887720171192fbef113f1bd))


### Bug Fixes

* capture the app's log lines during the run ([#81](https://github.com/andrewhenin/emd/issues/81)) ([8271811](https://github.com/andrewhenin/emd/commit/8271811a241be79dd24bfab54465d1b0947dec54))
* run AXe and Maestro from the path where they were found ([#76](https://github.com/andrewhenin/emd/issues/76)) ([86edb59](https://github.com/andrewhenin/emd/commit/86edb59236c75099b9179feb4371d9ced7129988))

## [0.6.1](https://github.com/andrewhenin/emd/compare/emd-agents-v0.6.0...emd-agents-v0.6.1) (2026-10-29)


### Bug Fixes

* check matches expected log lines beyond the last 500 of a tag ([#66](https://github.com/andrewhenin/emd/issues/66)) ([f0bbef3](https://github.com/andrewhenin/emd/commit/f0bbef3b83848bbb389b409df6617b7f6842238f))

## [0.6.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.5.0...emd-agents-v0.6.0) (2026-10-28)


### Features

* per-worktree simulator, DerivedData and Metro port, recorded as EMD-owned ([#47](https://github.com/andrewhenin/emd/issues/47)) ([292f3a2](https://github.com/andrewhenin/emd/commit/292f3a2c12b3e812a8eab2757fd3b102232f0294))

## [0.5.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.4.0...emd-agents-v0.5.0) (2026-10-25)


### Features

* gather a run's evidence into one folder ([#43](https://github.com/andrewhenin/emd/issues/43)) ([61cee7f](https://github.com/andrewhenin/emd/commit/61cee7fdc1492f0fb5dbb14b9ff4c9020b9feae8))
* prefer AXe whenever it is installed ([#46](https://github.com/andrewhenin/emd/issues/46)) ([bc82a2d](https://github.com/andrewhenin/emd/commit/bc82a2d6b7fcf98781ca4b41ef9583039f6de68f))
* read the screen through AXe or Maestro, picked per machine ([#37](https://github.com/andrewhenin/emd/issues/37)) ([e35ac1b](https://github.com/andrewhenin/emd/commit/e35ac1bd3af1afc87f5ba11154bef60d04a4b641))


### Bug Fixes

* stop exporting the unused Fallback type ([#45](https://github.com/andrewhenin/emd/issues/45)) ([7077df5](https://github.com/andrewhenin/emd/commit/7077df50a4fc2c2613930f4319667cb0304caa45))

## [0.4.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.3.0...emd-agents-v0.4.0) (2026-10-25)


### Features

* check a run against log events and on-screen elements ([#35](https://github.com/andrewhenin/emd/issues/35)) ([a67570f](https://github.com/andrewhenin/emd/commit/a67570f69ed8a1cef936b2d715a0e45619b145b9))

## [0.3.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.2.0...emd-agents-v0.3.0) (2026-10-24)


### Features

* launch the Expo app on an iOS simulator ([#31](https://github.com/andrewhenin/emd/issues/31)) ([f06aaca](https://github.com/andrewhenin/emd/commit/f06aaca068e394990c26eb3539df6d487939ab9e))
* read tagged log lines per run ([#33](https://github.com/andrewhenin/emd/issues/33)) ([3822da6](https://github.com/andrewhenin/emd/commit/3822da61af47d8826cadaf6a0c6b41c101d0552a))
* run launch as a job, started and polled over MCP ([#32](https://github.com/andrewhenin/emd/issues/32)) ([2d3f7e1](https://github.com/andrewhenin/emd/commit/2d3f7e1e878685e37b6564965cc646ba086cca43))

## [0.2.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.1.0...emd-agents-v0.2.0) (2026-10-24)


### Features

* detect Expo platforms, app IDs and run commands ([#29](https://github.com/andrewhenin/emd/issues/29)) ([b4a516e](https://github.com/andrewhenin/emd/commit/b4a516e040a6071cdea17244092b0a7c2592eb5b))

## 0.1.0 (2026-10-24)


### Features

* add core skeleton with detect over CLI and MCP ([#20](https://github.com/andrewhenin/emd/issues/20)) ([af809dd](https://github.com/andrewhenin/emd/commit/af809ddc3a2c07b2372a220f2c967216b6734624))
* serve MCP through emd mcp on MCP SDK v2 ([#21](https://github.com/andrewhenin/emd/issues/21)) ([33937dd](https://github.com/andrewhenin/emd/commit/33937ddfe973d56a4f5959261841b5b5b7d44877))
