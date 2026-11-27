// Runs against the built package in dist, through the package's own exports map, so it catches
// what the unit tests can't: build output, entry wiring and ESM/require loading.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { JSDOM } from 'jsdom'

const NAME = '@zerosumstudio/drift'

const dom = new JSDOM('<!doctype html><body></body>', { url: 'http://localhost/' })
const { window } = dom

for (const key of [
	'window',
	'document',
	'Node',
	'Element',
	'HTMLElement',
	'HTMLInputElement',
	'HTMLTextAreaElement',
	'HTMLSelectElement',
	'HTMLFormElement',
	'MutationObserver',
	'Event',
	'FocusEvent',
	'AbortController',
	'EventTarget',
]) {
	globalThis[key] = key === 'window' ? window : window[key]
}

const main = await import(NAME)
const track = await import(`${NAME}/track`)

assert.deepEqual(Object.keys(main).sort(), ['Drift', 'DriftError'], 'main: exports')
assert.equal(typeof main.Drift, 'function', 'main: Drift')
assert.deepEqual(Object.keys(track), ['trackProgrammaticChanges'], 'track: exports')

const storage = new Map()
const drift = new main.Drift({
	persist: {
		storage: {
			getItem: key => storage.get(key) ?? null,
			setItem: (key, value) => storage.set(key, value),
			removeItem: key => storage.delete(key),
		},
	},
})

document.body.innerHTML = `
	<form data-drift-form="signup">
		<input name="email">
		<input type="password" name="password">
		<input type="checkbox" name="tags[]" value="a">
		<input type="checkbox" name="tags[]" value="b">
		<input type="number" name="age">
	</form>
`
drift.observe()

const form = drift.form('signup', {
	persist: true,
	fields: { email: { validate: value => (value ? undefined : 'Required') } },
})

assert.deepEqual(form.getState().values, { email: '', password: '', tags: [], age: null })

const result = await form.submit()

assert.equal(result.status, 'invalid', 'submit: invalid without an email')
assert.deepEqual({ ...form.getState().errors }, { email: ['Required'] })

const email = document.querySelector('[name=email]')

email.value = 'a@b.c'
email.dispatchEvent(new window.Event('input', { bubbles: true }))
const password = document.querySelector('[name=password]')

password.value = 'secret'
password.dispatchEvent(new window.Event('input', { bubbles: true }))
document.querySelector('[value=b]').click()

assert.deepEqual(form.getValue('tags'), ['b'])

drift.disconnect()

const persisted = JSON.parse(storage.get('drift:signup'))

assert.deepEqual(
	persisted.values,
	{ email: 'a@b.c', tags: ['b'] },
	'persist: values only, no password',
)
assert.equal(persisted.v, 1)

form.onSubmit(values => {
	assert.equal(values.email, 'a@b.c')
})
drift.observe()

assert.equal((await form.submit()).status, 'submitted', 'submit: valid')
assert.equal(storage.has('drift:signup'), false, 'persist: cleared after submit')

drift.disconnect()

// Programmatic writes are only seen when the tracker is passed in
const tracked = new main.Drift({ trackProgrammaticChanges: track.trackProgrammaticChanges })

tracked.observe()
document.querySelector('[name=email]').value = 'set from script'

assert.equal(
	tracked.form('signup').getValue('email'),
	'set from script',
	'track: programmatic write',
)
assert.equal(form.getValue('email'), 'a@b.c', 'track: off by default')
tracked.disconnect()

// require() of the ESM entry
const require = createRequire(import.meta.url)
const required = require(NAME)

assert.equal(typeof required.Drift, 'function', 'require: Drift')
assert.equal(required.Drift, main.Drift, 'require: same module instance as import')
assert.equal(typeof require(`${NAME}/track`).trackProgrammaticChanges, 'function', 'require: track')

console.log('smoke ok')
