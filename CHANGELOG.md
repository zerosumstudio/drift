# Changelog

## Unreleased

### Breaking

- **Published as `@zerosumstudio/drift`.** The repo moved to
  [zerosumstudio/drift](https://github.com/zerosumstudio/drift). Swap the package
  name and the imports. `@bkincz/drift` stays on npm at 1.4.0.
- **No UMD bundle.** `require` gets a plain CommonJS build, and `dist/drift.umd.cjs`
  and its `Drift` browser global are gone. Load the ESM build in a browser instead.

### Fixed

- CommonJS consumers get their own type declarations instead of the ESM ones.

## 1.4.0 - 2026-08-13

### Breaking

- **Node 22.12 is the minimum.**

### Changed

- **Drift has no dependencies.** The `@bkincz/clutch` peer dependency is gone and
  state lives in an internal store, exported as `DriftStore`. The rest of the API is
  unchanged, and persisted form state from 1.3.x still loads.

### Fixed

- Registering an already tracked form or field is idempotent, so a single submit no
  longer fires twice.
- Inputs inside a nested `data-drift-form` belong only to their own form, not the
  outer container too.

## 1.3.1 - 2026-04-22

- Version bump with no user-facing changes.

## 1.3.0 - 2026-04-22

- **`data-drift-form` works on any element**, not only a native `<form>`, to avoid
  nested form conflicts.

## 1.2.0 - 2026-03-17

- **`setInitialValues`** and an async **`resetForm`** with `onReset` hook support.
- Radio groups are handled automatically, and fields accept value transformations.
- Form state tracks `canSubmit`, `hasBeenValidated` and `validatingFields`.

## 1.1.0 - 2026-03-17

- Support for programmatic changes to field values.

## 1.0.0 - 2026-01-25

- First release.
