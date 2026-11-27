# Migrating from `@bkincz/drift` 1.4 to `@zerosumstudio/drift` 1.0

1.0 is the first release under `@zerosumstudio`. Drift still tracks forms and fields by their presence in the DOM, and `data-drift-form` still defines a form. What changed is how you configure and read one: `drift.form(key, options)` returns a typed handle, and it replaces every `drift.method(formKey, ...)` call. There is no compatibility layer, so every change below is yours to make. Most are mechanical, and the type checker finds the rest.

This guide covers `@bkincz/drift` 1.4.0. Older versions need the 1.4 changes first.

## Checklist

Work through these in order.

1. Install `@zerosumstudio/drift`, remove `@bkincz/drift`, and change every import. Use Node 26 or newer.
2. Replace `registerSchema(key, schema)` with `const form = drift.form(key, options)`, and call `form.method(...)` where you called `drift.method(key, ...)`. See [the handle](#the-form-handle).
3. Rewrite validators. They return a message, a list of issues or `undefined`, not `{ success, errors }`. A validator left in the old shape fails every submit. See [validators](#validators).
4. Rename config and types: `defaultValidateOn` is `validateOn`, `{ debounce }` is `{ debounceMs }`, and `data-drift-hidden` is `data-drift-ignore`. See [config](#config-and-attributes) and [types](#types-and-removed-exports).
5. Move `persist: true` to the forms that need it, as `drift.form(key, { persist: true })`. See [persistence](#persistence).
6. Update event listeners: `fieldName` is `name`, there is no `type` on the payload, and `off()` is gone. See [events](#events).
7. Replace `submit()` results that you read as a `boolean`. See [submit](#submit-and-reset).
8. If you set `input.value` from code, use `form.setValue`, or pass the `./track` tracker. See [programmatic changes](#programmatic-changes).
9. Run the type checker and your tests. Then check [behaviour changes](#behaviour-changes) against what your forms rely on.

## Package and runtime

| 1.4                                 | 1.0                                                                                    |
| ----------------------------------- | -------------------------------------------------------------------------------------- |
| `@bkincz/drift`                     | `@zerosumstudio/drift`. `@bkincz/drift` stays on npm at 1.4.0                          |
| ESM and CommonJS, plus a UMD bundle | ESM only. `require()` of the package works on Node 26. Load the ESM build in a browser |
| Node 22.12 or newer                 | Node 26 or newer (`engines.node` is `>=26`)                                            |
| One entry                           | `@zerosumstudio/drift` and `@zerosumstudio/drift/track`                                |

Jest setups that transform to CommonJS need `transformIgnorePatterns` to let the package through.

## The form handle

`drift.form(key, options)` returns a handle for the form with that key. The same key returns the same handle, calling it again with options replaces them, and calling it before the element exists is fine: the record is there, and the DOM fills it in when the element appears. The handle configures and reads a form the DOM defines. It never adds a field.

```ts
// 1.4
drift.registerSchema('profile', { validate, fields })
drift.setInitialValues('profile', { name: '' })
drift.subscribe('profile', state => render(state))
drift.onSubmit('profile', async (values, formKey) => save(values))
await drift.submit('profile')

// 1.0
const profile = drift.form('profile', { validate, fields, initialValues: { name: '' } })
profile.subscribe(state => render(state))
profile.onSubmit(async (values, { formKey }) => save(values))
await profile.submit()
```

| 1.4                                                              | 1.0                                                                                       |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `registerSchema(key, { validate, fields })`                      | `drift.form(key, { validate, fields })`                                                   |
| `unregisterSchema(key)`                                          | There is none. Call `drift.form(key, {})` to drop the validators                          |
| `getForm(key)`                                                   | `form.getState()`. It always returns a state, with empty values for a new form            |
| `getValue`, `setValue`, `setValues`, `setInitialValues`          | The same names on the handle, without the key                                             |
| `setErrors`, `clearErrors`, `submit`, `onSubmit`, `onReset`      | The same names on the handle, without the key                                             |
| `resetForm(key)`                                                 | `form.reset()`                                                                            |
| `validateField(key, name)`, `validateForm(key)`                  | `form.validate(name)` and `form.validate()`. Both resolve a `boolean`                     |
| `getErrors(key, name)`, `getAllErrors(key)`                      | `form.getState().errors[name]` and `.errors`                                              |
| `isTouched(key, name)`, `isDirty(key, name)`, `isFormDirty(key)` | `.touched[name]`, `.dirty[name]` and `.isDirty` on `getState()`                           |
| `subscribe(key, callback)`                                       | `form.subscribe(callback)`. It doesn't call back on subscribe, so read `getState()` first |
| `getAllForms()`                                                  | `drift.getForms()`, a `Map` of every form's state by key                                  |
| `subscribeAll(callback)`                                         | `form.subscribe` on each form, or `drift.on('field:change', ...)`                         |
| `observe(element)`, `disconnect()`                               | The same, and `disconnect()` also clears timers and in-flight runs                        |

Each handle method is bound, so `form.subscribe` and `form.getState` can be passed as they are, for example to `useSyncExternalStore`.

`onSubmit` and `onReset` still take one handler each, and a later one replaces the earlier. The function they return now removes only its own handler.

New on the instance: `drift.scan()` applies pending DOM changes now, which replaces waiting on `observerDebounce`, and `drift.clearPersisted()` clears stored drafts.

## Validators

```ts
// 1.4
fields: {
	email: {
		validate: value => ({
			success: isEmail(value),
			errors: isEmail(value) ? undefined : { email: ['Invalid email'] },
		}),
	},
	password: {
		validate: (value, all) =>
			value !== all.confirm
				? {
						success: false,
						errors: { password: ['Passwords differ'], confirm: ['Passwords differ'] },
					}
				: { success: true },
	},
}

// 1.0
fields: {
	email: { validate: value => (isEmail(value) ? undefined : 'Invalid email') },
	password: {
		validate: (value, { values }) =>
			value === values.confirm
				? undefined
				: [{ message: 'Passwords differ' }, { message: 'Passwords differ', name: 'confirm' }],
	},
}
```

| 1.4                                           | 1.0                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Return `{ success, errors? }`                 | Return a message, a list of `{ message, name? }` issues, or `undefined` for valid                       |
| Second argument is all values                 | Second argument is `{ name, values, signal }`. A form validator gets `(values, { signal })`             |
| Errors are keyed by field name                | An issue's `name` defaults to the field being validated. Pathless form issues are in `state.formErrors` |
| Only the form-level `validate` ran on submit  | Submit runs every field validator and the form validator                                                |
| No validator ran until the field had an error | `validateOn` defaults to `'submit'`, and a field with errors still revalidates on change                |

A validator that returns the 1.4 shape (`{ success: true }`) throws a `TypeError` inside drift, so the field gets `validatorErrorMessage` (`'Could not validate this field.'`) and the form can't submit. If a form stops submitting after the upgrade, check its validators first.

A Standard Schema replaces a validator. `validate: schema` works on a form, and `fields: { name: { validate: schema } }` on a field. Drift maps the schema's issue paths to field names, and `onSubmit` receives the schema's parsed output with its type. `validate: 'native'` uses the browser's constraint validation, and it turns off browser validation for the whole form.

### Replacing a zod adapter

A zod adapter that turns `safeParse` issues into drift errors can go. The schema itself is the validator:

```ts
// 1.4
const toFieldName = (path: readonly PropertyKey[]) =>
	/* join path into `items[0].name` */
	drift.registerSchema('signup', {
		validate: values => {
			const result = schema.safeParse(values)

			return result.success
				? { success: true }
				: { success: false, errors: collect(result.error.issues) }
		},
	})

// 1.0
const signup = drift.form('signup', { validate: schema })

signup.onSubmit(values => {
	values.email // typed from the schema's output
})
```

Drift builds field names from issue paths in the same format (`items[0].name`), so `toFieldName` has no job left. For a per-field schema, use `fields: { email: { validate: schema.shape.email } }`. The schema sees the values as the DOM holds them, so an empty number input is `null` and a checkbox group is `string[]`. A schema that expects `NaN`, or a boolean for a group, needs to change.

## Config and attributes

| 1.4                                                   | 1.0                                                                                                                                |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `defaultValidateOn`                                   | `validateOn`. With nothing set, fields validate on submit                                                                          |
| `validateOn: { debounce: 300 }`                       | `validateOn: { debounceMs: 300 }`                                                                                                  |
| `formAttribute`, `hiddenAttribute`, `nestedAttribute` | `attributePrefix` (default `data-drift`), which gives `-form`, `-ignore`, `-persist` and `-error`. `nestedAttribute` had no effect |
| `data-drift-hidden`                                   | `data-drift-ignore`. It also excludes everything inside the element                                                                |
| `observerDebounce`                                    | Removed. Drift reconciles each mutation as it arrives, and `drift.scan()` does it on demand                                        |
| `persist: true`                                       | `persist` holds storage settings, and `drift.form(key, { persist: true })` turns it on                                             |

New config: `aria`, `trackProgrammaticChanges` and `validatorErrorMessage`.

```ts
// 1.4
const drift = new Drift({ defaultValidateOn: 'blur', observerDebounce: 32 })

// 1.0
const drift = new Drift({ validateOn: 'blur' })
```

## Persistence

1.4 stored every form's whole state under one `drift-form-state` key when `persist: true`, passwords and card numbers included, and a stored value beat a server-rendered one. 1.0 stores less, only where code asks, and never the fields below.

| 1.4                                                   | 1.0                                                                                                                                                      |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `new Drift({ persist: true })` stores every form      | `drift.form(key, { persist: true })` stores that form. Nothing else does                                                                                 |
| `persist` was a boolean in the config                 | `DriftConfig.persist` is `{ storage, keyPrefix, version, maxAgeMs, migrate }`, the settings only                                                         |
| `data-drift-persist` was not a thing                  | The attribute on a form does nothing, and logs one warning in development                                                                                |
| The whole state was stored, flags and errors included | Values only. Dirty comes back from the values                                                                                                            |
| One key, `drift-form-state`                           | One entry per form, `drift:<formKey>`, with a version and a date. `keyPrefix` changes `drift`                                                            |
| Everything was stored                                 | A fixed denylist is never stored: files, `password` and `hidden` inputs, payment and one-time-code `autocomplete` tokens, and `data-drift-persist="off"` |
| Entries had no expiry                                 | `maxAgeMs` defaults to one day                                                                                                                           |
| `data-drift-hidden` kept a field out of storage       | `data-drift-persist="off"` on the field. `data-drift-ignore` stops tracking altogether                                                                   |
| A stored value beat the DOM                           | A non-empty DOM value wins, then the form's state, then the stored value                                                                                 |

Creating a `Drift` removes the old `drift-form-state` key from `localStorage`, so upgraded users don't keep it. Nothing reads that blob, so an app that wants to keep a draft across the upgrade must save it itself.

A form that was persisted by the config flag now needs the option, and one that leaves it out stops being stored:

```ts
// 1.4
const drift = new Drift({ persist: true })

// 1.0
const drift = new Drift()

drift.form('checkout', { persist: true })
```

Options replace each other, so a later `drift.form(key, options)` has to pass `persist: true` again. `drift.form(key)` with no options leaves everything as it is.

What is stored is plain text on the device. Call `drift.clearPersisted()` on sign-out. See [Persisting drafts](../README.md#persisting-drafts).

## Events

An event is now a typed payload for its type, and `drift.on(type, listener)` returns the function that removes it.

```ts
// 1.4
drift.on('field:change', event => log(event.type, event.formKey, event.fieldName, event.value))
drift.off('field:change', listener)

// 1.0
const stop = drift.on('field:change', ({ formKey, name, value, source }) =>
	log(formKey, name, value),
)

stop()
```

| 1.4                                              | 1.0                                                                                                |
| ------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `{ type, formKey, fieldName?, value?, errors? }` | Each type has its own payload, with no `type` field. See the README's event table                  |
| `fieldName`                                      | `name`                                                                                             |
| `errors` on an event                             | Gone. `validation:end` carries `isValid`, and the errors are in `getState()`                       |
| `drift.off(event, listener)`                     | Removed. Call the function `on` returned                                                           |
| `on(event: string, ...)` and a `'*'` wildcard    | `on` takes the event names only. There is no wildcard                                              |
| No event for failures                            | `error` has `{ formKey, name?, phase, error }`, for validators, handlers, storage and registration |
| A listener that throws                           | It is logged and the other listeners still run                                                     |

`field:change` carries `source`, `'user'` for typing and `'api'` for `setValue` and tracked writes. `submit:end` carries the `SubmitResult`.

## Submit and reset

```ts
// 1.4
const ok = await drift.submit('login')

if (ok) navigate()

// 1.0
const result = await login.submit()

if (result.status === 'submitted') navigate()
```

| 1.4                                                    | 1.0                                                                                                                        |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- |
| `submit()` resolves a `boolean`                        | It resolves `{ status: 'submitted', values }`, `{ status: 'invalid' }` or `{ status: 'failed', error }`, and never rejects |
| A throwing handler is logged, and the result is `true` | The result is `failed`, and the `error` event fires with `phase: 'submit'`                                                 |
| The handler is `(values, formKey)`                     | `(values, { formKey, signal })`. The `signal` aborts on reset and disconnect                                               |
| Values were read before validation                     | They are read after it, and validation repeats up to three passes if they change meanwhile                                 |
| Calls made during a submit each ran the handler        | They share one run                                                                                                         |
| A valid native submit with no handler was swallowed    | It submits natively, with `action`, `method` and the submitter's `name` and `value`                                        |
| A native reset blanked the fields                      | It restores `initialValues` where given, and the HTML defaults otherwise                                                   |
| `canSubmit` was `hasBeenValidated && isValid`          | `status === 'idle' && isValid`. A fresh form can submit                                                                    |

A double click is the app's to guard. Firefox double-submits a handler-less native form by itself.

## Form state

| 1.4                                                  | 1.0                                                                                         |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `isSubmitting`, `isValidating`                       | `status`: `'idle'`, `'validating'` or `'submitting'`                                        |
| `validatingFields: { a: false }`                     | `validating`, which lists only fields with a run in flight                                  |
| `hasBeenValidated`                                   | Gone. Use `submitCount > 0` for "show errors after the first attempt"                       |
| `initialValues`                                      | Gone from state. Pass `initialValues` to `form()` or call `setInitialValues`                |
| `touched` and `dirty` were `Record<string, boolean>` | They hold `true` for a touched or dirty field, and a field that is neither has no entry     |
| `errors` were `Record<string, string[]>`             | `Record<string, readonly string[]>`, plus `formErrors` for messages that belong to no field |
| New                                                  | `values`, `submitCount`, `isDirty` and `isValid` are read from the snapshot                 |

`errors`, `touched`, `dirty` and `validating` have no prototype. A call like `errors.hasOwnProperty(name)` throws, so write `name in errors` or `Object.hasOwn(errors, name)`. `Object.keys`, spreading and `JSON.stringify` work as before. `values` is an ordinary frozen object, and so is the object `onSubmit` receives, which is a mutable copy.

`setInitialValues` takes the nested shape only. `{ 'user.name': 'Alice' }` becomes `{ user: { name: 'Alice' } }`.

## Programmatic changes

1.4 replaced the `value` and `checked` setters on every field so that `input.value = x` was noticed. That also replaced React's own value tracker, so React fired `onChange` for its own writes. 1.0 doesn't touch the properties unless you ask.

```ts
// 1.4: input.value = 'x' was tracked

// 1.0: write through drift
form.setValue('email', 'x')

// 1.0: or opt in to tracking
import { trackProgrammaticChanges } from '@zerosumstudio/drift/track'

const drift = new Drift({ trackProgrammaticChanges })
```

The tracker covers `value` and `checked`, and not `select.selectedIndex` or `option.selected`. With React, use uncontrolled inputs (`defaultValue`) and let drift own the values. In Vue and Svelte, don't use `v-model` or `bind:value` on a drift field.

## Values and field kinds

| 1.4                                         | 1.0                                                                                         |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- |
| An empty number or range input gives `NaN`  | `null`                                                                                      |
| An empty date or time input gives `null`    | `''`                                                                                        |
| A file input's value is a live `FileList`   | `File[]`. `setValue` accepts `[]` or `null` to clear it, and throws a `TypeError` otherwise |
| Checkboxes with one name give one `boolean` | Two or more, or a name ending in `[]`, give a `string[]` of checked values                  |

## Behaviour changes

- **Validation is explicit.** Nothing validates until `validateOn` says so, and submit validates everything. A form that only had field validators can no longer submit with an untouched invalid field.
- **Browser validation.** A `required` or `type="email"` field still stops a submit in the browser before drift runs. Set `validate: 'native'` to have drift show those messages. It sets `novalidate` on the form.
- **`disconnect()`** removes listeners, timers and in-flight runs, and keeps the values, so a later `observe()` restores them.
- **`observe()`** throws a `DriftError` (`NO_DOM` or `NO_BODY`) when there is no `document` or `<body>`. Creating a `Drift` and calling `form()` no longer touch the DOM, so they run on the server.
- **Disabled fields** and `submit`, `button`, `reset` and `image` inputs are not tracked. A disabled field keeps its value, like a removed one.
- **Setting a value for a name with no element** keeps it in state. It is written into the element when one appears, and never creates a field.

## Types and removed exports

| 1.4                                                  | 1.0                                                                                      |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `DriftFormState`                                     | `FormState`                                                                              |
| `DriftSchema`, `DriftFieldSchema`                    | `FormOptions`, `FieldOptions`. `SchemaFormOptions` for a form with a schema              |
| `ValidationResult`                                   | `ValidateResult`, with `Issue`, `FieldValidator`, `FormValidator` and `ValidatorContext` |
| `DriftSubmitHandler`, `DriftResetHandler`            | `SubmitHandler`, `ResetHandler`                                                          |
| `DriftEventType`, `DriftEvent`, `DriftEventListener` | `keyof DriftEventMap` and `DriftEventMap[T]`                                             |
| `ValidationTrigger`, `DriftConfig`                   | The same names, with new shapes                                                          |
| `DriftStateCallback`                                 | `(state: FormState) => void`                                                             |
| `DriftInputElement`                                  | `HTMLInputElement \| HTMLTextAreaElement \| HTMLSelectElement`. It isn't exported        |
| `DriftState`, `DriftFieldMeta`, `DriftFormMeta`      | Removed                                                                                  |
| `DriftStoreConfig`, `DriftStoreListener`             | Removed                                                                                  |

New types: `FormHandle`, `FormOutput`, `FormStatus`, `SubmitResult`, `Values`, `DeepReadonly`, `PersistConfig`, `PersistStorage`, `DriftErrorCode`, `ErrorPhase`, `ProgrammaticTracker`, `StandardSchemaV1` and `InferSchemaOutput`. `DriftError` is a new class export.

Removed classes and helpers:

| Export                                                                    | Use instead                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------- |
| `DriftStore`                                                              | `drift.form(key).getState()` and `subscribe`      |
| `SchemaRegistry`                                                          | `drift.form(key, options)`                        |
| `DriftEventEmitter`                                                       | `drift.on(type, listener)`                        |
| `getInputValue`, `setInputValue`, `isEmpty`                               | `form.getValue(name)` and `form.setValue`         |
| `getInputs`, `isHidden`                                                   | None. Drift decides which elements are fields     |
| `isInDOM`                                                                 | `element.isConnected`                             |
| `parseFieldName`, `setNestedValue`, `getNestedValue`, `deleteNestedValue` | `form.getValue(name)` and `form.unsetValue(name)` |

## Consumers

The two known consumers need these edits.

### apex `fold`

`src/sections/header/forms/preset.form.tsx` uses `registerSchema`, `subscribe`, `getForm`, `setInitialValues`, `resetForm`, `onSubmit`, `submit`, `unregisterSchema`, and the `form:register` and `submit:start` events.

- Create the handle once with its options. The record exists before the element, so the `form:register` listener that called `setInitialValues` and `resetForm` is not needed:

    ```ts
    const preset = drift.form(FORM_KEY, {
    	validate: createNewPresetSchema(existingPresets),
    	initialValues: { name: '' },
    })
    ```

- Write `createNewPresetSchema` in the new validator shape, or hand it a Standard Schema.
- `hasAttempted` becomes `state.submitCount > 0`, `isSubmitting` becomes `state.status === 'submitting'`, and `validatingFields.name` becomes `validating.name`.
- `drift.submit(FORM_KEY)` becomes `preset.submit()`, and `drift.subscribe(FORM_KEY, cb)` becomes `preset.subscribe(cb)`.
- Teardown uses the unsubscribe functions that `subscribe`, `on` and `onSubmit` return. Replace `unregisterSchema` with `drift.form(FORM_KEY, {})` if the validators must go.
- `src/lib/validation.ts` imports `DriftSchema` and `ValidationResult`, which become `FormOptions` and `ValidateResult`. Its validators return a message or `undefined`.
- The `name` input is already uncontrolled (`defaultValue=""`), which is what 1.0 wants from React.

### MMW `packages/forms`

`src/drift.ts`, `src/hooks.ts` and `src/zod.ts` use `defaultValidateOn`, `subscribeAll`, `getForm`, `registerSchema`, `unregisterSchema`, `onSubmit` and the 1.4 types.

- `src/drift.ts` keeps its `DOMContentLoaded` wrapper, because `observe()` still needs a body, and changes `defaultValidateOn: 'blur'` to `validateOn: 'blur'`.
- `src/zod.ts` goes. Zod implements Standard Schema, so `drift.form(key, { validate: schema })` replaces `zodSchema(schema)`, and `fields: { name: { validate: schema.shape.name } }` replaces `zodField`. Per-field `validateOn` overrides move into `fields`.
- `useDriftForm(formKey)` becomes a hook over a handle: `useSyncExternalStore(form.subscribe, form.getState, form.getState)`. A snapshot is always there, so the `UNREGISTERED` constant and `registered: form !== undefined` have no counterpart. To know whether the element is in the DOM, listen for `form:register` and `form:unregister`. `isSubmitting` becomes `status === 'submitting'`, `validatingFields` becomes `validating`, and a fresh form has `canSubmit: true`.
- `useDriftSchema` calls `drift.form(formKey, options)` in its effect. Drop the `unregisterSchema` cleanup, or use `drift.form(formKey, {})` there.
- `useDriftSubmit` becomes `form.onSubmit((values, { formKey }) => latest.current(values, formKey))`, which returns the unsubscribe.
- The submit result is a `SubmitResult`, so `submit(): Promise<boolean>` in `UseDriftFormResult` changes.
- `DriftFormState`, `DriftSchema`, `DriftFieldSchema`, `DriftSubmitHandler`, `ValidationResult` and `ValidationTrigger` follow the [types table](#types-and-removed-exports).
- Its `engines.node` of `>=22.12.0` needs to be `>=26`, as does the CI that installs it.

The full list of changes is in the [changelog](../CHANGELOG.md).
