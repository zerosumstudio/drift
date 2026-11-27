/*
 *   IMPORTS
 ***************************************************************************************************/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Drift } from '../drift.js'
import type { DriftEventMap, Issue } from '../types.js'
import { blur, deferred, query, setup, submitEvent, type } from './helpers.js'

/*
 *   HELPERS
 ***************************************************************************************************/
const SIGNUP = `
	<form data-drift-form="signup">
		<input name="email">
		<input name="password">
		<input name="confirm">
	</form>
`

function silence(): void {
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
}

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

/*
 *   TESTS
 ***************************************************************************************************/
describe('field validators', () => {
	it('validates on submit by default, and shows nothing before then', async () => {
		const { drift, root } = setup(SIGNUP)
		const form = drift.form('signup', {
			fields: { email: { validate: v => (v ? undefined : 'Required') } },
		})

		type(query(root, '[name=email]'), 'a')
		type(query(root, '[name=email]'), '')
		blur(query(root, '[name=email]'))

		expect(form.getState().errors).toEqual({})

		const result = await form.submit()

		expect(result).toEqual({ status: 'invalid' })
		expect(form.getState().errors).toEqual({ email: ['Required'] })
	})

	it('validates on blur, on change and with a debounce', async () => {
		vi.useFakeTimers()

		const { drift, root } = setup(SIGNUP)
		const seen: string[] = []
		const make = (name: string) => (v: unknown) => {
			seen.push(`${name}:${String(v)}`)

			return undefined
		}

		drift.form('signup', {
			fields: {
				email: { validate: make('email'), validateOn: 'blur' },
				password: { validate: make('password'), validateOn: 'change' },
				confirm: { validate: make('confirm'), validateOn: { debounceMs: 200 } },
			},
		})

		type(query(root, '[name=email]'), 'a')
		type(query(root, '[name=password]'), 'b')
		type(query(root, '[name=confirm]'), 'c')
		type(query(root, '[name=confirm]'), 'cc')

		expect(seen).toEqual(['password:b'])

		blur(query(root, '[name=email]'))

		expect(seen).toEqual(['password:b', 'email:a'])

		await vi.advanceTimersByTimeAsync(199)

		expect(seen).toHaveLength(2)

		await vi.advanceTimersByTimeAsync(1)

		expect(seen).toEqual(['password:b', 'email:a', 'confirm:cc'])
	})

	it('falls back to the config trigger', () => {
		const validate = vi.fn()
		const { drift, root } = setup(SIGNUP, { validateOn: 'change' })

		drift.form('signup', { fields: { email: { validate } } })
		type(query(root, '[name=email]'), 'a')

		expect(validate).toHaveBeenCalledTimes(1)
	})

	it('revalidates every change once a field has an error, whatever its trigger', async () => {
		const { drift, root } = setup(SIGNUP)
		const form = drift.form('signup', {
			fields: { email: { validate: v => (v === 'ok' ? undefined : 'Bad') } },
		})

		await form.submit()
		type(query(root, '[name=email]'), 'ok')

		await vi.waitFor(() => {
			expect(form.getState().errors).toEqual({})
		})
	})

	it('runs every field validator on submit, even for untouched fields (K1)', async () => {
		const { drift } = setup(SIGNUP)
		const form = drift.form('signup', {
			fields: {
				email: { validate: () => 'e' },
				password: { validate: () => 'p' },
			},
		})

		await form.submit()

		expect(form.getState().errors).toEqual({ email: ['e'], password: ['p'] })
	})

	it('treats an empty issue list as no error (L7)', async () => {
		const { drift } = setup(SIGNUP)
		const form = drift.form('signup', { fields: { email: { validate: () => [] } } })

		expect(await form.validate('email')).toBe(true)
		expect(form.getState().errors).toEqual({})
	})

	it('reports the validated state through events', async () => {
		const { drift } = setup(SIGNUP)
		const events: string[] = []

		drift.on('validation:start', e => events.push(`start:${e.name ?? '*'}`))
		drift.on('validation:end', e => events.push(`end:${e.name ?? '*'}:${String(e.isValid)}`))

		const form = drift.form('signup', { fields: { email: { validate: () => 'no' } } })

		await form.validate('email')

		expect(events).toEqual(['start:email', 'end:email:false'])
	})

	it('marks a field as validating while its run is in flight', async () => {
		const { drift } = setup(SIGNUP)
		const gate = deferred<string | undefined>()
		const form = drift.form('signup', { fields: { email: { validate: () => gate.promise } } })
		const run = form.validate('email')

		expect(form.getState().validating).toEqual({ email: true })
		expect(form.getState().status).toBe('validating')
		expect(form.getState().canSubmit).toBe(false)

		gate.resolve(undefined)
		await run

		expect(form.getState().validating).toEqual({})
		expect(form.getState().status).toBe('idle')
	})
})

describe('errors by source', () => {
	it('clears the confirm mismatch when the password validator passes (M3)', async () => {
		const { drift, root } = setup(SIGNUP)
		const form = drift.form('signup', {
			fields: {
				password: {
					validate: (value, { values }): readonly Issue[] | undefined =>
						value === values.confirm
							? undefined
							: [{ message: 'Must match', name: 'confirm' }],
				},
			},
		})

		type(query(root, '[name=password]'), 'a')
		type(query(root, '[name=confirm]'), 'b')

		await form.validate('password')

		expect(form.getState().errors).toEqual({ confirm: ['Must match'] })

		type(query(root, '[name=confirm]'), 'a')
		await form.validate('password')

		expect(form.getState().errors).toEqual({})
		expect(form.getState().isValid).toBe(true)
	})

	it('keeps field-sourced errors when the form validator runs, and the reverse (K1)', async () => {
		const { drift } = setup(SIGNUP)
		const form = drift.form('signup', {
			validate: () => [{ message: 'form says no', name: 'email' }],
			fields: { email: { validate: () => 'field says no' } },
		})

		await form.submit()

		expect(form.getState().errors).toEqual({ email: ['field says no', 'form says no'] })

		await form.validate('email')

		expect(form.getState().errors.email).toEqual(['field says no', 'form says no'])
	})

	it('puts a pathless form issue in formErrors', async () => {
		const { drift } = setup(SIGNUP)
		const form = drift.form('signup', { validate: () => [{ message: 'Whole form is wrong' }] })

		await form.submit()

		expect(form.getState().formErrors).toEqual(['Whole form is wrong'])
		expect(form.getState().isValid).toBe(false)
	})

	it('dedupes the same message from two sources', async () => {
		const { drift } = setup(SIGNUP)
		const form = drift.form('signup', {
			validate: () => [{ message: 'same', name: 'email' }],
			fields: { email: { validate: () => 'same' } },
		})

		await form.submit()

		expect(form.getState().errors.email).toEqual(['same'])
	})

	it('clears manual errors when the field changes, and on clearErrors', () => {
		const { drift, root } = setup(SIGNUP)
		const form = drift.form('signup')

		form.setErrors({ email: ['Taken'], password: ['Weak'] })

		expect(form.getState().errors).toEqual({ email: ['Taken'], password: ['Weak'] })

		type(query(root, '[name=email]'), 'new')

		expect(form.getState().errors).toEqual({ password: ['Weak'] })

		form.clearErrors('password')

		expect(form.getState().errors).toEqual({})

		form.setErrors({ email: ['x'] })
		form.clearErrors()

		expect(form.getState().isValid).toBe(true)
	})

	it('treats an empty list in setErrors as clearing', () => {
		const { drift } = setup(SIGNUP)
		const form = drift.form('signup')

		form.setErrors({ email: ['x'] })
		form.setErrors({ email: [] })

		expect(form.getState().errors).toEqual({})
	})

	it('drops a removed field’s validator errors so they cannot block submit', async () => {
		const { drift, root } = setup(SIGNUP)
		const form = drift.form('signup', { fields: { email: { validate: () => 'bad' } } })

		await form.submit()
		query(root, '[name=email]').remove()
		drift.scan()

		expect(form.getState().errors).toEqual({})
		expect(await form.submit()).toMatchObject({ status: 'submitted' })
	})
})

describe('stale runs (H2)', () => {
	it('drops the result of an older run that finishes after a newer one', async () => {
		const { drift, root } = setup(SIGNUP)
		const slow = deferred<string | undefined>()
		const fast = deferred<string | undefined>()
		const results = [slow, fast]
		const form = drift.form('signup', {
			fields: { email: { validate: () => results.shift()!.promise, validateOn: 'change' } },
		})

		type(query(root, '[name=email]'), 'a')
		type(query(root, '[name=email]'), 'ab')

		fast.resolve(undefined)
		await Promise.resolve()
		await Promise.resolve()
		slow.resolve('stale failure')
		await vi.waitFor(() => {
			expect(form.getState().status).toBe('idle')
		})

		expect(form.getState().errors).toEqual({})
		expect(form.getState().isValid).toBe(true)
	})

	it('aborts the previous run’s signal', () => {
		const { drift, root } = setup(SIGNUP)
		const signals: AbortSignal[] = []
		const form = drift.form('signup', {
			fields: {
				email: {
					validate: (_value, { signal }) => {
						signals.push(signal)

						return new Promise<undefined>(() => undefined)
					},
					validateOn: 'change',
				},
			},
		})

		type(query(root, '[name=email]'), 'a')
		type(query(root, '[name=email]'), 'b')

		expect(signals[0]?.aborted).toBe(true)
		expect(signals[1]?.aborted).toBe(false)
		expect(form.getState().status).toBe('validating')
	})
})

describe('failures (H5)', () => {
	it('fails closed with a fixed message, reports the cause, and does not stick', async () => {
		silence()

		const { drift } = setup(SIGNUP, { validatorErrorMessage: 'Try again later' })
		const errors: DriftEventMap['error'][] = []

		drift.on('error', e => errors.push(e))

		const form = drift.form('signup', {
			fields: {
				email: {
					validate: () => {
						throw new Error('secret internal detail')
					},
				},
			},
		})

		await form.validate('email')

		expect(form.getState().errors).toEqual({ email: ['Try again later'] })
		expect(JSON.stringify(form.getState())).not.toContain('secret')
		expect(form.getState().validating).toEqual({})
		expect(form.getState().status).toBe('idle')
		expect(errors[0]).toMatchObject({ phase: 'validate', name: 'email' })
	})

	it('uses the default message, and handles a rejecting form validator', async () => {
		silence()

		const { drift } = setup(SIGNUP)
		const form = drift.form('signup', { validate: () => Promise.reject(new Error('network')) })

		const result = await form.submit()

		expect(result).toEqual({ status: 'invalid' })
		expect(form.getState().formErrors).toEqual(['Could not validate this field.'])
		expect(form.getState().status).toBe('idle')
	})

	it('fails closed on a validator that returns the old { success } shape', async () => {
		silence()

		const { drift } = setup(SIGNUP)
		const form = drift.form('signup', {
			fields: { email: { validate: (() => ({ success: true })) as never } },
		})

		await form.validate('email')

		expect(form.getState().errors.email).toEqual(['Could not validate this field.'])
	})

	it('survives a throwing submit:start listener', async () => {
		silence()

		const { drift } = setup(SIGNUP)
		const form = drift.form('signup')

		drift.on('submit:start', () => {
			throw new Error('boom')
		})

		expect(await form.submit()).toMatchObject({ status: 'submitted' })
		expect(form.getState().status).toBe('idle')
	})
})

describe('submit', () => {
	it('resolves submitted with the values the handler saw (M10)', async () => {
		const { drift, root } = setup(SIGNUP)
		const form = drift.form('signup')
		const handler = vi.fn()

		form.onSubmit(handler)
		type(query(root, '[name=email]'), 'a@b.c')

		const result = await form.submit()

		expect(result).toEqual({
			status: 'submitted',
			values: expect.objectContaining({ email: 'a@b.c' }),
		})
		expect(handler).toHaveBeenCalledWith(
			expect.objectContaining({ email: 'a@b.c' }),
			expect.objectContaining({ formKey: 'signup', signal: expect.any(AbortSignal) }),
		)
	})

	it('hands the handler a copy it may mutate', async () => {
		const { drift } = setup(SIGNUP)
		const form = drift.form('signup')

		form.onSubmit(values => {
			values.email = 'mutated'
		})

		await form.submit()

		expect(form.getValue('email')).toBe('')
	})

	it('submits the values from after validation, not before it (M10)', async () => {
		const { drift, root } = setup(SIGNUP)
		const form = drift.form('signup', {
			fields: {
				email: {
					validate: async () => {
						await Promise.resolve()
						type(query(root, '[name=password]'), 'changed during validation')

						return undefined
					},
				},
			},
		})
		const handler = vi.fn()

		form.onSubmit(handler)
		await form.submit()

		expect(handler.mock.calls[0]?.[0]).toMatchObject({ password: 'changed during validation' })
	})

	it('shares one run between concurrent submits (M10)', async () => {
		const { drift } = setup(SIGNUP)
		const form = drift.form('signup', { validate: () => Promise.resolve(undefined) })
		const handler = vi.fn()

		form.onSubmit(handler)

		const [first, second] = await Promise.all([form.submit(), form.submit()])

		expect(handler).toHaveBeenCalledTimes(1)
		expect(second).toBe(first)
	})

	it('can submit again once the first run is done', async () => {
		const { drift } = setup(SIGNUP)
		const form = drift.form('signup')
		const handler = vi.fn()

		form.onSubmit(handler)
		await form.submit()
		await form.submit()

		expect(handler).toHaveBeenCalledTimes(2)
		expect(form.getState().submitCount).toBe(2)
	})

	it('returns invalid when values keep changing through every validation pass', async () => {
		const { drift, root } = setup(SIGNUP)
		let counter = 0
		const form = drift.form('signup', {
			fields: {
				email: {
					validate: async () => {
						await Promise.resolve()
						type(query(root, '[name=password]'), String(++counter))

						return undefined
					},
				},
			},
		})
		const handler = vi.fn()

		form.onSubmit(handler)

		expect(await form.submit()).toEqual({ status: 'invalid' })
		expect(handler).not.toHaveBeenCalled()
	})

	it('sets status to submitting during the handler and back to idle after (H5)', async () => {
		const { drift } = setup(SIGNUP)
		const gate = deferred()
		const form = drift.form('signup')

		form.onSubmit(() => gate.promise)

		const run = form.submit()

		await Promise.resolve()

		expect(form.getState().status).toBe('submitting')

		gate.resolve()
		await run

		expect(form.getState().status).toBe('idle')
	})

	it('resolves failed, emits error, and leaves the form usable when the handler throws (H5)', async () => {
		silence()

		const { drift } = setup(SIGNUP)
		const form = drift.form('signup')
		const failure = new Error('server down')
		const errors: DriftEventMap['error'][] = []

		drift.on('error', e => errors.push(e))
		form.onSubmit(() => {
			throw failure
		})

		expect(await form.submit()).toEqual({ status: 'failed', error: failure })
		expect(errors[0]).toMatchObject({ phase: 'submit', error: failure })
		expect(form.getState().status).toBe('idle')
	})

	it('puts the result on submit:end', async () => {
		const { drift } = setup(SIGNUP)
		const results: string[] = []

		drift.on('submit:end', e => results.push(e.result.status))
		await drift.form('signup').submit()
		await drift.form('signup', { validate: () => [{ message: 'no' }] }).submit()

		expect(results).toEqual(['submitted', 'invalid'])
	})

	it('clears manual errors when it starts, so a repeated submit is not blocked', async () => {
		const { drift } = setup(SIGNUP)
		const form = drift.form('signup')

		form.setErrors({ email: ['Taken'] })

		expect(await form.submit()).toMatchObject({ status: 'submitted' })
	})

	it('resolves an aborted submit as invalid when the form is reset during validation', async () => {
		const { drift } = setup(SIGNUP)
		const gate = deferred<undefined>()
		const form = drift.form('signup', { fields: { email: { validate: () => gate.promise } } })
		const handler = vi.fn()

		form.onSubmit(handler)

		const run = form.submit()

		await form.reset()
		gate.resolve(undefined)

		expect(await run).toEqual({ status: 'invalid' })
		expect(handler).not.toHaveBeenCalled()
	})

	it('runs a form-level submit from the DOM submit event, and prevents the default', async () => {
		const { drift, root } = setup(SIGNUP)
		const handler = vi.fn()

		drift.form('signup').onSubmit(handler)

		const event = submitEvent(query(root, 'form'))

		await vi.waitFor(() => {
			expect(handler).toHaveBeenCalledTimes(1)
		})
		expect(event.defaultPrevented).toBe(true)
	})
})

describe('native submit pass-through', () => {
	beforeEach(() => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
	})

	it('re-submits a validated form that has no handler, and lets that submit through', async () => {
		const { drift, root } = setup(
			'<form data-drift-form="f" action="/go"><button>Go</button></form>',
		)
		const form = query(root, 'form') as unknown as HTMLFormElement
		const seen: boolean[] = []
		const nativeSubmit = vi.fn()

		vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(function (
			this: HTMLFormElement,
			submitter?: HTMLElement | null,
		) {
			nativeSubmit(submitter)
			this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
		})
		document.addEventListener('submit', event => seen.push(event.defaultPrevented))
		drift.form('f')
		submitEvent(form)

		await vi.waitFor(() => {
			expect(nativeSubmit).toHaveBeenCalledTimes(1)
		})

		expect(seen).toEqual([true, false])

		submitEvent(form)

		expect(seen).toEqual([true, false, true])
	})

	it('does not re-submit when a handler took the submit, or validation failed', async () => {
		const { drift, root } = setup('<form data-drift-form="f"><button>Go</button></form>')
		const form = query(root, 'form') as unknown as HTMLFormElement
		const requestSubmit = vi
			.spyOn(HTMLFormElement.prototype, 'requestSubmit')
			.mockImplementation(() => undefined)

		const ended = vi.fn()

		drift.on('submit:end', ended)
		drift.form('f').onSubmit(() => undefined)
		submitEvent(form)
		await vi.waitFor(() => {
			expect(ended).toHaveBeenCalledTimes(1)
		})

		drift.form('f', { validate: () => [{ message: 'no' }] })
		drift.form('f').onSubmit(() => undefined)()
		submitEvent(form)
		await vi.waitFor(() => {
			expect(ended).toHaveBeenCalledTimes(2)
		})

		expect(requestSubmit).not.toHaveBeenCalled()
	})
})

describe('reset', () => {
	it('restores initial values nested, in state and in the DOM (H6)', async () => {
		const { drift, root } = setup(`
			<form data-drift-form="f">
				<input name="user.name"><input name="items[0].id"><input name="plain">
			</form>
		`)
		const form = drift.form('f', {
			initialValues: { user: { name: 'Ada' }, items: [{ id: '1' }], plain: 'p' },
		})

		type(query(root, '[name="user.name"]'), 'changed')
		type(query(root, '[name=plain]'), 'changed')
		await form.reset()

		expect(form.getState().values).toEqual({
			user: { name: 'Ada' },
			items: [{ id: '1' }],
			plain: 'p',
		})
		expect(query(root, '[name="user.name"]').value).toBe('Ada')
		expect(query(root, '[name="items[0].id"]').value).toBe('1')
		expect(form.getState().isDirty).toBe(false)
	})

	it('keeps initial values that have no field, and drops state-only values (H6)', async () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const form = drift.form('f', { initialValues: { extra: { deep: 1 }, a: 'x' } })

		form.setValue('ghost', 'temp')
		await form.reset()

		expect(form.getState().values).toEqual({ extra: { deep: 1 }, a: 'x' })
	})

	it('sets initial values nested without stray keys (H6)', () => {
		const { drift, root } = setup(
			'<form data-drift-form="f"><input name="user.name" value="old"></form>',
		)
		const form = drift.form('f')

		form.setInitialValues({ user: { name: 'New' } })

		expect(form.getState().values).toEqual({ user: { name: 'New' } })
		expect(query(root, '[name="user.name"]').value).toBe('New')
		expect(form.getState().dirty).toEqual({})
	})

	it('restores HTML defaults on a native reset (M5)', () => {
		const { drift, root } = setup(`
			<form data-drift-form="f">
				<input name="a" value="start">
				<input type="checkbox" name="c" checked>
				<select name="s"><option value="1">1</option><option value="2" selected>2</option></select>
			</form>
		`)
		const form = drift.form('f')

		type(query(root, '[name=a]'), 'changed')
		query(root, '[name=c]').click()
		query<HTMLSelectElement>(root, 'select').value = '1'

		const event = new Event('reset', { bubbles: true, cancelable: true })

		query(root, 'form').dispatchEvent(event)

		expect(event.defaultPrevented).toBe(true)
		expect(query(root, '[name=a]').value).toBe('start')
		expect(query(root, '[name=c]').checked).toBe(true)
		expect(query<HTMLSelectElement>(root, 'select').value).toBe('2')
		expect(form.getState().values).toEqual({ a: 'start', c: true, s: '2' })
	})

	it('prefers initial values over HTML defaults', async () => {
		const { drift, root } = setup(
			'<form data-drift-form="f"><input name="a" value="html"></form>',
		)
		const form = drift.form('f', { initialValues: { a: 'initial' } })

		type(query(root, '[name=a]'), 'x')
		await form.reset()

		expect(query(root, '[name=a]').value).toBe('initial')
	})

	it('clears errors, touched, submitCount and any pending debounce (M12)', async () => {
		vi.useFakeTimers()

		const { drift, root } = setup(SIGNUP)
		const validate = vi.fn((): string | undefined => undefined)
		const form = drift.form('signup', {
			fields: { email: { validate, validateOn: { debounceMs: 100 } } },
		})

		await form.submit()
		validate.mockClear()
		type(query(root, '[name=email]'), 'x')
		blur(query(root, '[name=email]'))
		await form.reset()
		await vi.advanceTimersByTimeAsync(500)

		expect(validate).not.toHaveBeenCalled()
		expect(form.getState()).toMatchObject({
			errors: {},
			touched: {},
			submitCount: 0,
			isValid: true,
		})
	})

	it('does not write an in-flight validation result after a reset (M12)', async () => {
		const { drift, root } = setup(SIGNUP)
		const gate = deferred<string | undefined>()
		const form = drift.form('signup', {
			fields: { email: { validate: () => gate.promise, validateOn: 'change' } },
		})

		type(query(root, '[name=email]'), 'x')
		await form.reset()
		gate.resolve('late error')
		await Promise.resolve()
		await Promise.resolve()

		expect(form.getState().errors).toEqual({})
		expect(form.getState().status).toBe('idle')
	})

	it('awaits onReset, emits form:reset, and reports a throwing handler', async () => {
		silence()

		const { drift } = setup(SIGNUP)
		const form = drift.form('signup')
		const errors: DriftEventMap['error'][] = []
		const resets = vi.fn()

		drift.on('error', e => errors.push(e))
		drift.on('form:reset', resets)
		form.onReset(() => {
			throw new Error('boom')
		})
		await form.reset()

		expect(resets).toHaveBeenCalledTimes(1)
		expect(errors[0]).toMatchObject({ phase: 'reset' })
	})

	it('unsubscribes only its own reset handler', async () => {
		const drift = new Drift()
		const form = drift.form('f')
		const first = vi.fn()
		const second = vi.fn()
		const stop = form.onReset(first)

		form.onReset(second)
		stop()
		await form.reset()

		expect(first).not.toHaveBeenCalled()
		expect(second).toHaveBeenCalledTimes(1)
	})
})
