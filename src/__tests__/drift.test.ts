/*
 *   IMPORTS
 ***************************************************************************************************/
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Drift, DriftError } from '../drift.js'
import { blur, change, flush, focus, mount, query, setup, type } from './helpers.js'

/*
 *   TESTS
 ***************************************************************************************************/
afterEach(() => {
	vi.restoreAllMocks()
})

describe('tracking', () => {
	it('registers forms and fields that are in the DOM', () => {
		const { drift } = setup(`
			<form data-drift-form="login">
				<input name="email" value="a@b.c">
				<input name="user.name" value="Ada">
				<input name="items[0].id" value="7">
			</form>
		`)

		expect(drift.form('login').getState().values).toEqual({
			email: 'a@b.c',
			user: { name: 'Ada' },
			items: [{ id: '7' }],
		})
	})

	it('registers fields that are added later, through the observer', async () => {
		const { drift, root } = setup('<form data-drift-form="f"></form>')

		query(root, 'form').innerHTML = '<input name="late" value="x">'
		await flush()

		expect(drift.form('f').getValue('late')).toBe('x')
	})

	it('scan() applies pending changes without waiting for the observer', () => {
		const { drift, root } = setup('<form data-drift-form="f"></form>')

		query(root, 'form').innerHTML = '<input name="late" value="x">'
		drift.scan()

		expect(drift.form('f').getValue('late')).toBe('x')
	})

	it('tracks a form that is added later', async () => {
		const { drift, root } = setup('')

		root.innerHTML = '<form data-drift-form="late"><input name="a" value="1"></form>'
		await flush()

		expect(drift.form('late').getValue('a')).toBe('1')
	})

	it('works on any element, and gives a nested form its own inputs', () => {
		const { drift } = setup(`
			<div data-drift-form="outer">
				<input name="a" value="1">
				<div data-drift-form="inner"><input name="b" value="2"></div>
			</div>
		`)

		expect(drift.form('outer').getState().values).toEqual({ a: '1' })
		expect(drift.form('inner').getState().values).toEqual({ b: '2' })
	})

	it('skips ignored, disabled and button inputs', () => {
		const { drift } = setup(`
			<form data-drift-form="f">
				<input name="kept" value="1">
				<input name="ignored" value="2" data-drift-ignore>
				<div data-drift-ignore><input name="deep" value="3"></div>
				<input name="off" value="4" disabled>
				<input type="submit" name="go" value="Go">
				<button name="b" value="x">b</button>
				<input value="no name">
			</form>
		`)

		expect(drift.form('f').getState().values).toEqual({ kept: '1' })
	})

	it('keeps the value of a removed field, and restores it when it returns empty', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')
		const form = query(root, 'form')

		type(query(form, '[name=a]'), 'typed')
		form.innerHTML = ''
		drift.scan()

		expect(drift.form('f').getValue('a')).toBe('typed')

		form.innerHTML = '<input name="a">'
		drift.scan()

		expect(query(form, '[name=a]').value).toBe('typed')
	})

	it('reconciles when a name, type or disabled attribute changes', async () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a" value="1"></form>')
		const input = query(root, '[name=a]')

		input.name = 'b'
		await flush()

		expect(drift.form('f').getState().values).toMatchObject({ b: '1' })

		input.disabled = true
		await flush()
		input.value = 'changed'
		input.dispatchEvent(new Event('input', { bubbles: true }))

		expect(drift.form('f').getValue('b')).toBe('1')
	})

	it('moves a field between forms (L4)', () => {
		const { drift, root } = setup(`
			<form data-drift-form="one"><input name="a" value="1"></form>
			<form data-drift-form="two"></form>
		`)
		const input = query(root, '[name=a]')

		query(root, '[data-drift-form=two]').appendChild(input)
		drift.scan()
		type(input, '2')

		expect(drift.form('two').getValue('a')).toBe('2')
		expect(drift.form('one').getValue('a')).toBe('1')
	})

	it('re-keys a form when its attribute changes', () => {
		const { drift, root } = setup(
			'<form data-drift-form="one"><input name="a" value="1"></form>',
		)

		query(root, 'form').setAttribute('data-drift-form', 'two')
		drift.scan()

		expect(drift.form('two').getValue('a')).toBe('1')
	})

	it('warns once and leaves a duplicate form key untracked (L5)', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const { drift, root } = setup(`
			<form data-drift-form="dup"><input name="a" value="1"></form>
			<form data-drift-form="dup"><input name="a" value="2"></form>
		`)

		expect(drift.form('dup').getValue('a')).toBe('1')
		expect(warn).toHaveBeenCalledTimes(1)

		type(root.querySelectorAll('input')[1]!, '9')

		expect(drift.form('dup').getValue('a')).toBe('1')
	})

	it('uses a custom attribute prefix', () => {
		const { drift } = setup('<form app-form="f"><input name="a" value="1"></form>', {
			attributePrefix: 'app',
		})

		expect(drift.form('f').getValue('a')).toBe('1')
	})
})

describe('values', () => {
	it('follows user input, including input and change on the same value', () => {
		const { drift, root } = setup(`
			<form data-drift-form="f">
				<input name="a">
				<select name="s"><option value="1">1</option><option value="2">2</option></select>
				<input type="checkbox" name="c">
				<input type="radio" name="r" value="x"><input type="radio" name="r" value="y">
			</form>
		`)
		const form = drift.form('f')
		const calls = vi.fn()

		form.subscribe(calls)
		type(query(root, '[name=a]'), 'hi')
		change(query(root, '[name=a]'))

		expect(calls).toHaveBeenCalledTimes(1)

		query<HTMLSelectElement>(root, 'select').value = '2'
		change(query(root, 'select'))
		query(root, '[name=c]').click()
		query(root, '[value=y]').click()

		expect(form.getState().values).toEqual({ a: 'hi', s: '2', c: true, r: 'y' })
	})

	it('reads number inputs as null when empty and as numbers otherwise (L2)', () => {
		const { drift, root } = setup(
			'<form data-drift-form="f"><input type="number" name="n"></form>',
		)

		expect(drift.form('f').getValue('n')).toBeNull()

		type(query(root, '[name=n]'), '4.5')

		expect(drift.form('f').getValue('n')).toBe(4.5)
	})

	it('makes values read-only (L9)', () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a" value="1"></form>')
		const values = drift.form('f').getState().values as Record<string, unknown>

		expect(() => {
			values.a = 'x'
		}).toThrow(TypeError)
	})

	it('sets values from the API, writing the DOM and emitting events', () => {
		const { drift, root } = setup(`
			<form data-drift-form="f">
				<input name="a">
				<input name="user.name">
				<input type="checkbox" name="c">
			</form>
		`)
		const form = drift.form('f')
		const events: string[] = []

		drift.on('field:change', event => events.push(`${event.name}:${event.source}`))
		form.setValue('a', 'x')
		form.setValues({ user: { name: 'Ada' }, c: true })

		expect(query(root, '[name=a]').value).toBe('x')
		expect(query(root, '[name="user.name"]').value).toBe('Ada')
		expect(query(root, '[name=c]').checked).toBe(true)
		expect(events).toEqual(['a:api', 'user.name:api', 'c:api'])
	})

	it('notifies once for setValues', () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"><input name="b"></form>')
		const listener = vi.fn()

		drift.form('f').subscribe(listener)
		drift.form('f').setValues({ a: '1', b: '2' })

		expect(listener).toHaveBeenCalledTimes(1)
	})

	it('applies a field transform to user input and API writes, not to the DOM', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')
		const form = drift.form('f', {
			fields: { a: { transform: v => String(v).trim().toLowerCase() } },
		})

		type(query(root, '[name=a]'), '  HeLLo ')

		expect(form.getValue('a')).toBe('hello')

		form.setValue('a', '  X ')

		expect(form.getValue('a')).toBe('x')
	})

	it('reports a number field value that the DOM would not hold', () => {
		const { drift } = setup('<form data-drift-form="f"><input type="number" name="n"></form>')

		drift.form('f').setValue('n', '12')

		expect(drift.form('f').getValue('n')).toBe(12)
	})

	it('ignores an invalid name with one warning', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const { drift } = setup('<form data-drift-form="f"></form>')

		drift.form('f').setValue('__proto__', 'x')
		drift.form('f').setValue('__proto__', 'x')

		expect(warn).toHaveBeenCalledTimes(1)
		expect(({} as Record<string, unknown>).x).toBeUndefined()
	})
})

describe('dirty and touched', () => {
	it('is dirty only while the value differs from the initial value (L8)', () => {
		const { drift, root } = setup(
			'<form data-drift-form="f"><input name="a" value="start"></form>',
		)
		const form = drift.form('f')
		const input = query(root, '[name=a]')

		expect(form.getState().isDirty).toBe(false)

		type(input, 'changed')

		expect(form.getState().dirty).toEqual({ a: true })

		type(input, 'start')

		expect(form.getState().isDirty).toBe(false)
	})

	it('touches on blur, and on change for checkboxes and radios (L8)', () => {
		const { drift, root } = setup(`
			<form data-drift-form="f">
				<input name="a"><input type="checkbox" name="c">
				<input type="radio" name="r" value="1">
			</form>
		`)
		const form = drift.form('f')

		type(query(root, '[name=a]'), 'x')

		expect(form.getState().touched).toEqual({})

		blur(query(root, '[name=a]'))
		query(root, '[name=c]').click()
		query(root, '[name=r]').click()

		expect(form.getState().touched).toEqual({ a: true, c: true, r: true })
	})

	it('publishes nothing on a second blur of a touched field (L9)', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')
		const listener = vi.fn()

		blur(query(root, '[name=a]'))
		drift.form('f').subscribe(listener)
		blur(query(root, '[name=a]'))

		expect(listener).not.toHaveBeenCalled()
	})

	it('keeps the snapshot identity when nothing changed', () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')

		expect(drift.form('f').getState()).toBe(drift.form('f').getState())
	})

	it('has a submittable fresh form, and derives its flags', () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const state = drift.form('f').getState()

		expect(state).toMatchObject({
			status: 'idle',
			isValid: true,
			canSubmit: true,
			submitCount: 0,
			formErrors: [],
		})
	})
})

describe('events', () => {
	it('emits typed registration, focus and blur events', () => {
		const events: string[] = []
		const drift = new Drift()
		const root = mount('<form data-drift-form="f"><input name="a" value="1"></form>')

		for (const type of [
			'form:register',
			'field:register',
			'field:focus',
			'field:blur',
		] as const) {
			drift.on(type, () => events.push(type))
		}

		drift.observe(root)
		focus(query(root, '[name=a]'))
		blur(query(root, '[name=a]'))

		expect(events).toEqual(['form:register', 'field:register', 'field:focus', 'field:blur'])
	})

	it('emits unregister events when elements go away', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')
		const events: string[] = []

		drift.on('field:unregister', event => events.push(`field:${event.name}`))
		drift.on('form:unregister', event => events.push(`form:${event.formKey}`))
		root.innerHTML = ''
		drift.scan()

		expect(events).toContain('field:a')
		expect(events).toContain('form:f')
	})

	it('stops a listener with its unsubscribe, and isolates a throwing one (H5)', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const heard = vi.fn()
		const stop = drift.on('field:change', heard)

		drift.on('field:change', () => {
			throw new Error('boom')
		})
		drift.form('f').setValue('a', '1')

		expect(heard).toHaveBeenCalledTimes(1)
		expect(error).toHaveBeenCalled()

		stop()
		drift.form('f').setValue('a', '2')

		expect(heard).toHaveBeenCalledTimes(1)
	})

	it('only calls the subscribers of the form that changed', () => {
		const { drift, root } = setup(`
			<form data-drift-form="one"><input name="a"></form>
			<form data-drift-form="two"><input name="a"></form>
		`)
		const one = vi.fn()
		const two = vi.fn()

		drift.form('one').subscribe(one)
		drift.form('two').subscribe(two)
		type(root.querySelectorAll('input')[0]!, 'x')

		expect(one).toHaveBeenCalled()
		expect(two).not.toHaveBeenCalled()
	})

	it('does not call a subscriber on subscribe, and stops after unsubscribe', () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const listener = vi.fn()
		const stop = drift.form('f').subscribe(listener)

		expect(listener).not.toHaveBeenCalled()

		stop()
		drift.form('f').setValue('a', '1')

		expect(listener).not.toHaveBeenCalled()
	})

	it('survives a throwing subscriber', () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const later = vi.fn()

		drift.form('f').subscribe(() => {
			throw new Error('boom')
		})
		drift.form('f').subscribe(later)
		drift.form('f').setValue('a', '1')

		expect(later).toHaveBeenCalled()
	})

	it('falls back to console.error for an error event nobody listens to', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')

		drift.form('f', {
			fields: {
				a: {
					validate: () => {
						throw new Error('boom')
					},
				},
			},
		})

		return drift
			.form('f')
			.validate('a')
			.then(() => {
				expect(error).toHaveBeenCalled()
			})
	})
})

describe('the form handle', () => {
	it('returns the same handle for a key, and replaces options when passed again', async () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a" value="x"></form>')
		const first = drift.form('f', { fields: { a: { validate: () => 'one' } } })

		expect(drift.form('f')).toBe(first)

		await first.validate('a')

		expect(first.getState().errors).toEqual({ a: ['one'] })

		drift.form('f', { fields: { a: { validate: () => 'two' } } })
		await first.validate('a')

		expect(first.getState().errors).toEqual({ a: ['two'] })
	})

	it('keeps typed values when configured again with the same initial values', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')
		const options = { initialValues: { a: 'seed' } }

		drift.form('f', options)
		type(query(root, '[name=a]'), 'typed')
		drift.form('f', { ...options })

		expect(drift.form('f').getValue('a')).toBe('typed')

		drift.form('f', { initialValues: { a: 'other' } })

		expect(drift.form('f').getValue('a')).toBe('other')
	})

	it('creates the record before the DOM has the form, and the DOM fills it (state first)', () => {
		const drift = new Drift()
		const form = drift.form('f', { initialValues: { a: 'seed' } })

		form.setErrors({ a: ['early'] })

		expect(form.getState().values).toEqual({ a: 'seed' })

		const root = mount('<form data-drift-form="f"><input name="a"></form>')

		drift.observe(root)

		expect(query(root, '[name=a]').value).toBe('seed')
		expect(form.getState().errors).toEqual({ a: ['early'] })
	})

	it('does not define fields without elements: state alone adds no field, flag or dirty entry', () => {
		const drift = new Drift()
		const form = drift.form('f')

		form.setValue('ghost', 'x')

		expect(form.getState().dirty).toEqual({})
		expect(form.getState().touched).toEqual({})
	})

	it('has methods that work when detached, as useSyncExternalStore needs', () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const { subscribe, getState, setValue } = drift.form('f')
		const listener = vi.fn()

		subscribe(listener)
		setValue('a', 'x')

		expect(listener).toHaveBeenCalledTimes(1)
		expect(getState().values).toEqual({ a: 'x' })
	})

	it('lists every form with forms()', () => {
		const { drift } = setup('<form data-drift-form="a"></form>')

		drift.form('b')

		expect(Array.from(drift.getForms().keys()).sort()).toEqual(['a', 'b'])
	})

	it('unsubscribes only its own submit handler (L5)', async () => {
		const drift = new Drift()
		const form = drift.form('f')
		const first = vi.fn()
		const second = vi.fn()
		const stopFirst = form.onSubmit(first)

		form.onSubmit(second)
		stopFirst()
		await form.submit()

		expect(first).not.toHaveBeenCalled()
		expect(second).toHaveBeenCalledTimes(1)
	})

	it('removes a value and splices an array row with unsetValue (L6)', () => {
		const { drift } = setup(`
			<form data-drift-form="f">
				<input name="items[0].n" value="a">
				<input name="items[1].n" value="b">
			</form>
		`)
		const form = drift.form('f')

		form.unsetValue('items[0]')

		expect(form.getState().values).toEqual({ items: [{ n: 'b' }] })

		form.unsetValue('items[5]')

		expect(form.getState().values).toEqual({ items: [{ n: 'b' }] })
	})

	it('ignores a __proto__ form key as a plain key (S1)', () => {
		const drift = new Drift()

		drift.form('__proto__').setValue('a', '1')

		expect(drift.form('__proto__').getValue('a')).toBe('1')
		expect(({} as Record<string, unknown>).values).toBeUndefined()
		expect(Array.from(drift.getForms().keys())).toEqual(['__proto__'])
	})
})

describe('environment', () => {
	it('reads no stored forms when constructed, and only removes the 1.4 blob (L11)', () => {
		const read = vi.spyOn(Storage.prototype, 'getItem')

		window.localStorage.setItem('drift-form-state', '{"forms":{}}')
		new Drift({ persist: {} })

		expect(read).not.toHaveBeenCalled()
		expect(window.localStorage.getItem('drift-form-state')).toBeNull()
	})

	it('throws NO_BODY when observe() has no body to use (L11)', () => {
		vi.spyOn(document, 'body', 'get').mockReturnValue(null as unknown as HTMLElement)

		expect(() => {
			new Drift().observe()
		}).toThrow(expect.objectContaining({ code: 'NO_BODY', name: 'DriftError' }))
	})

	it('exposes DriftError with a code', () => {
		expect(new DriftError('x', 'NO_DOM').code).toBe('NO_DOM')
	})

	it('observes document.body by default', () => {
		const drift = new Drift()

		mount('<form data-drift-form="f"><input name="a" value="1"></form>')
		drift.observe()

		expect(drift.form('f').getValue('a')).toBe('1')

		drift.disconnect()
	})
})
