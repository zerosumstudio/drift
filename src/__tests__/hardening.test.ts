/*
 *   IMPORTS
 ***************************************************************************************************/
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Drift } from '../drift.js'
import { FormRecord } from '../form.js'
import type { DriftEventMap } from '../types.js'
import { cloneValues } from '../path.js'
import { flush, mount, query, setup, submitEvent, type } from './helpers.js'

/*
 *   NOTES
 ***************************************************************************************************/
// Fix round 1. Numbers are the rows of drift-1.0-fixes.md. The node-only checks for #2 are in
// ssr.test.ts, and the persistence ones for #10 are in persistence.test.ts.

afterEach(() => {
	vi.restoreAllMocks()
	vi.useRealTimers()
})

/*
 *   TESTS
 ***************************************************************************************************/
describe('#1: replacing an element with a same-named one', () => {
	it('tracks a field replaced in one mutation batch', async () => {
		const { drift, root } = setup(
			'<form data-drift-form="f"><div id="c"><input name="a" value="1"></div></form>',
		)
		const container = query(root, '#c')

		container.innerHTML = '<input name="a" value="2">'
		await flush()
		type(query(container, '[name=a]'), 'typed')

		expect(drift.form('f').getValue('a')).toBe('typed')
	})

	it('tracks a field swapped with replaceWith', async () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a" value="1"></form>')
		const fresh = document.createElement('input')

		fresh.name = 'a'
		fresh.value = '2'
		query(root, '[name=a]').replaceWith(fresh)
		await flush()
		type(fresh, 'typed')

		expect(drift.form('f').getValue('a')).toBe('typed')
	})

	it('tracks a replaced form, and still prevents and handles its submit', async () => {
		const { drift, root } = setup(
			'<div id="c"><form data-drift-form="f"><input name="a"></form></div>',
		)
		const handler = vi.fn()

		drift.form('f').onSubmit(handler)
		query(root, '#c').innerHTML =
			'<form data-drift-form="f"><input name="a" value="new"></form>'
		await flush()

		const event = submitEvent(query(root, 'form'))

		expect(event.defaultPrevented).toBe(true)
		await vi.waitFor(() => {
			expect(handler).toHaveBeenCalledWith(
				expect.objectContaining({ a: 'new' }),
				expect.anything(),
			)
		})
	})

	it('picks up the new element when it was mounted first and the old one removed later', async () => {
		const { drift, root } = setup('<form data-drift-form="f"><input id="old" name="a"></form>')
		const form = query(root, 'form')
		const fresh = document.createElement('input')

		vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		fresh.name = 'a'
		form.appendChild(fresh)
		await flush()
		query(root, '#old').remove()
		await flush()
		type(fresh, 'typed')

		expect(drift.form('f').getValue('a')).toBe('typed')
	})
})

describe('#3: native submit pass-through', () => {
	function stub() {
		const calls: Array<HTMLElement | undefined> = []
		const spy = vi
			.spyOn(HTMLFormElement.prototype, 'requestSubmit')
			.mockImplementation(function (this: HTMLFormElement, submitter?: HTMLElement | null) {
				calls.push(submitter ?? undefined)
				this.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }))
			})

		return { calls, spy }
	}

	it('waits for a task of its own, because a browser ignores it inside the submit dispatch', async () => {
		const { calls } = stub()
		const { drift, root } = setup(
			'<form data-drift-form="f" action="/go"><button>Go</button></form>',
		)

		drift.form('f')
		submitEvent(query(root, 'form'))

		for (let tick = 0; tick < 10; tick++) await Promise.resolve()

		expect(calls).toHaveLength(0)

		await vi.waitFor(() => {
			expect(calls).toHaveLength(1)
		})
	})

	it('passes the submitter on', async () => {
		const { calls } = stub()
		const { drift, root } = setup(
			'<form data-drift-form="f" action="/go"><button name="which" value="draft">Go</button></form>',
		)
		const event = new Event('submit', { bubbles: true, cancelable: true }) as SubmitEvent

		Object.defineProperty(event, 'submitter', { value: query(root, 'button') })
		drift.form('f')
		query(root, 'form').dispatchEvent(event)

		await vi.waitFor(() => {
			expect(calls).toEqual([query(root, 'button')])
		})
	})

	it('re-submits once for a double click', async () => {
		const { calls } = stub()
		const { drift, root } = setup('<form data-drift-form="f"><button>Go</button></form>')

		drift.form('f', { validate: () => Promise.resolve(undefined) })
		submitEvent(query(root, 'form'))
		submitEvent(query(root, 'form'))
		await flush()
		await flush()

		expect(calls).toHaveLength(1)
	})

	it('does not loop when two instances watch the same DOM', async () => {
		const first = setup('<form data-drift-form="f"><button>Go</button></form>')
		const second = new Drift()
		let submits = 0

		second.observe(first.root)
		document.addEventListener('submit', event => {
			submits++
			event.preventDefault()
		})
		submitEvent(query(first.root, 'form'))
		for (let round = 0; round < 15; round++) await flush()

		expect(submits).toBeLessThan(5)
	})
})

describe('#4: removing a validator through form()', () => {
	it('drops the errors it wrote, so submit is not blocked for good', async () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const form = drift.form('f', { fields: { a: { validate: () => 'bad' } } })

		expect((await form.submit()).status).toBe('invalid')

		drift.form('f', {})

		expect(form.getState().errors).toEqual({})
		expect((await form.submit()).status).toBe('submitted')
	})

	it('drops errors from a removed form-level validator, and keeps manual ones', async () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const form = drift.form('f', { validate: () => [{ message: 'form', name: 'a' }] })

		await form.submit()
		form.setErrors({ a: ['server'] })
		drift.form('f', { fields: {} })

		expect(form.getState().errors).toEqual({ a: ['server'] })
	})
})

describe('#5: aria for errors that exist before their fields', () => {
	const html = `
		<form data-drift-form="f">
			<input name="x"><span data-drift-error="x"></span>
		</form>
	`

	it('marks the field when it registers later', () => {
		const drift = new Drift({ aria: true })

		drift.form('f').setErrors({ x: ['server says no'] })

		const root = mount(html)

		drift.observe(root)

		expect(query(root, '[name=x]').getAttribute('aria-invalid')).toBe('true')
		expect(query(root, '[data-drift-error]').textContent).toBe('server says no')
	})

	it('marks a field that is added after the error was set', () => {
		const { drift, root } = setup(
			'<form data-drift-form="f"><span data-drift-error="x"></span></form>',
			{
				aria: true,
			},
		)

		drift.form('f').setErrors({ x: ['late'] })
		query(root, 'form').insertAdjacentHTML('afterbegin', '<input name="x">')
		drift.scan()

		expect(query(root, '[name=x]').getAttribute('aria-invalid')).toBe('true')
	})

	it('gives each error slot an id that is not already taken', () => {
		const { drift, root } = setup(
			`<span id="drift-error-1"></span><span id="drift-error-2"></span>${html}`,
			{ aria: true },
		)

		drift.form('f').setErrors({ x: ['e'] })

		const id = query(root, '[data-drift-error]').id

		expect(['drift-error-1', 'drift-error-2']).not.toContain(id)
		expect(document.querySelectorAll(`#${id}`)).toHaveLength(1)
	})
})

describe('#7: native pass-through error reporting', () => {
	it('does not hand null to requestSubmit', async () => {
		const submitters: unknown[] = []

		vi.spyOn(HTMLFormElement.prototype, 'requestSubmit').mockImplementation(
			(submitter?: unknown) => {
				submitters.push(submitter)
			},
		)

		const { drift, root } = setup('<form data-drift-form="f"></form>')

		drift.form('f')
		submitEvent(query(root, 'form'))
		await vi.waitFor(() => {
			expect(submitters).toEqual([undefined])
		})
	})
})

describe('#8: the 1.4 blob', () => {
	it('is removed when Drift is created, wherever it holds a card number', () => {
		window.localStorage.setItem(
			'drift-form-state',
			JSON.stringify({ forms: { pay: { values: { card: '4111111111111111' } } } }),
		)
		window.localStorage.setItem('drift:pay', '{}')
		new Drift()

		expect(window.localStorage.getItem('drift-form-state')).toBeNull()
		expect(window.localStorage.getItem('drift:pay')).toBe('{}')
	})

	it('survives a storage that throws', () => {
		vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => {
			throw new Error('blocked')
		})

		expect(() => new Drift()).not.toThrow()
	})
})

describe('#9: a show-password toggle', () => {
	afterEach(() => {
		vi.useRealTimers()
	})

	it('keeps a field that started as a password out of storage after it becomes text', () => {
		vi.useFakeTimers()

		const drift = new Drift()

		drift.form('login', { persist: true })

		const root = mount(
			'<form data-drift-form="login"><input type="password" name="pw"><input name="user"></form>',
		)

		drift.observe(root)
		query(root, '[name=pw]').type = 'text'
		drift.scan()
		type(query(root, '[name=pw]'), 'hunter2')
		type(query(root, '[name=user]'), 'ada')
		query(root, '[name=pw]').type = 'password'
		vi.advanceTimersByTime(200)

		const entry = JSON.parse(window.localStorage.getItem('drift:login') ?? '{}') as {
			values: Record<string, unknown>
		}

		expect(entry.values).toEqual({ user: 'ada' })
		expect(window.localStorage.getItem('drift:login')).not.toContain('hunter2')
	})

	it('drops the stored value when a field becomes denied later', () => {
		vi.useFakeTimers()
		window.localStorage.setItem(
			'drift:f',
			JSON.stringify({
				v: 1,
				savedAt: new Date().toISOString(),
				values: { code: '123456', keep: 'k' },
			}),
		)

		const drift = new Drift()

		drift.form('f', { persist: true })

		const root = mount(
			'<form data-drift-form="f"><input name="code"><input name="keep"></form>',
		)

		drift.observe(root)
		query(root, '[name=code]').setAttribute('autocomplete', 'one-time-code')
		drift.scan()
		vi.advanceTimersByTime(200)

		expect(window.localStorage.getItem('drift:f')).not.toContain('123456')
		expect(window.localStorage.getItem('drift:f')).toContain('"keep":"k"')
	})
})

/** jsdom has no named properties on forms, so this puts the shadowing a browser does on one. */
function shadow(form: Element, names: readonly string[]): void {
	for (const name of names) {
		Object.defineProperty(form, name, {
			value: form.querySelector(`[name=${name}]`),
			configurable: true,
		})
	}
}

describe('#11: markup that names fields after DOM methods and properties', () => {
	const NAMES = [
		'getAttribute',
		'closest',
		'matches',
		'querySelectorAll',
		'contains',
		'isConnected',
		'requestSubmit',
		'noValidate',
		'addEventListener',
		'hasAttribute',
	]

	it('still tracks the form and handles its submit', async () => {
		const inputs = NAMES.map(name => `<input name="${name}" value="v">`).join('')
		const root = mount(`<form data-drift-form="f">${inputs}<input name="ok" value="1"></form>`)
		const drift = new Drift({ aria: true })
		const handler = vi.fn()

		shadow(query(root, 'form'), NAMES)
		drift.form('f', { fields: { ok: { validate: 'native' } } }).onSubmit(handler)
		drift.observe(root)

		expect(Object.keys(drift.form('f').getState().values)).toHaveLength(NAMES.length + 1)

		const event = submitEvent(query(root, 'form'))

		expect(event.defaultPrevented).toBe(true)
		await vi.waitFor(() => {
			expect(handler).toHaveBeenCalledTimes(1)
		})
	})

	it('still passes a handler-less submit through natively', async () => {
		const requestSubmit = vi
			.spyOn(HTMLFormElement.prototype, 'requestSubmit')
			.mockImplementation(() => undefined)
		const root = mount(
			'<form data-drift-form="f"><input name="requestSubmit"><input name="isConnected"></form>',
		)
		const drift = new Drift()

		shadow(query(root, 'form'), ['requestSubmit', 'isConnected'])
		drift.observe(root)
		submitEvent(query(root, 'form'))

		await vi.waitFor(() => {
			expect(requestSubmit).toHaveBeenCalledTimes(1)
		})
	})

	it('fails closed: a form that cannot be bound still has its native submit prevented', () => {
		vi.spyOn(FormRecord.prototype, 'attach').mockImplementation(() => {
			throw new Error('boom')
		})

		const root = mount(
			'<form data-drift-form="f" action="//evil.example"><input name="a"></form>',
		)
		const drift = new Drift()
		const errors: DriftEventMap['error'][] = []

		drift.on('error', error => errors.push(error))
		drift.observe(root)

		expect(submitEvent(query(root, 'form')).defaultPrevented).toBe(true)
		expect(errors[0]).toMatchObject({ formKey: 'f', phase: 'register' })
	})
})

describe('#12: opting a field out of persistence', () => {
	it.each(['off', 'OFF', ' off ', 'false', 'False'])(
		'treats data-drift-persist=%j as off',
		value => {
			vi.useFakeTimers()

			const drift = new Drift()

			drift.form('f', { persist: true })

			const root = mount(
				`<form data-drift-form="f"><input name="a" data-drift-persist="${value}"><input name="b"></form>`,
			)

			drift.observe(root)
			type(query(root, '[name=a]'), 'secret')
			type(query(root, '[name=b]'), 'fine')
			vi.advanceTimersByTime(200)

			expect(window.localStorage.getItem('drift:f')).toContain('fine')
			expect(window.localStorage.getItem('drift:f')).not.toContain('secret')
		},
	)
})

describe('security LOWs', () => {
	it('denies the cardholder name parts', () => {
		vi.useFakeTimers()

		const drift = new Drift()

		drift.form('f', { persist: true })

		const root = mount(`
			<form data-drift-form="f">
				<input name="g" autocomplete="cc-given-name"><input name="m" autocomplete="cc-additional-name">
				<input name="l" autocomplete="cc-family-name"><input name="ok">
			</form>
		`)

		drift.observe(root)

		for (const input of root.querySelectorAll('input')) type(input, 'zzz')

		vi.advanceTimersByTime(200)

		expect(JSON.parse(window.localStorage.getItem('drift:f') ?? '{}').values).toEqual({
			ok: 'zzz',
		})
	})

	it('rejects a stored entry saved in the future', () => {
		window.localStorage.setItem(
			'drift:f',
			JSON.stringify({
				v: 1,
				savedAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
				values: { a: 'x' },
			}),
		)

		const drift = new Drift()

		drift.form('f', { persist: true })
		drift.observe(mount('<form data-drift-form="f"><input name="a"></form>'))

		expect(drift.form('f').getValue('a')).toBe('')
		expect(window.localStorage.getItem('drift:f')).toBeNull()
	})

	it('keeps an own __proto__ key from becoming a prototype', () => {
		const hostile = JSON.parse('{"__proto__": {"polluted": true}, "a": "1"}') as Record<
			string,
			unknown
		>
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const form = drift.form('f', { initialValues: hostile })

		form.setValues(hostile)

		const values = form.getState().values as Record<string, unknown>

		expect(values.polluted).toBeUndefined()
		expect(Object.getPrototypeOf(values)).toBe(Object.prototype)
		expect(({} as Record<string, unknown>).polluted).toBeUndefined()
	})

	it('hands submit a values object that a field name cannot shadow', async () => {
		const { drift } = setup(`
			<form data-drift-form="f">
				<input name="hasOwnProperty" value="x"><input name="toString" value="y">
			</form>
		`)
		const form = drift.form('f')
		const handler = vi.fn()

		form.onSubmit(handler)
		await form.submit()

		const values = handler.mock.calls[0]?.[0] as Record<string, unknown>

		expect(Object.hasOwn(values, 'hasOwnProperty')).toBe(true)
		expect(values.hasOwnProperty).toBe('x')
		expect(typeof Object.prototype.hasOwnProperty).toBe('function')
		expect(JSON.stringify(values)).toBe('{"hasOwnProperty":"x","toString":"y"}')
	})

	it('does not put a validator’s message in the console', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')

		drift.form('f', {
			fields: {
				a: {
					validate: () => {
						throw new Error('user typed 4111111111111111')
					},
				},
			},
		})
		await drift.form('f').validate('a')

		expect(error).toHaveBeenCalledTimes(1)
		expect(JSON.stringify(error.mock.calls)).not.toContain('4111')
		expect(JSON.stringify(error.mock.calls)).toContain('validate')
	})
})

describe('QA LOWs', () => {
	it('treats an empty string from a validator as no error', async () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const form = drift.form('f', { fields: { a: { validate: () => '' } } })

		expect((await form.submit()).status).toBe('submitted')
		expect(form.getState().errors).toEqual({})
	})

	it('publishes nothing for setErrors and clearErrors calls that change nothing', () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const form = drift.form('f')
		const before = form.getState()

		form.setErrors({})
		form.setErrors({ a: [] })
		form.clearErrors()
		form.clearErrors('a')

		expect(form.getState()).toBe(before)

		form.setErrors({ a: ['x'] })

		const after = form.getState()

		form.setErrors({ a: ['x'] })

		expect(form.getState()).toBe(after)
	})

	it('clears a name’s errors with unsetValue even when the key is already gone', () => {
		const { drift } = setup('<form data-drift-form="f"></form>')
		const form = drift.form('f')

		form.setErrors({ gone: ['e'] })
		form.unsetValue('gone')

		expect(form.getState().errors).toEqual({})
	})

	it('restores novalidate when native validation is taken out of the options', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')

		drift.form('f', { validate: 'native' })

		expect(query<HTMLFormElement>(root, 'form').noValidate).toBe(true)

		drift.form('f', {})

		expect(query<HTMLFormElement>(root, 'form').noValidate).toBe(false)
	})

	it('reports a submit whose values never settle', async () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')
		let counter = 0
		const errors: DriftEventMap['error'][] = []

		drift.on('error', error => errors.push(error))

		const form = drift.form('f', {
			fields: {
				a: {
					validate: async () => {
						await Promise.resolve()
						type(query(root, '[name=a]'), String(++counter))

						return undefined
					},
				},
			},
		})

		expect((await form.submit()).status).toBe('invalid')
		expect(errors[0]).toMatchObject({ phase: 'submit' })
	})
})

describe('style round: values, flags and warnings', () => {
	it('keeps an own __proto__ key as a plain key when values are cloned', () => {
		const hostile = JSON.parse('{"__proto__": {"polluted": true}, "a": {"b": 1}}') as Record<
			string,
			unknown
		>
		const copy = cloneValues(hostile)

		expect(Object.getPrototypeOf(copy)).toBe(Object.prototype)
		expect(Object.hasOwn(copy, '__proto__')).toBe(true)
		expect(copy.polluted).toBeUndefined()
		expect(({} as Record<string, unknown>).polluted).toBeUndefined()
	})

	it('keeps errors, touched, dirty and validating free of a prototype', () => {
		const { drift, root } = setup(
			'<form data-drift-form="f"><input name="toString" value="x"></form>',
		)
		const state = drift.form('f').getState()

		type(query(root, '[name=toString]'), 'y')

		const next = drift.form('f').getState()

		for (const flags of [state.errors, state.touched, next.dirty, next.validating]) {
			expect(Object.getPrototypeOf(flags)).toBeNull()
		}

		expect(next.touched.toString).toBeUndefined()
		expect(next.errors.toString).toBeUndefined()
		expect(next.dirty.toString).toBe(true)
	})

	it('warns once that data-drift-persist does nothing on a form', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		setup('<form data-drift-form="f" data-drift-persist><input name="a"></form>')

		expect(warn).toHaveBeenCalledTimes(1)
		expect(warn.mock.calls[0]?.[0]).toContain("drift.form('f', { persist: true })")
	})

	it('stays quiet about it in production builds', async () => {
		vi.stubEnv('NODE_ENV', 'production')
		vi.resetModules()

		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const { Drift: ProductionDrift } = await import('../drift.js')
		const root = mount('<form data-drift-form="f" data-drift-persist><input name="a"></form>')

		new ProductionDrift().observe(root)

		expect(warn).not.toHaveBeenCalled()

		vi.unstubAllEnvs()
	})

	it('keeps a stored entry when migrate throws, and reports it once', () => {
		window.localStorage.setItem(
			'drift:f',
			JSON.stringify({ v: 1, savedAt: new Date().toISOString(), values: { a: 'kept' } }),
		)

		const errors: DriftEventMap['error'][] = []
		const drift = new Drift({
			persist: {
				version: 2,
				migrate: () => {
					throw new Error('bug in migrate')
				},
			},
		})

		drift.on('error', error => errors.push(error))
		drift.form('f', { persist: true })
		drift.observe(mount('<form data-drift-form="f"><input name="a"></form>'))

		expect(errors).toHaveLength(1)
		expect(errors[0]).toMatchObject({ phase: 'persist', formKey: 'f' })
		expect(window.localStorage.getItem('drift:f')).toContain('kept')
	})
})

describe('configuring a form again', () => {
	const options = {
		validate: () => undefined,
		fields: { a: { validate: () => undefined } },
		initialValues: { a: 'seed' },
	}

	it('notifies subscribers zero times for the same options, and keeps the snapshot', () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const form = drift.form('f', options)
		const listener = vi.fn()
		const before = form.getState()

		form.subscribe(listener)
		drift.form('f', options)
		drift.form('f', { ...options })

		expect(listener).not.toHaveBeenCalled()
		expect(form.getState()).toBe(before)
	})

	it('still publishes once when removing a validator that had errors', async () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const form = drift.form('f', { fields: { a: { validate: () => 'bad' } } })

		await form.submit()

		const listener = vi.fn()

		form.subscribe(listener)
		drift.form('f', {})

		expect(listener).toHaveBeenCalledTimes(1)
		expect(form.getState().errors).toEqual({})
	})
})
