# Changelog

## [0.17.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.16.2...emd-agents-v0.17.0) (2026-11-24)


### Features

* an Android emulator per worktree ([#255](https://github.com/andrewhenin/emd/issues/255)) ([618d5dd](https://github.com/andrewhenin/emd/commit/618d5dd1c8370aec9bd1aa4c5da7ab432ff807ee))
* detect native Android projects and add a native Android fixture ([#253](https://github.com/andrewhenin/emd/issues/253)) ([b817168](https://github.com/andrewhenin/emd/commit/b81716855ecdc3d8ad610d4d86088a6ecde58ae9))
* detect native iOS projects and add a native iOS fixture ([#244](https://github.com/andrewhenin/emd/issues/244)) ([03be211](https://github.com/andrewhenin/emd/commit/03be211539710c4e80fec137c918cfae1374ddd0))
* doctor and setup for Android ([#264](https://github.com/andrewhenin/emd/issues/264)) ([c7b4ed2](https://github.com/andrewhenin/emd/commit/c7b4ed23a583bdb35d67c437589ef2c0aa2b2602))
* launch builds and runs a native Android app on an emulator ([#258](https://github.com/andrewhenin/emd/issues/258)) ([74a30ca](https://github.com/andrewhenin/emd/commit/74a30ca497f5760cbdb09780b92e04051ff7ffc9))
* launch builds and runs a native iOS app ([#245](https://github.com/andrewhenin/emd/issues/245)) ([b322735](https://github.com/andrewhenin/emd/commit/b32273568b3fab8be7e4fa607adc9cfecca1d22c))
* launch, logs, checks and input for Expo apps on Android ([#268](https://github.com/andrewhenin/emd/issues/268)) ([220ea0d](https://github.com/andrewhenin/emd/commit/220ea0d2ebccee8d25fe7ae6e8afde445addc094))
* logs and log checks on Android ([#260](https://github.com/andrewhenin/emd/issues/260)) ([931a441](https://github.com/andrewhenin/emd/commit/931a44164f4e75a82e14551e911af59edefe1f59))
* prepare, scheme and configuration inputs for native iOS launch ([#270](https://github.com/andrewhenin/emd/issues/270)) ([4663cd5](https://github.com/andrewhenin/emd/commit/4663cd5a1f9f5ae3eb28cdc52a8646a19655bdf2))
* screen reads, taps, typing and swipes on Android ([#262](https://github.com/andrewhenin/emd/issues/262)) ([013cabd](https://github.com/andrewhenin/emd/commit/013cabda45d56a9906c960e3fea9b6862a8124ff))


### Bug Fixes

* a build stops on a hang, not on slow progress ([#248](https://github.com/andrewhenin/emd/issues/248)) ([6ba9705](https://github.com/andrewhenin/emd/commit/6ba97053a266c71280b2bd209f4d23e08981271f))
* a check reads the log a little longer after the screen matched ([#250](https://github.com/andrewhenin/emd/issues/250)) ([f3b09bb](https://github.com/andrewhenin/emd/commit/f3b09bb248eb5e2bab668b612f5309b591a66803))

## [0.16.2](https://github.com/andrewhenin/emd/compare/emd-agents-v0.16.1...emd-agents-v0.16.2) (2026-11-21)


### Bug Fixes

* read the screen again when AXe returns an empty tree ([#237](https://github.com/andrewhenin/emd/issues/237)) ([652e968](https://github.com/andrewhenin/emd/commit/652e968ceae50664e483ed819f1ad07a7a9a791c))
* turn off keyboard predictions in the domain iOS 26 reads ([#234](https://github.com/andrewhenin/emd/issues/234)) ([5063f9a](https://github.com/andrewhenin/emd/commit/5063f9a72cf4b51ba3e1cff62dccacd5d918c1ba))

## [0.16.1](https://github.com/andrewhenin/emd/compare/emd-agents-v0.16.0...emd-agents-v0.16.1) (2026-11-20)


### Bug Fixes

* launch asks the simulator again before rebuilding, and check times its steps ([#229](https://github.com/andrewhenin/emd/issues/229)) ([046bbf5](https://github.com/andrewhenin/emd/commit/046bbf5926308f0ee35d368d5ca99a2f5769f515))

## [0.16.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.15.0...emd-agents-v0.16.0) (2026-11-19)


### Features

* check runs taps, typing and swipes first, in one call ([#221](https://github.com/andrewhenin/emd/issues/221)) ([e2c80e1](https://github.com/andrewhenin/emd/commit/e2c80e18f1dec228ff73bcc38d226a0a465786e3))
* each check rewrites the evidence folder and returns its path ([#220](https://github.com/andrewhenin/emd/issues/220)) ([cd46317](https://github.com/andrewhenin/emd/commit/cd46317cd4ebfc2297082dfdcc355f7ad0d47666))
* launch and check return their result in the same call ([#219](https://github.com/andrewhenin/emd/issues/219)) ([cce20c1](https://github.com/andrewhenin/emd/commit/cce20c1b2737e923ea610d4c4e9df51bc37711df))
* launch installs the matching build instead of building it again ([#212](https://github.com/andrewhenin/emd/issues/212)) ([6f2fc91](https://github.com/andrewhenin/emd/commit/6f2fc91dc7444dd2c9d5a637ad400d251588593b))
* launch reloads the app after a JavaScript-only change ([#216](https://github.com/andrewhenin/emd/issues/216)) ([6c0ab27](https://github.com/andrewhenin/emd/commit/6c0ab273ca4199d225a70f26bfc40633ad9ff701))
* launch reports how long each phase took ([#209](https://github.com/andrewhenin/emd/issues/209)) ([9575038](https://github.com/andrewhenin/emd/commit/9575038bf1d201b2ce54c012dafc20b28647e346))


### Bug Fixes

* a later launch stops the dev server and log stream of a CLI launch ([#214](https://github.com/andrewhenin/emd/issues/214)) ([2dc2cc0](https://github.com/andrewhenin/emd/commit/2dc2cc011d642b1250f29b9db932b92e6b619a1a)), closes [#180](https://github.com/andrewhenin/emd/issues/180)
* job_status waits 30 s by default and starts no read after its deadline ([#218](https://github.com/andrewhenin/emd/issues/218)) ([c8095d4](https://github.com/andrewhenin/emd/commit/c8095d4aa6ad2947c4abf6a47551464d2a9ec5e5))
* launch builds when the installed app's files are gone, instead of failing ([#211](https://github.com/andrewhenin/emd/issues/211)) ([4173513](https://github.com/andrewhenin/emd/commit/4173513487eada79af145c1b16c329765803ce8e))
* launch lets Expo set a missing iOS app ID ([#197](https://github.com/andrewhenin/emd/issues/197)) ([d6d3eab](https://github.com/andrewhenin/emd/commit/d6d3eab8270150cb267554c0c76a0b56d2cc7218))
* type returns ok only when the typed text shows on screen ([#213](https://github.com/andrewhenin/emd/issues/213)) ([e6aa7f4](https://github.com/andrewhenin/emd/commit/e6aa7f4f6adad85eb56561545371bdcb871fa3d2))


### Performance Improvements

* fewer polls during a build where the client allows long calls ([#224](https://github.com/andrewhenin/emd/issues/224)) ([2e4d82e](https://github.com/andrewhenin/emd/commit/2e4d82e7ba91af78ad075c1717787ee86010dc5e))
* time native builds with xcodebuild's own timing summary ([#225](https://github.com/andrewhenin/emd/issues/225)) ([ca6c290](https://github.com/andrewhenin/emd/commit/ca6c290676b7f1f49075afd6db973b1cb2155273))

## [0.15.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.14.0...emd-agents-v0.15.0) (2026-11-15)


### Features

* job_status waits for the job to end ([#187](https://github.com/andrewhenin/emd/issues/187)) ([e89d2b8](https://github.com/andrewhenin/emd/commit/e89d2b850f4d60dd3421c9156c5134cd7432e456))
* launch skips the Xcode build when no native input changed ([#181](https://github.com/andrewhenin/emd/issues/181)) ([e7f7764](https://github.com/andrewhenin/emd/commit/e7f7764f13e4edb77108004daca74570381d51e1))
* tap waits for its element before it taps ([#184](https://github.com/andrewhenin/emd/issues/184)) ([b2eeecb](https://github.com/andrewhenin/emd/commit/b2eeecb53913191e2e936b4fbd429656009584b8))


### Bug Fixes

* launch returns only when the app's screen can be read ([#185](https://github.com/andrewhenin/emd/issues/185)) ([43c04e8](https://github.com/andrewhenin/emd/commit/43c04e89aeee8c702ba73ef79395d0eb8176732c))

## [0.14.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.13.0...emd-agents-v0.14.0) (2026-11-14)


### Features

* publish emd-agents to npm ([#170](https://github.com/andrewhenin/emd/issues/170)) ([329a053](https://github.com/andrewhenin/emd/commit/329a0537bd94070c8049a77bfc6540e2b89da3ed)), closes [#169](https://github.com/andrewhenin/emd/issues/169)

## [0.13.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.12.0...emd-agents-v0.13.0) (2026-11-14)


### Features

* setup installs AXe and runs doctor at its end ([#162](https://github.com/andrewhenin/emd/issues/162)) ([bc5a916](https://github.com/andrewhenin/emd/commit/bc5a916c1066451ebfe335b7d7c875c0f6aaab24))

## [0.12.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.11.0...emd-agents-v0.12.0) (2026-11-14)


### Features

* lock each check's first expectations ([#165](https://github.com/andrewhenin/emd/issues/165)) ([f0c46a9](https://github.com/andrewhenin/emd/commit/f0c46a968d19faec1f4ada6a0129e6872d57adf4))

## [0.11.0](https://github.com/andrewhenin/emd/compare/emd-agents-v0.10.0...emd-agents-v0.11.0) (2026-11-11)


### Features

* add EMD's agent skill ([#154](https://github.com/andrewhenin/emd/issues/154)) ([a304887](https://github.com/andrewhenin/emd/commit/a3048879e058b4ba805b346595820fd00796f62f))
* agents tap, type and swipe through EMD ([#161](https://github.com/andrewhenin/emd/issues/161)) ([aaa1a8a](https://github.com/andrewhenin/emd/commit/aaa1a8ad2f28a22f6c77c15b7d1831d7fb41c1bb))
* doctor checks what EMD needs on this Mac ([#157](https://github.com/andrewhenin/emd/issues/157)) ([552646e](https://github.com/andrewhenin/emd/commit/552646e9fcc2160dc0eb688f5847aa604252a9bb))
* setup registers EMD and MobileBuildMCP with each agent ([#156](https://github.com/andrewhenin/emd/issues/156)) ([27ed312](https://github.com/andrewhenin/emd/commit/27ed3122c2464addecfe292196f73eb6c127075e))


### Bug Fixes

* check reads again until a time limit before it fails ([#143](https://github.com/andrewhenin/emd/issues/143)) ([f2d5900](https://github.com/andrewhenin/emd/commit/f2d59004abe753ab9661feac64b6a7436f35f1de))

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
