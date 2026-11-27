/*
 *   IMPORTS
 ***************************************************************************************************/
import { afterEach, describe, expect, expectTypeOf, it, vi } from 'vitest'
import type { StandardIssue, StandardResult, StandardSchemaV1 } from '../schema.js'
import { blur, deferred, query, setup, submitEvent, type } from './helpers.js'

/*
 *   HELPERS
 ***************************************************************************************************/
function schemaOf<TOutput>(
	check: (value: unknown) => StandardResult<TOutput> | Promise<StandardResult<TOutput>>,
): StandardSchemaV1<unknown, TOutput> {
	return { '~standard': { version: 1, vendor: 'test', validate: check } }
}

function fail(...issues: StandardIssue[]): { issues: StandardIssue[] } {
	return { issues }
}

const SIGNUP = `
	<form data-drift-form="signup">
		<input name="email">
		<input type="number" name="age">
		<input name="items[0].name">
	</form>
`

afterEach(() => {
	vi.restoreAllMocks()
})

/*
 *   TESTS
 ***************************************************************************************************/
describe('Standard Schema at form level', () => {
	const formSchema = schemaOf<{ email: string; age: number }>(value => {
		const values = value as {
			email: string
			age: number | null
			items?: Array<{ name: string }>
		}
		const issues: StandardIssue[] = []

		if (!values.email.includes('@')) issues.push({ message: 'Bad email', path: ['email'] })

		if (values.age === null) issues.push({ message: 'Age needed', path: [{ key: 'age' }] })

		if (!values.items?.[0]?.name) {
			issues.push({ message: 'Item needed', path: ['items', 0, 'name'] })
		}

		if (issues.length > 0) return fail(...issues)

		return { value: { email: values.email, age: values.age! } }
	})

	it('maps issue paths to field names, nested and indexed', async () => {
		const { drift } = setup(SIGNUP)
		const form = drift.form('signup', { validate: formSchema })

		await form.submit()

		expect(form.getState().errors).toEqual({
			email: ['Bad email'],
			age: ['Age needed'],
			'items[0].name': ['Item needed'],
		})
	})

	it('sends pathless issues to formErrors', async () => {
		const { drift } = setup(SIGNUP)
		const form = drift.form('signup', { validate: schemaOf(() => fail({ message: 'Nope' })) })

		await form.submit()

		expect(form.getState().formErrors).toEqual(['Nope'])
	})

	it('hands onSubmit the schema’s parsed output, typed', async () => {
		const { drift, root } = setup(SIGNUP)
		const output = schemaOf<{ age: number }>(() => ({ value: { age: 42 } }))
		const form = drift.form('signup', { validate: output })
		const handler = vi.fn()

		form.onSubmit(values => {
			expectTypeOf(values).toEqualTypeOf<{ age: number }>()
			handler(values)
		})
		type(query(root, '[name=email]'), 'a@b.c')

		const result = await form.submit()

		expect(handler).toHaveBeenCalledWith({ age: 42 })
		expect(result).toEqual({ status: 'submitted', values: { age: 42 } })
	})

	it('accepts an async schema', async () => {
		const { drift } = setup(SIGNUP)
		const gate = deferred<StandardResult<unknown>>()
		const form = drift.form('signup', { validate: schemaOf(() => gate.promise) })
		const run = form.submit()

		await Promise.resolve()

		expect(form.getState().status).toBe('submitting')

		gate.resolve(fail({ message: 'Late', path: ['email'] }))
		await run

		expect(form.getState().errors).toEqual({ email: ['Late'] })
	})

	it('revalidates only the changed field once it has a schema error', async () => {
		const { drift, root } = setup(SIGNUP)
		const form = drift.form('signup', { validate: formSchema })

		await form.submit()
		type(query(root, '[name=email]'), 'a@b.c')

		await vi.waitFor(() => {
			expect(form.getState().errors.email).toBeUndefined()
		})
		expect(form.getState().errors.age).toEqual(['Age needed'])
	})

	it('maps an issue to a name field via its array path', async () => {
		const { drift } = setup(
			'<form data-drift-form="f"><input type="checkbox" name="tags[]" value="a"></form>',
		)
		const form = drift.form('f', {
			validate: schemaOf(() => fail({ message: 'Pick two', path: ['tags'] })),
		})

		await form.submit()

		expect(form.getState().errors).toEqual({ 'tags[]': ['Pick two'] })
	})
})

describe('Standard Schema at field level', () => {
	it('runs the schema against the field value and puts every issue on the field', async () => {
		const { drift, root } = setup(SIGNUP)
		const form = drift.form('signup', {
			fields: {
				email: {
					validate: schemaOf(value =>
						typeof value === 'string' && value.includes('@')
							? { value }
							: fail({ message: 'One' }, { message: 'Two', path: ['elsewhere'] }),
					),
				},
			},
		})

		await form.validate('email')

		expect(form.getState().errors).toEqual({ email: ['One', 'Two'] })

		type(query(root, '[name=email]'), 'a@b.c')
		await form.validate('email')

		expect(form.getState().errors).toEqual({})
	})
})

describe('validate: native (L10)', () => {
	const html = `
		<form data-drift-form="f">
			<input name="email" type="email" required>
			<input name="free">
		</form>
	`

	it('reports the browser’s constraint messages and sets novalidate', async () => {
		const { drift, root } = setup(html)
		const form = drift.form('f', { validate: 'native' })

		expect(query<HTMLFormElement>(root, 'form').noValidate).toBe(true)

		expect(await form.submit()).toEqual({ status: 'invalid' })
		expect(form.getState().errors.email).toEqual([expect.any(String)])
		expect(form.getState().errors.free).toBeUndefined()

		type(query(root, '[name=email]'), 'nope')
		await vi.waitFor(() => {
			expect(form.getState().errors.email).toEqual([expect.any(String)])
		})

		type(query(root, '[name=email]'), 'a@b.c')
		await vi.waitFor(() => {
			expect(form.getState().errors).toEqual({})
		})
	})

	it('works on a single field and leaves the others alone', async () => {
		const { drift, root } = setup(html)
		const form = drift.form('f', { fields: { email: { validate: 'native' } } })

		await form.submit()

		expect(Object.keys(form.getState().errors)).toEqual(['email'])
		expect(query<HTMLFormElement>(root, 'form').noValidate).toBe(true)
	})

	it('does not touch novalidate when native validation is off, and restores it on disconnect', () => {
		const { drift, root } = setup(html)

		drift.form('f', { validate: () => undefined })

		expect(query<HTMLFormElement>(root, 'form').noValidate).toBe(false)

		drift.form('f', { validate: 'native' })

		expect(query<HTMLFormElement>(root, 'form').noValidate).toBe(true)

		drift.disconnect()

		expect(query<HTMLFormElement>(root, 'form').noValidate).toBe(false)
	})

	it('sets novalidate when the native form is configured before its element exists', () => {
		const { drift, root } = setup('')

		drift.form('f', { validate: 'native' })
		root.innerHTML = html
		drift.scan()

		expect(query<HTMLFormElement>(root, 'form').noValidate).toBe(true)
	})

	it('submits natively once native validation passes', async () => {
		const { drift, root } = setup(`
			<form data-drift-form="f" action="/go"><input name="email" type="email" required value="a@b.c"><button>Go</button></form>
		`)
		const form = query<HTMLFormElement>(root, 'form')
		const requestSubmit = vi
			.spyOn(HTMLFormElement.prototype, 'requestSubmit')
			.mockImplementation(() => undefined)

		drift.form('f', { validate: 'native' })
		submitEvent(form)

		await vi.waitFor(() => {
			expect(requestSubmit).toHaveBeenCalledTimes(1)
		})
	})
})

describe('aria', () => {
	const html = `
		<form data-drift-form="f">
			<input name="email" aria-describedby="hint">
			<span id="hint">Your email</span>
			<span data-drift-error="email"></span>
			<input name="name">
			<input type="radio" name="r" value="1"><input type="radio" name="r" value="2">
		</form>
	`

	function setupAria() {
		return setup(html, { aria: true })
	}

	it('is off by default', async () => {
		const { drift, root } = setup(html)

		await drift.form('f', { fields: { email: { validate: () => 'Bad' } } }).validate('email')

		expect(query(root, '[name=email]').hasAttribute('aria-invalid')).toBe(false)
		expect(query(root, '[data-drift-error]').textContent).toBe('')
	})

	it('sets aria-invalid, fills the error slot with text and links it with aria-describedby', async () => {
		const { drift, root } = setupAria()
		const form = drift.form('f', { fields: { email: { validate: () => '<b>Bad</b>' } } })

		await form.validate('email')

		const email = query(root, '[name=email]')
		const slot = query(root, '[data-drift-error]')

		expect(email.getAttribute('aria-invalid')).toBe('true')
		expect(slot.textContent).toBe('<b>Bad</b>')
		expect(slot.children).toHaveLength(0)
		expect(slot.id).not.toBe('')
		expect(email.getAttribute('aria-describedby')).toBe(`hint ${slot.id}`)
	})

	it('clears them when the error goes away, and keeps the link', async () => {
		const { drift, root } = setupAria()
		let message: string | undefined = 'Bad'
		const form = drift.form('f', { fields: { email: { validate: () => message } } })

		await form.validate('email')
		message = undefined
		await form.validate('email')

		const slot = query(root, '[data-drift-error]')

		expect(query(root, '[name=email]').hasAttribute('aria-invalid')).toBe(false)
		expect(slot.textContent).toBe('')
		expect(query(root, '[name=email]').getAttribute('aria-describedby')).toBe(`hint ${slot.id}`)
	})

	it('keeps an existing slot id and adds the token only once', async () => {
		const { drift, root } = setup(
			html.replace('<span data-drift-error', '<span id="mine" data-drift-error'),
			{
				aria: true,
			},
		)

		const form = drift.form('f', { fields: { email: { validate: () => 'Bad' } } })

		await form.validate('email')
		await form.validate('email')

		expect(query(root, '[name=email]').getAttribute('aria-describedby')).toBe('hint mine')
	})

	it('marks every radio of a group', async () => {
		const { drift, root } = setupAria()

		await drift.form('f', { fields: { r: { validate: () => 'Pick one' } } }).validate('r')

		expect(root.querySelectorAll('[aria-invalid="true"]')).toHaveLength(2)
	})

	it('focuses the first invalid field in DOM order after a failed submit', async () => {
		const { drift, root } = setupAria()
		const form = drift.form('f', {
			fields: { name: { validate: () => 'Bad' }, email: { validate: () => 'Bad' } },
		})

		await form.submit()

		expect(document.activeElement).toBe(query(root, '[name=email]'))
	})

	it('sets nothing for a manual error on a name that has no field', () => {
		const { drift, root } = setupAria()

		drift.form('f').setErrors({ ghost: ['x'] })

		expect(root.querySelector('[aria-invalid]')).toBeNull()
	})
})

describe('events carry the right shape', () => {
	it('uses name rather than fieldName, and reports touched on blur', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')
		const events: unknown[] = []

		drift.on('field:change', event => events.push(event))
		drift.on('field:blur', event => events.push(event))
		type(query(root, '[name=a]'), 'x')
		blur(query(root, '[name=a]'))

		expect(events).toEqual([
			{ formKey: 'f', name: 'a', value: 'x', source: 'user' },
			{ formKey: 'f', name: 'a' },
		])
	})
})
