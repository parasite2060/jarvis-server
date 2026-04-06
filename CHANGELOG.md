# Changelog

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
