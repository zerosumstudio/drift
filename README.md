# <picture><source media="(prefers-color-scheme: dark)" srcset="https://raw.githubusercontent.com/zerosumstudio/drift/main/.github/assets/zerosum-on-dark.png"><img src="https://raw.githubusercontent.com/zerosumstudio/drift/main/.github/assets/zerosum-on-light.png" alt="" height="32"></picture> Drift

[![npm version](https://badge.fury.io/js/@zerosumstudio%2Fdrift.svg)](https://badge.fury.io/js/@zerosumstudio%2Fdrift)
[![Release](https://github.com/zerosumstudio/drift/actions/workflows/release.yml/badge.svg?branch=main)](https://github.com/zerosumstudio/drift/actions/workflows/release.yml)
[![codecov](https://codecov.io/gh/zerosumstudio/drift/branch/main/graph/badge.svg)](https://codecov.io/gh/zerosumstudio/drift)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A DOM-driven form library that tracks forms and fields by their presence in the DOM. There is no registration code and no per-field binding: put `data-drift-form` on an element and Drift picks up its inputs, values, validation, dirty and touched state, and keeps following them as fields come and go.

## Install

```bash
pnpm add @zerosumstudio/drift
```

Zero runtime dependencies and no peers. It runs in the browser, and needs Node 22.12 or newer to install.

Up to 1.4.0 this was published as `@bkincz/drift`. Swap the package name and the imports, the API is the same. The UMD bundle and its `Drift` browser global are gone, so load the ESM build in a browser.

## Quick start

```html
<form data-drift-form="login">
	<input name="email" type="email" />
	<input name="password" type="password" />
	<button type="submit">Login</button>
</form>
```

```ts
import { Drift } from '@zerosumstudio/drift'

const drift = new Drift()
drift.observe(document.body)

drift.subscribe('login', state => {
	console.log(state.values, state.errors, state.canSubmit)
})

drift.onSubmit('login', async values => {
	await api.login(values)
})
```

## Forms and fields

A field is tracked while it is in the DOM and has a `name`. `data-drift-form` works on any element, not just `<form>`, so use a `<div>` when a native form would conflict, for example inside another `<form>`. Only a native `<form>` fires submit events, so call `drift.submit('checkout')` yourself for any other element. An input inside a nested `data-drift-form` belongs to the nested form.

```html
<div data-drift-form="checkout">
	<input name="card_number" />

	<!-- Excluded from tracking -->
	<input name="secret" data-drift-hidden />
</div>
```

A field removed from the DOM is unregistered but its value is kept. If it comes back empty, the previous value is restored. If it comes back with a value, the new value wins.

### Nested values

Dot and array notation in `name` build nested values.

```html
<input name="user.address.city" />
<input name="items[0].name" />
<input name="items[1].name" />
```

```ts
// values
{
	user: { address: { city: '...' } },
	items: [{ name: '...' }, { name: '...' }],
}
```

### Radio groups

Radio inputs that share a `name` are one field.

```ts
drift.getValue('survey', 'size') // 'sm' | 'lg' | undefined
drift.setValue('survey', 'size', 'lg') // checks the matching radio
```

## Validating

Register a schema per form. The form-level `validate` runs on submit. Field validators run on their `validateOn` trigger, `'blur'`, `'change'` or `{ debounce: ms }`, and fall back to `defaultValidateOn` from the config. With neither set, a field is not validated until it already has an error.

```ts
const drift = new Drift({ defaultValidateOn: 'blur' })

drift.registerSchema('signup', {
	validate: async values => {
		const result = schema.safeParse(values)

		return {
			success: result.success,
			errors: result.error?.flatten().fieldErrors,
		}
	},

	fields: {
		email: {
			validate: value => ({
				success: isEmail(value),
				errors: isEmail(value) ? undefined : { email: ['Invalid email'] },
			}),
			validateOn: { debounce: 300 },
		},
		username: {
			validate: value => ({ success: String(value).length > 2 }),
			transform: value => String(value).trim().toLowerCase(), // applied before the value is stored
		},
	},
})
```

A field with active errors revalidates on every value change, including programmatic ones. A field validator receives all values as its second argument and may return errors for other fields, which suits cross-field rules:

```ts
fields: {
	password: {
		validate: (value, all) =>
			value !== all.confirm
				? {
						success: false,
						errors: {
							password: ['Passwords do not match'],
							confirm: ['Passwords do not match'],
						},
					}
				: { success: true },
	},
}
```

`drift.submit(formKey)` runs the form-level `validate` and calls the `onSubmit` handler if it passes, then resolves to whether it did. Field validators run on their own triggers. A handler that throws is logged to the console and does not reject.

## Editing existing data

`setInitialValues` seeds a form, for edit screens. Seeded fields are not dirty, and `resetForm` restores them.

```ts
drift.setInitialValues('profile', {
	name: 'Alice',
	email: 'alice@example.com',
})

// The user edits, then cancels
await drift.resetForm('profile') // restores the values, clears errors, dirty and touched
```

A `<button type="reset">` inside a native `<form>` calls `resetForm`. Use `onReset` for state Drift doesn't own, like a server-side draft. Its handler runs after the form is reset, and a throw is logged, not rethrown.

```ts
drift.onReset('profile', async () => {
	await api.clearDraft()
})
```

Each form has one submit handler and one reset handler. Registering another replaces it. Both `onSubmit` and `onReset` return a function that removes the handler.

## Configuration

```ts
const drift = new Drift({ persist: true, observerDebounce: 32 })
```

| Option              | Description                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `formAttribute`     | Attribute that marks a form. Defaults to `data-drift-form`                          |
| `hiddenAttribute`   | Attribute that excludes a field. Defaults to `data-drift-hidden`                    |
| `persist`           | Save all form state to `localStorage` under `drift-form-state`. Defaults to `false` |
| `observerDebounce`  | Mutation observer debounce in ms. Defaults to 16                                    |
| `defaultValidateOn` | Trigger for fields without their own `validateOn`. No default, so none runs         |

Persisted state includes every tracked value, password fields too, in plain text. Leave `persist` off for sensitive forms, or mark those fields `data-drift-hidden`.

## API reference

```ts
drift.observe(element) // start observing, defaults to document.body
drift.disconnect() // stop observing

drift.registerSchema(formKey, schema)
drift.unregisterSchema(formKey)

drift.getForm(formKey) // form state, or undefined
drift.getAllForms()
drift.getValue(formKey, fieldName)
drift.setValue(formKey, fieldName, value)
drift.setValues(formKey, values)
drift.setInitialValues(formKey, values) // seeds without marking dirty

drift.getErrors(formKey, fieldName)
drift.getAllErrors(formKey)
drift.setErrors(formKey, errors) // merged into existing errors
drift.clearErrors(formKey, fieldName?)

drift.validateField(formKey, fieldName) // Promise<boolean>
drift.validateForm(formKey) // Promise<boolean>
drift.submit(formKey) // Promise<boolean>
drift.resetForm(formKey) // Promise<void>

drift.isTouched(formKey, fieldName)
drift.isDirty(formKey, fieldName)
drift.isFormDirty(formKey)

drift.onSubmit(formKey, async (values, formKey) => {}) // returns an unsubscribe function
drift.onReset(formKey, async () => {}) // returns an unsubscribe function

const unsubscribe = drift.subscribe(formKey, state => {})
drift.subscribeAll(forms => {})

drift.on('field:change', event => {}) // returns an unsubscribe function
drift.off('field:change', listener)
```

### Form state

| Property           | Type                       | Description                               |
| ------------------ | -------------------------- | ----------------------------------------- |
| `values`           | `Record<string, unknown>`  | Current field values                      |
| `errors`           | `Record<string, string[]>` | Active validation errors                  |
| `touched`          | `Record<string, boolean>`  | Fields that have been blurred             |
| `dirty`            | `Record<string, boolean>`  | Fields that have been changed             |
| `isValid`          | `boolean`                  | No active errors                          |
| `isSubmitting`     | `boolean`                  | Submit in progress                        |
| `isValidating`     | `boolean`                  | Form-level validation in progress         |
| `validatingFields` | `Record<string, boolean>`  | Per-field validation in progress          |
| `initialValues`    | `Record<string, unknown>`  | Values set through `setInitialValues`     |
| `hasBeenValidated` | `boolean`                  | The form has been validated at least once |
| `canSubmit`        | `boolean`                  | `hasBeenValidated && isValid`             |

### Events

An event is `{ type, formKey, fieldName?, value?, errors? }`.

| Event                                       | Fires                            |
| ------------------------------------------- | -------------------------------- |
| `form:register`, `form:unregister`          | A form enters or leaves the DOM  |
| `form:reset`                                | After `resetForm`                |
| `field:register`, `field:unregister`        | A field enters or leaves a form  |
| `field:change`, `field:blur`, `field:focus` | The user interacts with a field  |
| `validation:start`, `validation:end`        | Around field and form validation |
| `submit:start`, `submit:end`                | Around `submit`                  |

## Size

About 5 kB brotli, minified, with no dependencies.

## TypeScript

Types for every public interface are exported from the package root.

```ts
import type {
	DriftFormState,
	DriftSchema,
	DriftFieldSchema,
	DriftResetHandler,
	ValidationResult,
} from '@zerosumstudio/drift'
```

## License

MIT © zerosum studio
