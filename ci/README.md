# CI helpers

GitHub Actions has no Orca CLI, so:

- `orca-types/` is a snapshot of the typings `orca plugin types` writes to `.orca/types/`. `tsconfig.ci.json` type-checks against it. Refresh it after upgrading Orca with `orca plugin types . && rm -rf ci/orca-types && cp -R .orca/types ci/orca-types`.
- `register.mjs` maps `orca/testing` to `orca-testing.mjs` (Node's own `test` and `assert`). With it, the tests that need no Orca host (`src/cli.test.ts`, `src/monitor.test.ts`) run on plain Node 22+. The other tests use Orca's mock host; run them locally with `orca plugin test .`.
