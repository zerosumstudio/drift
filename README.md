# <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zerosumstudio/drift/main/.github/assets/zerosum-on-dark.png"><img src="https://raw.githubusercontent.com/zerosumstudio/drift/main/.github/assets/zerosum-on-light.png" alt="" height="32"></picture> drift

[![npm version](https://badge.fury.io/js/@zerosumstudio%2Fdrift.svg)](https://badge.fury.io/js/@zerosumstudio%2Fdrift)
[![Release](https://github.com/zerosumstudio/drift/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/zerosumstudio/drift/actions/workflows/release.yml)
[![codecov](https://codecov.io/gh/zerosumstudio/drift/branch/main/graph/badge.svg)](https://codecov.io/gh/zerosumstudio/drift)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A DOM-driven form library that tracks forms and fields by their presence in the DOM. The markup defines the form: put `data-drift-form` on an element and every named input inside it is a field, for as long as it is in the DOM. There is no registration code and no per-field binding. `drift.form(key, options)` configures and reads a form the DOM defines, with validators, a schema, initial values and typed state. It never defines fields itself.

Coming from `@bkincz/drift` 1.4? See the [migration guide](./docs/migration-1.0.md).

## Install

```bash
pnpm add @zerosumstudio/drift
```

Requires Node 26 or newer, and the package is ESM-only. It has no dependencies and no peers.

Up to 1.4.0 this was published as `@bkincz/drift`.

## Quick start

```html
<form data-drift-form="signup">
	<input name="email" type="email" />
	<input name="password" type="password" />
	<button type="submit">Sign up</button>
</form>
```

```ts
import { Drift } from '@zerosumstudio/drift'

const drift = new Drift()

const signup = drift.form('signup', {
	fields: {
		email: { validate: value => (String(value).includes('@') ? undefined : 'Enter an email') },
	},
})

signup.onSubmit(async values => {
	await fetch('/api/signup', { method: 'POST', body: JSON.stringify(values) })
})

drift.observe() // starts at document.body, so call it once the body exists
```

`signup.subscribe(listener)` hears every change to the form's state, and `signup.getState()` reads it. The same key always returns the same handle, and calling `drift.form('signup')` before the element exists is fine: the record is there, and the DOM fills it in when the form appears.

## How drift finds forms

`data-drift-form="<key>"` marks a form, on a `<form>` or on any other element. An `input`, `textarea` or `select` with a `name` inside it is a field. An input inside a nested `data-drift-form` belongs to the nested form, and a key used on two elements belongs to the first.

Drift does not track:

- fields that are disabled or have no `name`
- `submit`, `button`, `reset` and `image` inputs
- anything inside an element with `data-drift-ignore`

It follows the DOM as it changes. A field added, removed, renamed, disabled or moved to another form is picked up from the mutation, and `drift.scan()` applies pending changes right away, which is what tests and "insert, then read" code want.

A field that leaves the DOM is released, but its value stays in the form's state. When it comes back, a non-empty DOM value wins, then the value in state, then a persisted one.

Only a native `<form>` fires `submit` and `reset`. On any other element, call `form.submit()` and `form.reset()` yourself.

`drift.observe(root)` takes an element, and with no argument it uses `document.body`. It throws a `DriftError` with code `NO_DOM` when there is no `document`, and `NO_BODY` before `<body>` exists, so call it after `DOMContentLoaded` or from a module script. Creating a `Drift` and calling `form()` touch nothing in the DOM, so both run on the server. `drift.disconnect()` removes the listeners, timers and in-flight runs, and keeps the values for a later `observe()`.

### Configuration

```ts
const drift = new Drift({ validateOn: 'blur', aria: true })
```

| Option                     | Description                                                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `attributePrefix`          | Prefix of every attribute drift reads. Defaults to `data-drift`, giving `-form`, `-ignore`, `-persist` and `-error` |
| `validateOn`               | When field validators run, for fields and forms that don't set their own. Defaults to `'submit'`                    |
| `persist`                  | Storage settings for [persisted forms](#persisting-drafts). It doesn't turn persistence on                          |
| `aria`                     | Wires `aria-invalid` and error slots. Defaults to `false`, see [accessibility](#accessibility)                      |
| `trackProgrammaticChanges` | Passes in the tracker from `@zerosumstudio/drift/track`. Off unless passed                                          |
| `validatorErrorMessage`    | The error shown when a validator throws. Defaults to `'Could not validate this field.'`                             |

### Form options

`drift.form(key, options)` takes these, and calling it again with options replaces them all. `drift.form(key)` with no options only returns the handle.

| Option          | Description                                                                          |
| --------------- | ------------------------------------------------------------------------------------ |
| `validate`      | A form validator, a Standard Schema, or `'native'`                                   |
| `fields`        | Per-field options by field name: `validate`, `validateOn` and `transform`            |
| `validateOn`    | The trigger for this form's fields                                                   |
| `initialValues` | The nested starting values. Seeded fields are not dirty, and `reset()` restores them |
| `persist`       | `true` stores this form's values. Defaults to `false`                                |

`transform` runs on user input and `setValue` before the value is stored, for example `value => String(value).trim().toLowerCase()`.

## Field kinds

Each kind of field has its own value type, and an empty value that is the same every time.

| Field                                                | Value            | Empty   |
| ---------------------------------------------------- | ---------------- | ------- |
| text-like inputs, `textarea`, date and time inputs   | `string`         | `''`    |
| `number`, `range`                                    | `number \| null` | `null`  |
| one `checkbox`                                       | `boolean`        | `false` |
| two or more checkboxes with one name, or a `[]` name | `string[]`       | `[]`    |
| `radio` group                                        | `string \| null` | `null`  |
| `select`                                             | `string`         | n/a     |
| `select multiple`                                    | `string[]`       | `[]`    |
| `file`                                               | `File[]`         | `[]`    |

An empty number input is `null`, never `NaN`. A group of checkboxes is the list of the checked values, in DOM order:

```html
<input type="checkbox" name="tags" value="a" checked />
<input type="checkbox" name="tags" value="b" />
<input type="checkbox" name="tags" value="c" checked />
```

```ts
signup.getValue('tags') // ['a', 'c']
signup.setValue('tags', ['b']) // checks b, unchecks the rest
```

A file input is read-only. `setValue` accepts `[]` or `null` to clear it, and throws a `TypeError` before changing anything for anything else. Files are never persisted.

Checkboxes and radios that share a name are one field. Mixing input kinds under one name, or repeating a name on anything else, skips the later element.

## Nested names

Dots and indexes in `name` build nested values. A name ending in `[]` marks an array field.

```html
<input name="user.address.city" />
<input name="items[0].name" />
<input name="items[1].name" />
```

```ts
signup.getState().values
// { user: { address: { city: '' } }, items: [{ name: '' }, { name: '' }] }
```

Error, touched and dirty maps use the same names (`errors['items[0].name']`). A name that is malformed, uses `__proto__`, `constructor` or `prototype` as a key, or collides with another field (`a` next to `a.b`) is skipped, and the first field registered keeps the path. Indexes run from 0 to 9999, and a gap in the indexes leaves `null` in the array.

## Validating

A validator returns a message, a list of issues, or `undefined` for valid. It can be async.

```ts
import type { FormOptions } from '@zerosumstudio/drift'

const options: FormOptions = {
	fields: {
		email: {
			validate: async (value, { signal }) => {
				const response = await fetch(`/api/emails/${encodeURIComponent(String(value))}`, {
					signal,
				})

				return response.ok ? 'That email is taken' : undefined
			},
			validateOn: { debounceMs: 300 },
		},
		confirm: {
			validate: (value, { values }) =>
				value === values.password ? undefined : 'Passwords differ',
		},
	},
	validate: values =>
		values.terms === true ? undefined : [{ message: 'Accept the terms', name: 'terms' }],
}
```

A field validator gets the field's value and `{ name, values, signal }`. A form validator gets all values and `{ signal }`, and returns issues of the form `{ message, name? }`. An issue with no `name` belongs to the field being validated, or to the form when the validator is a form validator, and form-level messages are in `state.formErrors`. The `signal` aborts when a newer run replaces the run, and on reset and disconnect, so pass it to `fetch`.

A validator that throws, or returns anything else (like the 1.4 `{ success, errors }` shape), fails closed. The field gets `validatorErrorMessage`, never the thrown message, and the `error` event fires with `phase: 'validate'`.

Errors are kept by who wrote them. A field validator replaces only what it wrote last time, a form validator replaces only form-level results, and `setErrors` writes errors that clear when the field's value next changes, on `clearErrors`, on reset and when a submit starts.

### When validators run

| `validateOn`             | Runs                            |
| ------------------------ | ------------------------------- |
| `'submit'` (default)     | Only on submit                  |
| `'blur'`                 | When the field loses focus      |
| `'change'`               | On every value change           |
| `{ debounceMs: number }` | That long after the last change |

A field's own `validateOn` beats the form's, which beats the config's. Whatever the trigger, a field that already has an error revalidates on every change and blur, and a submit runs every field validator and the form validator. A form validator also runs for a single field on that field's trigger, and keeps only the issues for that field.

### Standard Schema

`validate` takes any [Standard Schema](https://standardschema.dev), such as zod or valibot, at form level or field level. Drift has no dependency on any of them.

```ts
import { z } from 'zod'

const signupSchema = z.object({
	email: z.email(),
	age: z.number().nullable(),
	tags: z.array(z.string()),
})

const signup = drift.form('signup', { validate: signupSchema })

signup.onSubmit(values => {
	values.email // string, typed from the schema's output
})
```

At form level, each issue's path becomes a field name (`['items', 0, 'name']` is `items[0].name`), and an issue with no path goes to `formErrors`. On success, `onSubmit` and the `submitted` result receive the schema's parsed output. At field level, every issue becomes an error on that field.

```ts
import * as v from 'valibot'

drift.form('profile', {
	fields: { name: { validate: v.pipe(v.string(), v.minLength(2)) } },
})
```

The schema validates the form's values as the DOM holds them, so an empty number is `null` and a checkbox group is `string[]`. Async schemas work. `getState().values` is not typed by the schema, only what `onSubmit` receives is.

### Browser validation

`validate: 'native'` uses the constraint validation of the elements themselves, so `required`, `pattern`, `min` and `type="email"` produce errors with the browser's messages. It works on a form or on a single field.

```ts
drift.form('contact', { validate: 'native' })
```

Without it, the browser's own bubbles stop a submit before drift sees it, so a `required` field leaves `submitCount` at 0. `native` sets `novalidate` on the `<form>`, and that turns off browser validation for the whole form, including fields that don't use `native`. It is restored when native validation is removed from the options or the form leaves the DOM.

## Submit and reset

```ts
const result = await signup.submit()

if (result.status === 'submitted') console.log(result.values)
if (result.status === 'failed') console.error(result.error)
```

`submit()` resolves, and never rejects, with a `SubmitResult`:

| `status`      | Meaning                                                                                      |
| ------------- | -------------------------------------------------------------------------------------------- |
| `'submitted'` | Validation passed and the handler returned. `values` is a plain copy, or the schema's output |
| `'invalid'`   | A validator reported errors. With `aria`, the first invalid field is focused                 |
| `'failed'`    | The handler threw. `error` holds it, and the `error` event fires with `phase: 'submit'`      |

A submit validates everything, reads the values after validation, then calls the handler with `(values, { formKey, signal })`. If values change during validation it validates again, up to three passes, and returns `invalid` when they keep changing. A call made during a submit shares its run, so the handler runs once. A successful submit clears the form's persisted draft.

`onSubmit` and `onReset` take one handler each, and a later one replaces the earlier. Each returns a function that removes its own handler only.

On a native `<form>`, drift always cancels the browser's submit, validates, and then:

- with an `onSubmit` handler, calls it
- with no handler and valid values, submits the form natively, so `action`, `method` and the submitter's `name` and `value` all go through
- with errors, does nothing

A double click is the app's to guard. On a form with no handler, Firefox can send the request twice by itself, with or without drift. Concurrent `submit()` calls share one run, so a handler runs once.

A `<button type="reset">` calls drift's reset: it cancels the native reset and restores `initialValues` where given, and the HTML defaults (`defaultValue`, `checked`, `selected`) elsewhere. It clears errors, touched, the submit count and the persisted draft, and aborts in-flight runs. `onReset` runs after, for state drift doesn't own, and a throw reaches the `error` event with `phase: 'reset'`.

```ts
signup.setInitialValues({ user: { name: 'Alice' } }) // not dirty, and reset() restores it
signup.onReset(async () => {
	await fetch('/api/draft', { method: 'DELETE' })
})
```

`setInitialValues` and `initialValues` take the nested shape, not dotted keys. `unsetValue(name)` deletes a key, and splices an array index out. It leaves the DOM alone.

### Form state

`getState()` returns an immutable snapshot. It is replaced only when something changes, so a form that didn't change keeps its identity.

| Property      | Type                                     | Description                                                  |
| ------------- | ---------------------------------------- | ------------------------------------------------------------ |
| `values`      | `DeepReadonly<Values>`                   | Current values, nested and frozen                            |
| `errors`      | `Record<string, readonly string[]>`      | Messages by field name                                       |
| `formErrors`  | `readonly string[]`                      | Messages that belong to no field                             |
| `touched`     | `Record<string, true>`                   | Fields that lost focus, or changed for checkboxes and radios |
| `dirty`       | `Record<string, true>`                   | Fields that differ from their initial value                  |
| `validating`  | `Record<string, true>`                   | Fields with a validation run in flight                       |
| `status`      | `'idle' \| 'validating' \| 'submitting'` |                                                              |
| `submitCount` | `number`                                 | Submits since the last reset                                 |
| `isValid`     | `boolean`                                | No errors and no form errors                                 |
| `isDirty`     | `boolean`                                | Any field is dirty                                           |
| `canSubmit`   | `boolean`                                | `status === 'idle' && isValid`. A fresh form can submit      |

`errors`, `touched`, `dirty` and `validating` have no prototype, so `errors.hasOwnProperty` doesn't exist. Read a name directly, or use `Object.hasOwn`. A field is dirty only while its value differs from the initial one, so typing the initial value back clears it.

## Persisting drafts

A form is stored only when code says so: `drift.form(key, { persist: true })`. Nothing in the markup can turn it on, because markup is what an attacker who can inject HTML controls. A `data-drift-persist` attribute on a form does nothing, and logs one warning in development.

```ts
const drift = new Drift({ persist: { keyPrefix: 'myapp', maxAgeMs: 3_600_000 } })

drift.form('checkout', { persist: true })
```

`DriftConfig.persist` holds only the storage settings. Options replace each other, so a later `drift.form(key, options)` that leaves `persist` out turns it off.

| Setting     | Description                                                                                                    |
| ----------- | -------------------------------------------------------------------------------------------------------------- |
| `storage`   | Anything with `getItem`, `setItem` and `removeItem`. Defaults to `window.localStorage`, looked up on first use |
| `keyPrefix` | Storage keys are `<keyPrefix>:<formKey>`. Defaults to `'drift'`                                                |
| `version`   | Stored entries from another version are dropped unless `migrate` takes them. Defaults to `1`                   |
| `maxAgeMs`  | Older entries are dropped. Defaults to one day                                                                 |
| `migrate`   | `(values, fromVersion) => values` for an entry from another version                                            |

Drift stores values only, one entry per form. It writes 100 ms after the last change, and at once when the page is hidden. On load it checks the entry's shape, age and version, and restores each field only if the stored value has that field's type. A non-empty DOM value, as in server-rendered HTML, beats a stored one. A storage failure reaches the `error` event once with `phase: 'persist'`, and the form keeps working in memory.

These are never stored, and nothing overrides it:

- file inputs, and `type="password"` and `type="hidden"` inputs
- fields whose `autocomplete` contains `cc-number`, `cc-csc`, `cc-exp`, `cc-exp-month`, `cc-exp-year`, `cc-name`, `cc-given-name`, `cc-additional-name`, `cc-family-name`, `cc-type`, `one-time-code`, `current-password` or `new-password`
- fields with `data-drift-persist="off"` (or `false`)

An element denied once stays denied, so switching a password input to `type="text"` doesn't make it storable.

What is left is PII stored in plain text on the device: names, addresses, emails and whatever else the form holds. Only persist forms where a lost draft costs more than that, mark other sensitive fields `data-drift-persist="off"`, and clear drafts on sign-out:

```ts
drift.clearPersisted() // every form, and every key under the prefix
drift.clearPersisted('checkout') // one form
```

A custom `storage` needs `length` and `key(index)`, as `localStorage` has, for the call with no argument to find keys that this page hasn't used yet. Drafts are also cleared after a successful submit and on reset.

## Accessibility

`aria: true` wires error state into the markup. It is opt-in because React and Vue own the attributes they render.

```html
<input name="email" type="email" />
<p data-drift-error="email" role="alert"></p>
```

```ts
const drift = new Drift({ aria: true })
```

When a field's errors change, drift sets or removes `aria-invalid="true"` on its element, and on every element of a radio or checkbox group. A `data-drift-error="<name>"` element inside the form receives the messages, joined, as text and never as HTML. It gets an id if it has none, and the field's `aria-describedby` gets that id with its other tokens kept. After a submit with errors, drift focuses the first invalid field in DOM order. The `role="alert"` or `aria-live` on the slot is yours to write.

## Programmatic changes

Setting `input.value = x` or `input.checked = x` fires no event, so drift doesn't see it unless you pass the tracker:

```ts
import { Drift } from '@zerosumstudio/drift'
import { trackProgrammaticChanges } from '@zerosumstudio/drift/track'

const drift = new Drift({ trackProgrammaticChanges })
```

It wraps the property on the element, reports the change as a `field:change` event with `source: 'api'`, and restores the property when the field leaves the DOM. Use `form.setValue(name, value)` where you can, since it needs none of this. The tracker covers `value` and `checked`. It does not see `select.selectedIndex`, `option.selected` or a file input.

## Events

`drift.on(type, listener)` returns a function that removes the listener. Every payload has `formKey`.

```ts
const stop = drift.on('field:change', ({ formKey, name, value, source }) => {
	console.log(formKey, name, value, source) // source is 'user' or 'api'
})
```

| Event                              | Payload besides `formKey` | Fires                                       |
| ---------------------------------- | ------------------------- | ------------------------------------------- |
| `form:register`, `form:unregister` |                           | A form's element enters or leaves the DOM   |
| `form:reset`                       |                           | After a reset                               |
| `field:register`                   | `name`, `value`           | A field enters a form                       |
| `field:unregister`                 | `name`                    | A field leaves a form                       |
| `field:change`                     | `name`, `value`, `source` | A user edit, `setValue`, or a tracked write |
| `field:focus`, `field:blur`        | `name`                    | A field gains or loses focus                |
| `validation:start`                 | `name?`                   | A validation run starts                     |
| `validation:end`                   | `name?`, `isValid`        | A validation run ends                       |
| `submit:start`                     |                           | A submit starts                             |
| `submit:end`                       | `result`                  | A submit ends, with its `SubmitResult`      |
| `error`                            | `phase`, `name?`, `error` | Something drift ran for you threw           |

`error` is how drift reports a throwing validator, submit handler, reset handler, storage call or field registration. `phase` is `'validate'`, `'submit'`, `'reset'`, `'persist'` or `'register'`, and `error` is the raw thrown value. With no `error` listener, drift logs the phase, form key, field name and error type with `console.error`, and not the message, since it can echo what the user typed. A listener that throws is logged and doesn't stop the others.

## React

Drift owns field values, so use uncontrolled inputs: `defaultValue`, not `value` with `onChange`. A controlled input makes React the owner of the value, and the two writers fight. Set values from code with `form.setValue`.

`subscribe` and `getState` are bound, so they go straight into `useSyncExternalStore`:

```tsx
import { useSyncExternalStore } from 'react'
import type { FormHandle } from '@zerosumstudio/drift'

export const useForm = (form: FormHandle) =>
	useSyncExternalStore(form.subscribe, form.getState, form.getState)
```

```tsx
import { useEffect } from 'react'
import { Drift } from '@zerosumstudio/drift'
import { signupSchema } from './signup.schema'

const drift = new Drift()
const signup = drift.form('signup', { validate: signupSchema })

signup.onSubmit(async values => {
	await fetch('/api/signup', { method: 'POST', body: JSON.stringify(values) })
})

export function SignupForm() {
	const { errors, status } = useForm(signup)

	useEffect(() => {
		drift.observe()

		return () => drift.disconnect()
	}, [])

	return (
		<form data-drift-form="signup" noValidate>
			<input name="email" type="email" defaultValue="" />
			<p role="alert">{errors.email?.[0]}</p>
			<button disabled={status === 'submitting'}>Sign up</button>
		</form>
	)
}
```

Call `drift.form(key, options)` once, at module scope or in an effect, and not in the render body. Each call with options replaces them and publishes a new snapshot. With `aria: true`, drift writes the text of `data-drift-error` slots itself, so render those elements empty and leave their children to drift.

## Vue and Svelte

Leave field values to drift. A `v-model` or `bind:value` on a drift field writes the same property drift reads and writes, and the two fight over it. Seed values with `initialValues`, change them with `form.setValue`, and read state through `form.getState()` and `form.subscribe(listener)`. `subscribe` does not call the listener on subscribe, so read `getState()` first.

## Testing

Drift runs under jsdom. `drift.scan()` applies pending DOM changes now instead of on the observer's next microtask:

```ts
document.body.innerHTML = '<form data-drift-form="login"><input name="email" /></form>'
drift.observe()
drift.scan()
```

Use `drift.disconnect()` between tests so a leaked instance doesn't keep listeners on the document.

## Security

Drift reads markup, so treat markup you don't control as input. Put user-generated HTML inside an element with `data-drift-ignore`, or strip `data-drift-*` attributes when you sanitise it, so it can't claim a form key. Persistence can't be turned on from markup. Error text goes into the page with `textContent`, never as HTML.

## Limits

- `values` objects are ordinary objects, so a field named `hasOwnProperty` shadows the method on them. Use `Object.hasOwn`.
- `unsetValue` changes state and leaves the DOM alone. Remove the row from the DOM and keep row names in step, or key rows by id (`items.<id>.name`) so a removed row doesn't shift the others.
- A gap in an index (`items[0]` and `items[2]`) leaves `null` between them, and a high index such as `big[9999]` makes a long array.
- `select.selectedIndex` and `option.selected` writes are not tracked, even with `./track`.
- `getState().values` is the shape the DOM holds. Only the `onSubmit` values take the schema's output type.
- Warnings about a skipped field, a duplicate form key or a `data-drift-persist` form attribute log once each, in development only. A build with `NODE_ENV=production` is silent, and a page with no bundler counts as development.

## Size

Brotli, minified, from `pnpm size`:

| Entry                        | Size    |
| ---------------------------- | ------- |
| `@zerosumstudio/drift`       | 9.04 kB |
| `@zerosumstudio/drift/track` | 318 B   |

The package ships unminified, with no source maps, and consumers minify.

## TypeScript

Every public type is exported from the package root: `FormHandle`, `FormState`, `FormOptions`, `FieldOptions`, `DriftConfig`, `PersistConfig`, `ValidationTrigger`, `SubmitResult`, `DriftEventMap` and the rest. `drift.form(key, { validate: schema })` infers the handle's submit values from the schema's output.

```ts
import type { DriftEventMap, FormHandle, FormState, SubmitResult } from '@zerosumstudio/drift'

type ChangeEvent = DriftEventMap['field:change']
```

## Upgrading to 1.0

Install `@zerosumstudio/drift`, change the imports, and run your type checker. The form handle replaced every `(formKey, ...)` method, validators return messages and issues instead of `{ success, errors }`, and persistence is opt-in from code. The [migration guide](./docs/migration-1.0.md) opens with a checklist and covers each change with before and after code. The full list is in the [changelog](./CHANGELOG.md).

## License

MIT © zerosum studio
