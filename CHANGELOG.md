# Changelog

## 1.0.0 - 2026-11-27

First release under `@zerosumstudio`. Everything below is a change from `@bkincz/drift` 1.4.0, and the [migration guide](./docs/migration-1.0.md) opens with a checklist.

### Breaking

- **Published as `@zerosumstudio/drift`.** Swap the package name and the imports. `@bkincz/drift` stays on npm at 1.4.0.
- **ESM only, Node 26 or newer.** There is no CommonJS build and no UMD bundle. `require()` of the package works on Node 26.
- **`drift.form(key, options)` replaces the `(formKey, ...)` methods.** It returns a typed handle with `getState`, `subscribe`, `setValue`, `submit`, `reset`, `onSubmit` and the rest. `registerSchema`, `unregisterSchema`, `getForm`, `resetForm`, `validateField`, `validateForm`, `getErrors`, `getAllErrors`, `isTouched`, `isDirty`, `isFormDirty`, `getAllForms` and `subscribeAll` are gone. Use `drift.getForms()` and the handle.
- **Validators return a message, a list of issues or `undefined`.** `{ success, errors }` is gone, and a validator that still returns it fails closed with `validatorErrorMessage`. A validator gets `{ name, values, signal }` as its second argument, and submit runs every field validator.
- **Config is renamed and trimmed.** `defaultValidateOn` is `validateOn` and defaults to `'submit'`, and `{ debounce }` is `{ debounceMs }`. `formAttribute`, `hiddenAttribute` and `nestedAttribute` are `attributePrefix`, `data-drift-hidden` is `data-drift-ignore`, and `observerDebounce` is gone.
- **Persistence is opt-in per form, from code.** Use `drift.form(key, { persist: true })`. `DriftConfig.persist` holds only the storage settings, and a `data-drift-persist` attribute on a form does nothing and logs a development warning.
- **Persistence stores less.** Values only, one `drift:<formKey>` entry per form, dropped after `maxAgeMs` (one day by default). Files, `password` and `hidden` inputs, payment and one-time-code `autocomplete` fields and `data-drift-persist="off"` fields are never stored. Creating a `Drift` removes the old `drift-form-state` key.
- **`submit()` resolves a `SubmitResult`.** Check `result.status === 'submitted'`. A handler that throws gives `failed`, handlers get `(values, { formKey, signal })`, and `canSubmit` is `status === 'idle' && isValid`.
- **Form state is reshaped.** `status` replaces `isSubmitting` and `isValidating`, `validating` replaces `validatingFields`, and `submitCount` replaces `hasBeenValidated`. `initialValues` leaves the state, and `formErrors` is new. `errors`, `touched`, `dirty` and `validating` have no prototype.
- **Event payloads are typed.** Each event has its own payload with no `type`, `fieldName` is `name`, and the `'*'` wildcard and `off()` are removed. Use the function `on()` returns.
- **Programmatic `.value` and `.checked` writes are not tracked.** Use `form.setValue`, or pass `trackProgrammaticChanges` from `@zerosumstudio/drift/track`.
- **Field values change.** An empty number is `null` and not `NaN`, an empty date or time is `''`, a file input is `File[]`, and checkboxes that share a name are a `string[]`.
- **Exports are removed.** `DriftStore`, `SchemaRegistry`, `DriftEventEmitter`, `getInputValue`, `setInputValue`, `isEmpty`, `getInputs`, `isInDOM`, `isHidden`, `parseFieldName` and the nested-value helpers. The `Drift*` types are renamed, see the migration guide.

### Added

- **Standard Schema.** Pass zod, valibot or any other Standard Schema as `validate` on a form or a field. Issue paths map to field names, and `onSubmit` receives the schema's output with its type.
- **`validate: 'native'`.** Uses the browser's constraint validation, and sets `novalidate` on the whole form.
- **`aria: true`.** Sets `aria-invalid`, fills `data-drift-error="<name>"` slots, links them with `aria-describedby` and focuses the first invalid field after a failed submit.
- **Native submit pass-through.** A valid form with no handler submits natively, keeping `action` and the submitter's name and value.
- **`unsetValue(name)`, `validate(name?)`, `drift.scan()`, `drift.clearPersisted()` and `drift.getForms()`.**
- **`persist` settings.** `storage`, `keyPrefix`, `version`, `maxAgeMs` and `migrate`.
- **`validatorErrorMessage`, `DriftError` and the `error` event.** Failures in validators, handlers, storage and registration reach `error` with a `phase`.

### Changed

- **Drift reconciles the nodes that changed.** One set of listeners sits on the observed root, moves and attribute changes are followed, and a busy page can't starve registration.
- **A form exists before its element.** `drift.form(key)` can be called first, and values set for a name with no element are written into it when it appears.
- **Dirty compares to the initial value.** Typing the initial value back clears it.
- **Reset restores HTML defaults** where there are no `initialValues`.
- **Disabled fields and button inputs are not tracked.**
- **`disconnect()` clears listeners, timers and in-flight runs.** Values are kept for a later `observe()`.
- **Size.** The bundle is 9.04 kB brotli, and `./track` is 318 B.

### Fixed

- Listeners no longer stack as fields come and go.
- A stale validation result can't overwrite a newer one, and a validator that throws can't leave the form stuck.
- A submit handler sees the values as they were after validation.
- A persisted entry that is malformed, expired or from another version is dropped instead of breaking `observe()`, and a stored value no longer replaces a server-rendered one.
- A field named after a form method (`getAttribute`, `closest`) no longer breaks the form.

Versions below were published as `@bkincz/drift`.

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
