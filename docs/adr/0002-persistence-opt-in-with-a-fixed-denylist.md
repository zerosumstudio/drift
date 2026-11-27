# 2. Persistence is opt-in per form, from code only, with a fixed denylist

Status: accepted

## Context

In 1.4 one config flag stored the whole state of every form under one key, trusted it on load, and let a stored value beat a server-rendered one. That stored passwords, card numbers, CVCs, one-time codes and CSRF tokens, brought stale flags back, crashed `observe()` on a malformed entry, and let a stale CSRF token replace the fresh one.

## Decision

- Only a form that code enables is stored: `drift.form(key, { persist: true })`. The `data-drift-persist` attribute on a form enables nothing, because markup is the one thing an attacker who can inject HTML controls. Injected markup could otherwise claim a form key, point its `action` elsewhere and receive the stored draft. The `persist` config only supplies the storage settings (`storage`, `keyPrefix`, `version`, `maxAgeMs`, `migrate`). Options replace each other, so a later `form()` call has to pass `persist: true` again.
- Values only. Errors, flags, touched, dirty and initial values are never stored, because dirty is derived from values.
- The denylist is fixed and has no override: file inputs, `type="password"` and `type="hidden"`, any `autocomplete` token list containing `cc-number`, `cc-csc`, `cc-exp`, `cc-exp-month`, `cc-exp-year`, `cc-name`, `cc-given-name`, `cc-additional-name`, `cc-family-name`, `cc-type`, `one-time-code`, `current-password` or `new-password`, and a field with `data-drift-persist="off"` (or `false`, in any case and with spaces around it, on the field only). An element that has been denied once stays denied for its lifetime, so toggling a password input to `type="text"` can't make it storable, and a newly denied field has its stored value dropped on the next write.
- One versioned entry per form: `drift:<formKey>` holds `{ v, savedAt, values }`. On load, an entry that doesn't have that shape, is older than `maxAgeMs` (one day by default), is dated in the future, or has a different version without a `migrate` is removed. A `migrate` that throws is reported through the `error` event and the entry is kept, so a fixed `migrate` can still read it.
- Restoring is per field, at registration, and a stored value is used only if it has the field kind's type and its options exist. A non-empty DOM value wins over a stored one.
- Writes are debounced by 100 ms and flushed on `pagehide` and when the page becomes hidden. The entry is cleared after a successful submit and on reset, and `clearPersisted()` clears one form or every key under the prefix.
- In development, a form carrying `data-drift-persist` logs one warning that it does nothing and points at `drift.form(key, { persist: true })`. The check is `process.env.NODE_ENV !== 'production'` inside a `try`, so bundlers strip it and a page with no bundler counts as development.
- A storage failure is reported once through the `error` event, and the form keeps working in memory.

## Consequences

- What is left, such as names, addresses and emails, is PII in plain text on the device. The README says so, and apps should only opt in forms where a lost draft costs more than that and call `clearPersisted()` on sign-out.
- 1.4 kept every form under one `drift-form-state` key, including passwords and card numbers. Creating a `Drift` removes that key (wrapped in `try`, and skipped where there is no `window`), so upgraded users don't keep it.
- Apps that need to keep a draft across the upgrade must save it themselves, since nothing reads the old blob.
