# Changelog

## [0.11.0](https://github.com/parasite2060/jarvis-server/compare/v0.10.0...v0.11.0) (2026-04-24)


### Features

* make agent usage limits configurable via env vars and raise token ceilings ([d1338d8](https://github.com/parasite2060/jarvis-server/commit/d1338d8c646391d3ba30fbd506beebbfe7928f72))

## [0.10.0](https://github.com/parasite2060/jarvis-server/compare/v0.9.0...v0.10.0) (2026-04-24)


### Features

* **epic-11:** story 11.19 POST /dream accepts optional source_date ([dbc5a1b](https://github.com/parasite2060/jarvis-server/commit/dbc5a1b8adc75629ffa62fc6b118b1a89e86bf68))


### Bug Fixes

* **deployment:** shared bind-mount for memu-server + memu-worker storage ([5271ead](https://github.com/parasite2060/jarvis-server/commit/5271ead3e7c12428ff29bc017b2000e7dbb8b5a7))

## [0.9.0](https://github.com/parasite2060/jarvis-server/compare/v0.8.0...v0.9.0) (2026-04-20)


### Features

* **epic-11:** stories 11.10 + 11.12 + 11.13 dream engine hardening ([14f3d69](https://github.com/parasite2060/jarvis-server/commit/14f3d69a293aea73197db8a3a1f3b74c3645b9be))
* **epic-11:** story 11.11 idempotent frontmatter prepend inside health-fix loop ([124ad6f](https://github.com/parasite2060/jarvis-server/commit/124ad6f836745674688ed1436ec72ea64dc8b6c7))
* **epic-11:** story 11.14 persist vault summary in frontmatter ([0614323](https://github.com/parasite2060/jarvis-server/commit/0614323c5355a5fb845fe1d8a2a11b6d4dc17187))
* **epic-11:** story 11.15 remove deep-dream daily log write ([15b106a](https://github.com/parasite2060/jarvis-server/commit/15b106aaedb90b6720cbd6856f0a30ab3409888e))
* **epic-11:** story 11.17 add memu-worker service and fix reinforcement telemetry ([dc2911a](https://github.com/parasite2060/jarvis-server/commit/dc2911aedad6da828c8d3fc9cd8fe9fe62a3ea9b))
* **epic-11:** story 11.9 phase tool-call budgets 300 + phase 2 visibility ([fac3627](https://github.com/parasite2060/jarvis-server/commit/fac3627cf8d91ef22d59179e5d2e611619536fd5))

## [0.8.0](https://github.com/parasite2060/jarvis-server/compare/v0.7.0...v0.8.0) (2026-04-18)


### Features

* **epic-11:** story 11.8 periodic vault sync ([574084e](https://github.com/parasite2060/jarvis-server/commit/574084e373766630588ba46db965d5cc5c2e2276))

## [0.7.0](https://github.com/parasite2060/jarvis-server/compare/v0.6.0...v0.7.0) (2026-04-18)


### Features

* **epic-10:** story 10.1 server-side secret scrubber + prompt guardrails ([7e16e25](https://github.com/parasite2060/jarvis-server/commit/7e16e25b9e229223bd3e49f903671583da8efba4))
* **epic-11:** story 11.2 weekly review phase telemetry + tool-call budget ([e9b306a](https://github.com/parasite2060/jarvis-server/commit/e9b306abe0749bfe9a97f2abc342761676b1173e))
* **epic-11:** story 11.4 post-health-fix vault re-validation ([8c17cd7](https://github.com/parasite2060/jarvis-server/commit/8c17cd7365d69204fd2a251f21998eaa374299df))
* **epic-11:** story 11.5 dreams.outcome enum for end-state disambiguation ([97a61ae](https://github.com/parasite2060/jarvis-server/commit/97a61aeb0647024c2c098858b57bb61e9cb288ce))
* **epic-11:** story 11.7 shared secret patterns JSON + parity tests ([d1c37b7](https://github.com/parasite2060/jarvis-server/commit/d1c37b7c2ab5f88cb13363c60c44e44a36646115))
* **epic-9:** story 9.35 consolidate session-log storage on dreams.session_log JSONB ([34382e1](https://github.com/parasite2060/jarvis-server/commit/34382e1fc6293955f136e94155c7c1b66d680e91))


### Bug Fixes

* **epic-11:** story 11.1 decouple cache invalidation from git outcome ([8cf61e9](https://github.com/parasite2060/jarvis-server/commit/8cf61e9c846f0cf5dc7a1f925d8654a0349399f4))

## [0.6.0](https://github.com/parasite2060/jarvis-server/compare/v0.5.2...v0.6.0) (2026-04-17)


### Features

* auto-fix health check issues in deep dream pipeline ([080100c](https://github.com/parasite2060/jarvis-server/commit/080100c96292fd13125ce0d7316b557052ccb3d4))
* **epic-9:** implement stories 9.10 + 9.11 — bidirectional links & typed edges ([e7bbfa5](https://github.com/parasite2060/jarvis-server/commit/e7bbfa59f45ee33ac03ceb707981b5294866c359))
* **epic-9:** implement stories 9.12 + 9.13 — anti-repetition & vault log ([c1e5de8](https://github.com/parasite2060/jarvis-server/commit/c1e5de8e236ab32bc7c1dee8f43b70c61fe24823))
* **epic-9:** implement stories 9.15-9.24 — prompt injection, telemetry, vault-aware agents ([f8c1d00](https://github.com/parasite2060/jarvis-server/commit/f8c1d0037a19015a92be746eac3ac6e1656a039a))
* **epic-9:** implement stories 9.25-9.29 ([3cac8c6](https://github.com/parasite2060/jarvis-server/commit/3cac8c6db3ca27def51ec6f846d9fa75b1d36336))
* **epic-9:** implement stories 9.30-9.32 ([ff22517](https://github.com/parasite2060/jarvis-server/commit/ff2251764a00b58994e4d24f06e7a958f83fe1dc))
* **epic-9:** implement stories 9.8 + 9.9 — weekly review & health injection ([7d0b60e](https://github.com/parasite2060/jarvis-server/commit/7d0b60e48c2c4ff4d4f08a958752cf507b7f172e))
* **epic-9:** implement story 9.1 — enhanced vault structure ([9585594](https://github.com/parasite2060/jarvis-server/commit/958559484c4037606ae4fc6e24c79e4bbd3a0f0f))
* **epic-9:** implement story 9.14 — foundation/terminal nodes ([f46e954](https://github.com/parasite2060/jarvis-server/commit/f46e954a0df0bc6a2dd992dc7b84a74139e549eb))
* **epic-9:** implement story 9.2 — enhanced document content structure ([eec2d26](https://github.com/parasite2060/jarvis-server/commit/eec2d267940e86b865dc15ad9ec016842189fc36))
* **epic-9:** implement story 9.3 — extraction agent structured store tools ([8ba5ecf](https://github.com/parasite2060/jarvis-server/commit/8ba5ecf63560c01de00897fe66373cdc23f4d2dc))
* **epic-9:** implement story 9.4 — light dream redesign (record only) ([514f59e](https://github.com/parasite2060/jarvis-server/commit/514f59ee5a3b1002b1e93bde2a52d57dfa1c084c))
* **epic-9:** implement story 9.5 — deep dream phase 1 (light sleep) ([d378722](https://github.com/parasite2060/jarvis-server/commit/d3787221fa89bc2da16c0bbb2ff5147b1c4afa41))
* **epic-9:** implement story 9.6 — deep dream phase 2 (REM sleep) ([b774e76](https://github.com/parasite2060/jarvis-server/commit/b774e7692699846630dbaa0e2d246c39f4fedb14))
* **epic-9:** implement story 9.7 — deep dream phase 3 (deep sleep) ([8d662df](https://github.com/parasite2060/jarvis-server/commit/8d662dfa23237c8f57f809c08d1cfd32ca6bc576))
* **epic-9:** story 9.34 — add reasoning to extracted memories ([5ac841f](https://github.com/parasite2060/jarvis-server/commit/5ac841f278c38ebbac5166de7965f5b6c7f401d8))


### Bug Fixes

* **epic-9:** align extraction + consolidation prompts with vault design ([9a6cef0](https://github.com/parasite2060/jarvis-server/commit/9a6cef0e0629ac60ce5e580319bee37ffce9a5a9))
* **epic-9:** story 9.33 + prompt alignment fixes ([c1d19ac](https://github.com/parasite2060/jarvis-server/commit/c1d19acaeab019473d708c5a09e6558194fb236f))
* **light-dream:** short-session count + unlimited memory content ([57e04ad](https://github.com/parasite2060/jarvis-server/commit/57e04add77da016a84e2fed23612e5436e0e5602))
* make deep dream gather resilient to MemU failures ([b5f5dea](https://github.com/parasite2060/jarvis-server/commit/b5f5deae0414c8724cfc8510860a11a9b4bff032))
* use same agent session for health fix (context + token caching) ([bec7163](https://github.com/parasite2060/jarvis-server/commit/bec716378d2fb34768247749f1e98b4094f6d152))

## [0.5.2](https://github.com/parasite2060/jarvis-server/compare/v0.5.1...v0.5.2) (2026-04-06)


### Bug Fixes

* merge PR directly instead of auto-merge, catch merge failures ([b1a732a](https://github.com/parasite2060/jarvis-server/commit/b1a732a63b133aea9b3d41b7f9b5afb474913434))

## [0.5.1](https://github.com/parasite2060/jarvis-server/compare/v0.5.0...v0.5.1) (2026-04-06)


### Bug Fixes

* increase agent limits (1.5M tokens, 300 tool calls) ([a80908f](https://github.com/parasite2060/jarvis-server/commit/a80908fe6b8c3ef677172294464c142f99cf71ce))

## [0.5.0](https://github.com/parasite2060/jarvis-server/compare/v0.4.0...v0.5.0) (2026-04-06)


### Features

* file-based transcript + store_memory + merge agent + history compaction ([6211cd5](https://github.com/parasite2060/jarvis-server/commit/6211cd5015bcc4627413135780ed5aa2c8196d8b))

## [0.4.0](https://github.com/parasite2060/jarvis-server/compare/v0.3.0...v0.4.0) (2026-04-05)


### Features

* **epic-8:** implement story 8-1 — PydanticAI dream extraction agent ([7c75e9f](https://github.com/parasite2060/jarvis-server/commit/7c75e9f5b38d49d72ea9c0f6933227d88eb37883))
* **epic-8:** implement story 8-2 — PydanticAI deep dream consolidation agent ([64b420d](https://github.com/parasite2060/jarvis-server/commit/64b420d79f8b5c41c0daf639ca3a1fb24fd26e39))
* **epic-8:** implement story 8-3 — agent observability and testing ([9f9d5fb](https://github.com/parasite2060/jarvis-server/commit/9f9d5fb1db3833af1d3da8b3d63a9bdf273f1eeb))

## [0.3.0](https://github.com/parasite2060/jarvis-server/compare/v0.2.3...v0.3.0) (2026-04-05)


### Features

* add ARQ worker service for dream processing ([9923ebe](https://github.com/parasite2060/jarvis-server/commit/9923ebe723a01f5a294abb1fae308b2b6a4cab2e))

## [0.2.3](https://github.com/parasite2060/jarvis-server/compare/v0.2.2...v0.2.3) (2026-04-05)


### Bug Fixes

* handle 'user' type entries (not 'human') and extract tool_result from user messages ([7b29ef7](https://github.com/parasite2060/jarvis-server/commit/7b29ef74968928d2d941cc00ca027b0ef3a50dde))
* rewrite transcript parser for actual Claude Code JSONL format ([f7edd08](https://github.com/parasite2060/jarvis-server/commit/f7edd089286c097668742b80d1712d8193f7ab4c))

## [0.2.2](https://github.com/parasite2060/jarvis-server/compare/v0.2.1...v0.2.2) (2026-04-05)


### Bug Fixes

* add timestamp to each message in parsed transcript ([d6b5d40](https://github.com/parasite2060/jarvis-server/commit/d6b5d40d6431dce107b4066e6b5f6d641c0fd230))
* extract session metadata (session_id, cwd, model, timestamp) into parsed transcript header ([d4b9bef](https://github.com/parasite2060/jarvis-server/commit/d4b9bef60272bbe9f0728b6975efe40b6e19858e))
* include tool calls and results in parsed transcript ([f11e947](https://github.com/parasite2060/jarvis-server/commit/f11e947a713ca3bf203889b7ca93c9392b48ea6e))
* remove JARVIS_CACHE_DIR from server context — now injected by plugin hook ([aad3c19](https://github.com/parasite2060/jarvis-server/commit/aad3c190f3d064bb569219c525958d4402e78d73))


### Documentation

* add Cloudflare Tunnel + Zero Trust setup guide ([d8bb1aa](https://github.com/parasite2060/jarvis-server/commit/d8bb1aa5a6f3c209b3ad307b80031f8770640f01))
* replace plugin guide with link to plugin README ([d145dd6](https://github.com/parasite2060/jarvis-server/commit/d145dd6c011626e98ee74c3d113c3a7edc4ea4bd))
* update plugin install command to jarvis-plugin@jarvis ([ddd4e82](https://github.com/parasite2060/jarvis-server/commit/ddd4e8252d939998245c25edc7c386fdc833ff5d))

## [0.2.1](https://github.com/parasite2060/jarvis-server/compare/v0.2.0...v0.2.1) (2026-04-05)


### Bug Fixes

* read version from package metadata + opt-in Node.js 24 for Actions ([d61fa66](https://github.com/parasite2060/jarvis-server/commit/d61fa6660a1e2075f2c5ab9f14148472a9b02f1e))

## [0.2.0](https://github.com/parasite2060/jarvis-server/compare/v0.1.0...v0.2.0) (2026-04-05)


### Features

* add config endpoints for auto-merge and dream settings ([f424847](https://github.com/parasite2060/jarvis-server/commit/f424847081f28dd6535ec8611874e5c204792756))
* add context assembly and cache endpoints ([5b526ba](https://github.com/parasite2060/jarvis-server/commit/5b526ba996af25d9e4143e4618912ca66391b95c))
* add conversation ingestion endpoint with transcript parsing ([ef41bc8](https://github.com/parasite2060/jarvis-server/commit/ef41bc8c84179b4b5edb1f7532d03e0c3b560f7e))
* add deep dream git PR creation and MemU alignment ([4589e2b](https://github.com/parasite2060/jarvis-server/commit/4589e2b8bdced243033a54db28c43a2fbe2e6a5d))
* add deep dream vault folder updates ([ca54851](https://github.com/parasite2060/jarvis-server/commit/ca548514a4e8b5651159f1bc05d28d26d8ed1b32))
* add file manifest and file serving endpoints ([29caea1](https://github.com/parasite2060/jarvis-server/commit/29caea1e8bf02c4e49de6b6049d03b6e39e47cde))
* add light dream git branch and PR creation ([053651b](https://github.com/parasite2060/jarvis-server/commit/053651ba8e639fd7d7607fb32afd295e9eda31a5))
* add light dream memory file updates ([506e18c](https://github.com/parasite2060/jarvis-server/commit/506e18c4e9bf2ee51c8c600b6bc347dbfffd46f3))
* add MemU proxy endpoints for memory search and add ([feada16](https://github.com/parasite2060/jarvis-server/commit/feada169c719ef18755df2899d99c1a99856dc94))
* add memu-ui service and update memu-server build ([2052313](https://github.com/parasite2060/jarvis-server/commit/2052313637db9d1737515f8466c3f052d3cc4d7f))
* dynamic dream scheduler, env var refactor, deployment docs and templates ([446b3b9](https://github.com/parasite2060/jarvis-server/commit/446b3b9e47321d2fac3689fc6151a5392ddebee2))
* implement deep dream consolidation pipeline ([233aaea](https://github.com/parasite2060/jarvis-server/commit/233aaeaeb81304d909afec6c507cee534d52b775))
* implement light dream pipeline with GPT-5.2 memory extraction ([f88e406](https://github.com/parasite2060/jarvis-server/commit/f88e406c60fd3838656a74f2d7ada136d9836a4d))
* scaffold FastAPI server with Docker Compose infrastructure ([2b564dd](https://github.com/parasite2060/jarvis-server/commit/2b564dd5fff37fbeab66195e217077fc3de57a93))


### Bug Fixes

* build MemU from forked source with Azure OpenAI support ([e9fafe4](https://github.com/parasite2060/jarvis-server/commit/e9fafe4b7950f5736258ca57e1c3fd9aea6174eb))
* configure MemU for Azure OpenAI and add health endpoint ([161b59f](https://github.com/parasite2060/jarvis-server/commit/161b59f628aca60d0e3066088b13b06cbe769576))
* correct MemU API paths from /api/v3/* to actual endpoints ([377170d](https://github.com/parasite2060/jarvis-server/commit/377170d34376365afd715c5b5952621c00bacdc8))
* correct MemU docker image and port configuration ([47d0911](https://github.com/parasite2060/jarvis-server/commit/47d091143d1004c48565e73a1f2eada30c8b3ada))
* correct Temporal DB driver from 'postgresql' to 'postgres12_pgx' ([3c7465b](https://github.com/parasite2060/jarvis-server/commit/3c7465ba391d34a1774fffb64cf145db699457d7))
* memu-server health check and jarvis-server extra env vars ([79c999a](https://github.com/parasite2060/jarvis-server/commit/79c999a8cb407aa7b35065285a11731b4da206fd))


### Documentation

* add comprehensive README with architecture, API reference, and setup guide ([08f24ed](https://github.com/parasite2060/jarvis-server/commit/08f24ed3613dee64d637fae1435d7e2b9674a45d))
* add GitHub Packages auth setup for MCP server install ([f0f11c3](https://github.com/parasite2060/jarvis-server/commit/f0f11c331f2b3405a8841ede7e3df52792ddbbaa))
* add marketplace install option to plugin setup guide ([c7aae06](https://github.com/parasite2060/jarvis-server/commit/c7aae06ee688042c33f59e68905dbcae66fe0236))
* add MemU server deployment guide and update prerequisites ([0de2372](https://github.com/parasite2060/jarvis-server/commit/0de237289423ad23f91be00b6b9141ec76fef42b))
* fix plugin guide step numbering, remove manual build reference ([4e20128](https://github.com/parasite2060/jarvis-server/commit/4e20128535fc54760b4d97621bdef89c88f6509e))
* simplify plugin setup — no auth needed for public GitHub Packages ([22cc2b5](https://github.com/parasite2060/jarvis-server/commit/22cc2b58416a02fc34c1e19bd03f6864b5116da8))
* trim plugin guide to essentials — install, configure, verify ([fb5c706](https://github.com/parasite2060/jarvis-server/commit/fb5c70679b817337e25076ad058d223c37242507))
* update plugin guide — MCP server auto-installed via npx ([97bed01](https://github.com/parasite2060/jarvis-server/commit/97bed01db4ebf8d7d6443e4a670a5947370eb138))
