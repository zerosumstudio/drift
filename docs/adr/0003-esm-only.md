# 3. ESM only

Status: accepted

## Context

The package shipped ESM and CJS, minified, with source maps in the tarball. Two copies of the package in one app mean two `Drift` classes, and a CJS build adds nothing for a library that only runs in a browser. Node 22.12 and later load ESM from `require()`, and development and CI run on Node 26.

## Decision

- Build with tsdown to ESM only, with `platform: 'browser'` (which makes the output `index.js` rather than `index.mjs`), unminified and with no source maps. Consumers minify.
- `exports` lists `.` and `./track`, each with `types` and `default`, and `./package.json` as a plain path. `trackProgrammaticChanges` lives in `./track`, because it is an escape hatch for scripts that set `.value` without an event, and apps that don't need it shouldn't pay for it. `files` ships `dist` and the migration guide.
- `engines.node` is `>=26` and `.nvmrc` is 26, the same as the other `@zerosumstudio` packages. A smoke test runs against `dist` through the exports map and `require()`s the ESM entry.

## Consequences

- No dual-package hazard and a much smaller tarball.
- Jest setups that transform to CJS need `transformIgnorePatterns` for the package.
- The UMD bundle and its `Drift` browser global stay gone. Load the ESM build in a browser.
