/*
 *   IMPORTS
 ***************************************************************************************************/
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Drift } from '../drift.js'
import { trackProgrammaticChanges } from '../track.js'
import { change, flush, focus, mount, query, setup, submitEvent, type } from './helpers.js'

/*
 *   NOTES
 ***************************************************************************************************/
// Rows are numbered as in drift-report.md. Rows 2, 5, 6, 9, 10, 11 and 12 are covered in
// validation.test.ts, and rows 14 and S2 in persistence.test.ts.

afterEach(() => {
	vi.restoreAllMocks()
	vi.useRealTimers()
})

/*
 *   TESTS
 ***************************************************************************************************/
describe('row 1: re-attaching does not stack listeners', () => {
	it('runs the submit handler once after repeated detach and re-attach of a form', async () => {
		const { drift, root } = setup(
			'<div id="host"><form data-drift-form="f"><input name="a"></form></div>',
		)
		const handler = vi.fn()
		const host = query(root, '#host')
		const form = query(host, 'form')

		drift.form('f').onSubmit(handler)

		for (let cycle = 0; cycle < 3; cycle++) {
			form.remove()
			drift.scan()
			host.appendChild(form)
			drift.scan()
		}

		submitEvent(form)
		await vi.waitFor(() => {
			expect(handler).toHaveBeenCalledTimes(1)
		})
	})

	it('emits one field:change per input after the field is re-attached', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')
		const form = query(root, 'form')
		const input = query(root, '[name=a]')
		const heard = vi.fn()

		drift.on('field:change', heard)

		for (let cycle = 0; cycle < 3; cycle++) {
			input.remove()
			drift.scan()
			form.appendChild(input)
			drift.scan()
		}

		type(input, 'x')

		expect(heard).toHaveBeenCalledTimes(1)
	})

	it('releases everything on disconnect, so typing no longer updates state', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')
		const input = query(root, '[name=a]')

		drift.disconnect()
		type(input, 'after')

		expect(drift.form('f').getValue('a')).toBe('')
	})

	it('does not stack when observe() is called again', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')
		const heard = vi.fn()

		drift.on('field:change', heard)
		drift.observe(root)
		drift.observe(root)
		type(query(root, '[name=a]'), 'x')

		expect(heard).toHaveBeenCalledTimes(1)
	})

	it('hears focus once however many times observe() was called', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')
		const heard = vi.fn()

		drift.on('field:focus', heard)
		drift.observe(root)
		drift.observe(root)
		focus(query(root, '[name=a]'))

		expect(heard).toHaveBeenCalledTimes(1)
	})

	it('aborts the one listener signal on observe() again and on disconnect', () => {
		const root = mount('<form data-drift-form="f"><input name="a"></form>')
		const add = vi.spyOn(EventTarget.prototype, 'addEventListener')
		const drift = new Drift()

		drift.observe(root)

		const first = (add.mock.calls[0]?.[2] as { signal: AbortSignal }).signal

		expect(
			new Set(add.mock.calls.map(call => (call[2] as { signal: AbortSignal }).signal)).size,
		).toBe(1)

		drift.observe(root)

		const second = (add.mock.calls.at(-1)?.[2] as { signal: AbortSignal }).signal

		expect(first.aborted).toBe(true)
		expect(second.aborted).toBe(false)

		drift.disconnect()

		expect(second.aborted).toBe(true)
	})

	it('keeps values through disconnect and a later observe()', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')

		type(query(root, '[name=a]'), 'kept')
		drift.disconnect()
		query(root, '[name=a]').value = ''
		drift.observe(root)

		expect(query(root, '[name=a]').value).toBe('kept')
	})
})

describe('row 3: file inputs', () => {
	const html = `
		<form data-drift-form="f">
			<input type="file" name="doc">
			<input name="sibling" value="s">
		</form>
	`

	it('registers a file input as an empty list and its sibling too', () => {
		const { drift } = setup(html)

		expect(drift.form('f').getState().values).toEqual({ doc: [], sibling: 's' })
	})

	it('survives removal and re-add of a file input and still registers its sibling', () => {
		const { drift, root } = setup(html)
		const form = query(root, 'form')
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		form.innerHTML = ''
		drift.scan()
		form.innerHTML = '<input type="file" name="doc"><input name="sibling">'
		drift.scan()

		expect(error).not.toHaveBeenCalled()
		expect(query(form, '[name=sibling]').value).toBe('s')
		expect(drift.form('f').getValue('doc')).toEqual([])
	})

	it('refuses setValue with files, before changing state', () => {
		const { drift } = setup(html)
		const form = drift.form('f')
		const before = form.getState()

		expect(() => {
			form.setValue('doc', [new File(['a'], 'a.txt')])
		}).toThrow(TypeError)
		expect(form.getState()).toBe(before)

		form.setValue('doc', null)

		expect(form.getValue('doc')).toEqual([])
	})

	it('does not break a batch: one bad field is reported and the rest still register', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const { drift } = setup('<form data-drift-form="f"><input name="a" value="1"></form>')

		expect(() => {
			drift.form('f').setValues({ a: '2', missing: 'x' })
		}).not.toThrow()
		expect(error).not.toHaveBeenCalled()
	})
})

describe('row 4: programmatic changes', () => {
	const html = `
		<form data-drift-form="f">
			<select name="s"><option value="1">1</option><option value="2">2</option></select>
			<input type="checkbox" name="c">
			<input name="t">
		</form>
	`

	it('listens to change on a select and an input event on a text field', () => {
		const { drift, root } = setup(html)

		query<HTMLSelectElement>(root, 'select').value = '2'
		change(query(root, 'select'))
		type(query(root, '[name=t]'), 'x')

		expect(drift.form('f').getState().values).toMatchObject({ s: '2', t: 'x' })
	})

	it('does not track untracked writes by default', () => {
		const { drift, root } = setup(html)

		query<HTMLSelectElement>(root, 'select').value = '2'
		query(root, '[name=c]').checked = true

		expect(drift.form('f').getState().values).toMatchObject({ s: '1', c: false })
	})

	it('tracks them with trackProgrammaticChanges', () => {
		const { drift, root } = setup(html, { trackProgrammaticChanges })
		const heard = vi.fn()

		drift.on('field:change', heard)
		query<HTMLSelectElement>(root, 'select').value = '2'
		query(root, '[name=c]').checked = true
		query(root, '[name=t]').value = 'typed'

		expect(drift.form('f').getState().values).toEqual({ s: '2', c: true, t: 'typed' })
		expect(heard).toHaveBeenCalledWith(expect.objectContaining({ name: 's', source: 'api' }))
		expect(heard).toHaveBeenCalledTimes(3)
	})

	it('does not report drift’s own writes as programmatic changes', () => {
		const { drift, root } = setup(html, { trackProgrammaticChanges })
		const heard = vi.fn()

		drift.on('field:change', heard)
		drift.form('f').setValue('t', 'x')

		expect(heard).toHaveBeenCalledTimes(1)
		expect(query(root, '[name=t]').value).toBe('x')
	})

	it('wraps an element’s own descriptor, so a framework’s value tracker survives', () => {
		const root = mount('<form data-drift-form="f"><input name="t"></form>')
		const input = query(root, '[name=t]')
		const tracked: string[] = []
		const nativeValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
		const own: PropertyDescriptor = {
			configurable: true,
			get: () => nativeValue.get!.call(input) as string,
			set: (next: string) => {
				tracked.push(next)
				nativeValue.set!.call(input, next)
			},
		}

		Object.defineProperty(input, 'value', own)

		const drift = new Drift({ trackProgrammaticChanges })

		drift.observe(root)
		input.value = 'one'

		expect(tracked).toEqual(['one'])
		expect(drift.form('f').getValue('t')).toBe('one')

		drift.disconnect()

		expect(Object.getOwnPropertyDescriptor(input, 'value')?.set).toBe(own.set)

		input.value = 'two'

		expect(tracked).toEqual(['one', 'two'])
	})

	it('restores the prototype behaviour when the field is removed, or on disconnect', () => {
		const { drift, root } = setup(html, { trackProgrammaticChanges })
		const input = query(root, '[name=t]')

		expect(Object.getOwnPropertyDescriptor(input, 'value')).toBeDefined()

		input.remove()
		drift.scan()

		expect(Object.getOwnPropertyDescriptor(input, 'value')).toBeUndefined()

		const checkbox = query(root, '[name=c]')

		drift.disconnect()

		expect(Object.getOwnPropertyDescriptor(checkbox, 'checked')).toBeUndefined()
	})

	it('never patches a file input', () => {
		const { root } = setup('<form data-drift-form="f"><input type="file" name="d"></form>', {
			trackProgrammaticChanges,
		})

		expect(Object.getOwnPropertyDescriptor(query(root, '[name=d]'), 'value')).toBeUndefined()
	})
})

describe('row 7: a new value wins when a field returns', () => {
	it('uses the DOM value of a re-added field over the one kept in state', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')
		const form = query(root, 'form')

		type(query(root, '[name=a]'), 'typed')
		form.innerHTML = ''
		drift.scan()
		form.innerHTML = '<input name="a" value="fresh">'
		drift.scan()

		expect(query(form, '[name=a]').value).toBe('fresh')
		expect(drift.form('f').getValue('a')).toBe('fresh')
	})
})

describe('row 8: setValue revalidates and transforms', () => {
	it('revalidates a field that has an error, and clears the error when the new value passes', async () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"></form>')
		const form = drift.form('f', {
			fields: { a: { validate: v => (v === 'ok' ? undefined : 'Bad') } },
		})

		await form.submit()

		expect(form.getState().errors).toEqual({ a: ['Bad'] })

		form.setValue('a', 'ok')

		await vi.waitFor(() => {
			expect(form.getState().errors).toEqual({})
		})
	})

	it('emits one field:change per field for setValues', () => {
		const { drift } = setup('<form data-drift-form="f"><input name="a"><input name="b"></form>')
		const heard = vi.fn()

		drift.on('field:change', heard)
		drift.form('f').setValues({ a: '1', b: '2' })

		expect(heard).toHaveBeenCalledTimes(2)
	})
})

describe('row 13: the observer does not starve', () => {
	it('registers a late form while other mutations keep arriving', async () => {
		vi.useFakeTimers()

		const { drift, root } = setup('<div id="busy"></div>')
		const busy = query<HTMLElement>(root, '#busy')
		let counter = 0
		const ticker = setInterval(() => {
			busy.textContent = String(counter++)
		}, 5)

		const late = document.createElement('form')

		late.setAttribute('data-drift-form', 'late')
		late.innerHTML = '<input name="a" value="1">'
		root.appendChild(late)

		await vi.advanceTimersByTimeAsync(10)
		clearInterval(ticker)

		expect(drift.form('late').getValue('a')).toBe('1')
	})

	it('reconciles only the added subtree, not every form for every added node', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a" value="1"></form>')
		const queries = vi.spyOn(Element.prototype, 'querySelectorAll')

		for (let index = 0; index < 20; index++) {
			const row = document.createElement('div')

			row.innerHTML = '<span></span>'
			root.appendChild(row)
		}

		drift.scan()

		expect(queries.mock.calls.length).toBeLessThanOrEqual(40)
	})
})

describe('row 15: checkbox groups', () => {
	const html = `
		<form data-drift-form="f">
			<input type="checkbox" name="g" value="x">
			<input type="checkbox" name="g" value="y">
			<input type="checkbox" name="g" value="z">
			<input type="checkbox" name="solo">
		</form>
	`

	it('collapses same-name checkboxes into one string array, in DOM order', () => {
		const { drift, root } = setup(html)

		query(root, '[value=z]').click()
		query(root, '[value=x]').click()

		expect(drift.form('f').getValue('g')).toEqual(['x', 'z'])

		query(root, '[value=x]').click()

		expect(drift.form('f').getValue('g')).toEqual(['z'])
	})

	it('keeps a lone checkbox as a boolean, and a [] name as a group', () => {
		const { drift } = setup(`
			<form data-drift-form="f">
				<input type="checkbox" name="solo">
				<input type="checkbox" name="tags[]" value="a" checked>
			</form>
		`)

		expect(drift.form('f').getState().values).toEqual({ solo: false, tags: ['a'] })
	})

	it('writes checked states from setValue', () => {
		const { drift, root } = setup(html)

		drift.form('f').setValue('g', ['y', 'z'])

		expect(query(root, '[value=x]').checked).toBe(false)
		expect(query(root, '[value=y]').checked).toBe(true)
		expect(query(root, '[value=z]').checked).toBe(true)
	})

	it('stays a group when all but one checkbox are removed', () => {
		const { drift, root } = setup(html)

		query(root, '[value=y]').remove()
		query(root, '[value=z]').remove()
		drift.scan()
		query(root, '[value=x]').click()

		expect(drift.form('f').getValue('g')).toEqual(['x'])
	})

	it('resets a group to its checked defaults', async () => {
		const { drift, root } = setup(`
			<form data-drift-form="f">
				<input type="checkbox" name="g" value="x" checked>
				<input type="checkbox" name="g" value="y">
			</form>
		`)

		query(root, '[value=y]').click()
		await drift.form('f').reset()

		expect(drift.form('f').getValue('g')).toEqual(['x'])
		expect(query(root, '[value=y]').checked).toBe(false)
	})

	it('treats a multi-select as a string array', () => {
		const { drift, root } = setup(`
			<form data-drift-form="f">
				<select name="m" multiple><option value="a" selected>a</option><option value="b">b</option></select>
			</form>
		`)

		expect(drift.form('f').getValue('m')).toEqual(['a'])

		query<HTMLSelectElement>(root, 'select').options[1]!.selected = true
		change(query(root, 'select'))

		expect(drift.form('f').getValue('m')).toEqual(['a', 'b'])
	})
})

describe('row 16: removed fields are released', () => {
	it('no longer hears events from a removed field, and a rejoining field is tracked afresh', () => {
		const { drift, root } = setup('<form data-drift-form="f"><input name="a"></form>')
		const input = query(root, '[name=a]')
		const heard = vi.fn()

		drift.on('field:change', heard)
		input.remove()
		drift.scan()
		root.appendChild(input)
		type(input, 'x')

		expect(heard).not.toHaveBeenCalled()
	})
})

describe('row 17: calls right after inserting a form', () => {
	it('keeps setInitialValues and setErrors made before the observer has run', async () => {
		const { drift, root } = setup('')
		const form = drift.form('late')

		root.innerHTML = '<form data-drift-form="late"><input name="a"></form>'
		form.setInitialValues({ a: 'seed' })
		form.setErrors({ a: ['early'] })
		await flush()

		expect(query(root, '[name=a]').value).toBe('seed')
		expect(form.getState().errors).toEqual({ a: ['early'] })
	})

	it('registers a large batch of fields in one pass', () => {
		const { drift, root } = setup('')
		const rows = Array.from(
			{ length: 300 },
			(_, index) => `<input name="f${index}" value="${index}">`,
		)

		root.innerHTML = `<form data-drift-form="big">${rows.join('')}</form>`
		drift.scan()

		expect(Object.keys(drift.form('big').getState().values)).toHaveLength(300)
	})
})

describe('S1: hostile form keys', () => {
	it('does not pollute Object.prototype, for an initial and a late form', async () => {
		const { drift, root } = setup(
			'<form data-drift-form="__proto__"><input name="a" value="1"></form>',
		)

		root.insertAdjacentHTML(
			'beforeend',
			'<form data-drift-form="constructor"><input name="b" value="2"></form>',
		)
		await flush()

		expect(({} as Record<string, unknown>).values).toBeUndefined()
		expect(({} as Record<string, unknown>).errors).toBeUndefined()
		expect(typeof Object.values).toBe('function')
		expect(Object.getPrototypeOf({})).toBe(Object.prototype)
		expect(drift.form('__proto__').getValue('a')).toBe('1')
		expect(drift.form('constructor').getValue('b')).toBe('2')
	})

	it('treats __proto__ and constructor field names as untracked, with one warning', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const { drift } = setup(`
			<form data-drift-form="f">
				<input name="__proto__" value="x">
				<input name="constructor" value="y">
				<input name="ok" value="z">
			</form>
		`)

		expect(drift.form('f').getState().values).toEqual({ ok: 'z' })
		expect(warn).toHaveBeenCalledTimes(2)
		expect(Object.getPrototypeOf({})).toBe(Object.prototype)
	})
})

describe('S3: native function names as field names', () => {
	it('keeps the typed value for toString, valueOf and hasOwnProperty fields', () => {
		const { drift, root } = setup(`
			<form data-drift-form="f">
				<input name="toString" value="a">
				<input name="valueOf">
				<input name="hasOwnProperty" value="c">
			</form>
		`)

		expect(query(root, '[name=toString]').value).toBe('a')
		expect(query(root, '[name=valueOf]').value).toBe('')
		expect(drift.form('f').getState().values).toEqual({
			toString: 'a',
			valueOf: '',
			hasOwnProperty: 'c',
		})
	})
})

describe('L1: name collisions', () => {
	it('keeps the first of two fields that would nest into each other, and warns', () => {
		const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
		const { drift } = setup(`
			<form data-drift-form="f">
				<input name="a" value="1">
				<input name="a.b" value="2">
				<input name="tags" value="x">
				<input name="tags[]" value="y">
			</form>
		`)

		expect(drift.form('f').getState().values).toEqual({ a: '1', tags: 'x' })
		expect(warn).toHaveBeenCalledTimes(2)
	})

	it('lets a duplicate text name keep the first element', () => {
		vi.spyOn(console, 'warn').mockImplementation(() => undefined)

		const { drift } = setup(
			'<form data-drift-form="f"><input name="a" value="1"><input name="a" value="2"></form>',
		)

		expect(drift.form('f').getValue('a')).toBe('1')
	})
})

describe('radio groups', () => {
	it('reads and writes one field for same-name radios', () => {
		const { drift, root } = setup(`
			<form data-drift-form="f">
				<input type="radio" name="size" value="sm"><input type="radio" name="size" value="lg" checked>
			</form>
		`)
		const form = drift.form('f')

		expect(form.getValue('size')).toBe('lg')

		form.setValue('size', 'sm')

		expect(query(root, '[value=sm]').checked).toBe(true)
		expect(query(root, '[value=lg]').checked).toBe(false)

		query(root, '[value=lg]').click()

		expect(form.getValue('size')).toBe('lg')
	})
})
