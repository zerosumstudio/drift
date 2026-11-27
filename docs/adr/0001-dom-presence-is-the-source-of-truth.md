# 1. DOM presence is the source of truth, with the form handle on top

Status: accepted

## Context

Drift's identity is that it follows forms and fields by their presence in the DOM, with no registration code. 1.4 did that with per-field listeners that were never removed, a debounced rescan of every form, and form state that only existed once an element did. That caused stacked listeners, starved registration, dropped calls made before the element existed, and a class of leaks.

A typed way to configure a form (validators, a schema, initial values) and to read its state is still needed, and it must not turn into a second way to define fields.

## Decision

- Forms and fields exist because elements are in the DOM. `data-drift-form` defines a form, and an input with a `name` inside it defines a field. Nothing else adds a field.
- `drift.form(key, options)` returns a handle that configures and reads the form the DOM defines. Calling it before the element exists only creates the record that the DOM later fills. A value set for a name with no element is held in state and is written into the element when one appears, but it never creates a field, a dirty entry or a touched entry.
- One set of listeners sits on the observed root, on one `AbortController`. A `WeakMap` maps `event.target` to its record, and a target that isn't in the map is ignored. Calling `observe()` again, or `disconnect()`, aborts the old signal.
- The observer reconciles only the nodes that changed, including attribute changes and moves, by comparing each element's owner (`closest('[data-drift-form]')`, kept inside the root and out of `[data-drift-ignore]`) with the recorded one. There is no debounce, and `drift.scan()` applies pending records on demand.
- Programmatic `.value` and `.checked` writes are not tracked unless the app passes `trackProgrammaticChanges` from `@zerosumstudio/drift/track` in the config. 1.4 patched every field's property setter, which replaced React's own value tracker and made React fire `onChange` for its own writes. The tracker wraps an element's own descriptor if it has one and restores it when the field is unregistered.
- Calls that can land on a form element go through the prototypes (`src/dom.ts`), because a form exposes its fields as named properties that shadow its own methods.
- The DOM wins on a value conflict: a non-empty DOM value beats state, state beats a stored value, and an empty DOM value is recorded last.

## Consequences

- Nothing can stack, and a removed field is released while its value is kept.
- Tests and "insert, then read" code call `scan()` instead of waiting for the observer.
- Frameworks that own field values must leave them to drift: uncontrolled inputs in React, no `v-model` or `bind:value` on a drift field.
