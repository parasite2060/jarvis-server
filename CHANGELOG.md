# Changelog

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
