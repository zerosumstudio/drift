/*
 *   IMPORTS
 ***************************************************************************************************/
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Drift } from '../drift.js'
import { createPersister, isPersistable } from '../persist.js'
import type { DriftConfig, DriftEventMap, PersistStorage } from '../types.js'
import { mount, query, setup as baseSetup, type } from './helpers.js'

/*
 *   HELPERS
 ***************************************************************************************************/
/** Sets up a Drift where each form marked data-test-persist is enabled the way an app does it. */
function setup(html: string, config?: DriftConfig): { drift: Drift; root: HTMLElement } {
	const root = mount(html)
	const drift = new Drift(config)

	for (const form of root.querySelectorAll('[data-test-persist]')) {
		drift.form(form.getAttribute('data-drift-form') ?? '', { persist: true })
	}

	drift.observe(root)

	return { drift, root }
}

function memoryStorage(initial: Record<string, string> = {}): PersistStorage & {
	data: Map<string, string>
} {
	const data = new Map(Object.entries(initial))

	return {
		data,
		getItem: key => data.get(key) ?? null,
		setItem: (key, value) => {
			data.set(key, value)
		},
		removeItem: key => {
			data.delete(key)
		},
		get length() {
			return data.size
		},
		key: index => Array.from(data.keys())[index] ?? null,
	}
}

function stored(key: string): { v: number; savedAt: string; values: Record<string, unknown> } {
	return JSON.parse(window.localStorage.getItem(key) ?? 'null') as never
}

const PROFILE = `
	<form data-drift-form="profile" data-test-persist>
		<input name="name">
		<input type="checkbox" name="agree">
		<input type="checkbox" name="tags[]" value="a"><input type="checkbox" name="tags[]" value="b">
		<select name="color"><option value="r">r</option><option value="g">g</option></select>
		<input type="number" name="age">
	</form>
`

beforeEach(() => {
	vi.useFakeTimers()
})

afterEach(() => {
	vi.useRealTimers()
	vi.restoreAllMocks()
})

/*
 *   TESTS
 ***************************************************************************************************/
describe('opting in', () => {
	it('stores nothing for a form that code did not enable, even with persist configured', () => {
		const { root } = setup('<form data-drift-form="f"><input name="a"></form>', { persist: {} })

		type(query(root, '[name=a]'), 'x')
		vi.advanceTimersByTime(500)

		expect(window.localStorage.length).toBe(0)
	})

	it('ignores a data-drift-persist attribute on the form (#10)', () => {
		window.localStorage.setItem(
			'drift:f',
			JSON.stringify({ v: 1, savedAt: new Date().toISOString(), values: { a: 'planted' } }),
		)

		const { drift, root } = baseSetup(
			'<form data-drift-form="f" data-drift-persist action="//evil.example"><input name="a"></form>',
		)

		type(query(root, '[name=a]'), 'typed')
		vi.advanceTimersByTime(500)

		expect(query(root, '[name=a]').value).toBe('typed')
		expect(drift.form('f').getValue('a')).toBe('typed')
		expect(JSON.parse(window.localStorage.getItem('drift:f') ?? '{}').values).toEqual({
			a: 'planted',
		})
	})

	it('enables persistence for a form configured after its fields registered', () => {
		window.localStorage.setItem(
			'drift:f',
			JSON.stringify({ v: 1, savedAt: new Date().toISOString(), values: { a: 'stored' } }),
		)

		const { drift, root } = baseSetup('<form data-drift-form="f"><input name="a"></form>')

		drift.form('f', { persist: true })

		expect(query(root, '[name=a]').value).toBe('stored')

		type(query(root, '[name=a]'), 'x')
		vi.advanceTimersByTime(100)

		expect(stored('drift:f').values).toEqual({ a: 'x' })
	})

	it('stops persisting when a later form() call leaves persist out', () => {
		const { drift, root } = setup(
			'<form data-drift-form="f" data-test-persist><input name="a"></form>',
		)

		drift.form('f', {})
		type(query(root, '[name=a]'), 'x')
		vi.advanceTimersByTime(500)

		expect(window.localStorage.length).toBe(0)
	})

	it('stores a versioned envelope of values only, under one key per form, after a debounce', () => {
		const { drift, root } = setup(PROFILE)

		type(query(root, '[name=name]'), 'Ada')
		drift.form('profile').setErrors({ name: ['nope'] })
		query(root, '[name=agree]').click()
		query(root, '[value=b]').click()
		type(query(root, '[name=age]'), '36')

		expect(window.localStorage.getItem('drift:profile')).toBeNull()

		vi.advanceTimersByTime(99)

		expect(window.localStorage.getItem('drift:profile')).toBeNull()

		vi.advanceTimersByTime(1)

		const entry = stored('drift:profile')

		expect(Object.keys(entry).sort()).toEqual(['savedAt', 'v', 'values'])
		expect(entry.v).toBe(1)
		expect(Number.isNaN(Date.parse(entry.savedAt))).toBe(false)
		expect(entry.values).toEqual({ name: 'Ada', agree: true, tags: ['b'], color: 'r', age: 36 })
		expect(window.localStorage.getItem('drift-form-state')).toBeNull()
	})

	it('uses a custom key prefix and storage', () => {
		const storage = memoryStorage()
		const { root } = setup(PROFILE, { persist: { storage, keyPrefix: 'app' } })

		type(query(root, '[name=name]'), 'Ada')
		vi.advanceTimersByTime(100)

		expect(Array.from(storage.data.keys())).toEqual(['app:profile'])
	})

	it('keeps two instances from overwriting each other’s forms (M8)', () => {
		const storage = memoryStorage()
		const first = setup(
			'<form data-drift-form="one" data-test-persist><input name="a"></form>',
			{ persist: { storage } },
		)
		const second = setup(
			'<form data-drift-form="two" data-test-persist><input name="b"></form>',
			{ persist: { storage } },
		)

		type(query(first.root, '[name=a]'), '1')
		type(query(second.root, '[name=b]'), '2')
		vi.advanceTimersByTime(100)

		expect(Array.from(storage.data.keys()).sort()).toEqual(['drift:one', 'drift:two'])
	})
})

describe('what is never stored (S2)', () => {
	const SENSITIVE = `
		<form data-drift-form="pay" data-test-persist>
			<input name="name" value="">
			<input type="password" name="password">
			<input type="hidden" name="csrf" value="token-1">
			<input name="card" autocomplete="cc-number">
			<input name="billing" autocomplete="billing cc-number">
			<input name="cvc" autocomplete="CC-CSC">
			<input name="exp" autocomplete="cc-exp">
			<input name="month" autocomplete="cc-exp-month">
			<input name="year" autocomplete="cc-exp-year">
			<input name="holder" autocomplete="cc-name">
			<input name="brand" autocomplete="cc-type">
			<input name="otp" autocomplete="one-time-code">
			<input name="current" autocomplete="current-password">
			<input name="next" autocomplete="new-password">
			<input name="secret" data-drift-persist="off">
			<input type="file" name="doc">
			<input name="email" autocomplete="email">
		</form>
	`

	it('skips password, hidden, payment, one-time code, password autocomplete, opted-out and file fields', () => {
		const { root } = setup(SENSITIVE)

		for (const input of root.querySelectorAll<HTMLInputElement>(
			'input:not([type=file]):not([type=hidden])',
		)) {
			type(input, 'private')
		}

		vi.advanceTimersByTime(100)

		expect(stored('drift:pay').values).toEqual({ name: 'private', email: 'private' })
	})

	it('cannot be turned off by configuration', () => {
		const { root } = setup(SENSITIVE, { persist: { storage: memoryStorage() } })

		type(query(root, '[name=card]'), '4111')
		type(query(root, '[name=name]'), 'x')
		vi.advanceTimersByTime(100)

		expect(window.localStorage.length).toBe(0)
	})

	it('does not let a stale stored value replace a hidden, server-set one', () => {
		window.localStorage.setItem(
			'drift:pay',
			JSON.stringify({
				v: 1,
				savedAt: new Date().toISOString(),
				values: { csrf: 'stale', password: 'p' },
			}),
		)

		const { root } = setup(SENSITIVE)

		expect(query(root, '[name=csrf]').value).toBe('token-1')
		expect(query(root, '[name=password]').value).toBe('')
	})

	it('reports what isPersistable decides', () => {
		const [text, password, secret] = Array.from(
			mount(
				'<input name="a"><input type="password" name="b"><input name="c" data-drift-persist="off">',
			).querySelectorAll('input'),
		)

		expect(isPersistable('text', [text!], 'data-drift-persist')).toBe(true)
		expect(isPersistable('text', [password!], 'data-drift-persist')).toBe(false)
		expect(isPersistable('text', [secret!], 'data-drift-persist')).toBe(false)
		expect(isPersistable('file', [text!], 'data-drift-persist')).toBe(false)
	})
})

describe('restoring', () => {
	it('restores stored values into empty fields of every kind', () => {
		window.localStorage.setItem(
			'drift:profile',
			JSON.stringify({
				v: 1,
				savedAt: new Date().toISOString(),
				values: { name: 'Ada', agree: true, tags: ['b'], color: 'g', age: 36 },
			}),
		)

		const { drift, root } = setup(PROFILE)

		expect(query(root, '[name=name]').value).toBe('Ada')
		expect(query(root, '[name=agree]').checked).toBe(true)
		expect(query(root, '[value=b]').checked).toBe(true)
		expect(query<HTMLSelectElement>(root, 'select').value).toBe('g')
		expect(query(root, '[name=age]').value).toBe('36')
		expect(drift.form('profile').getState().values).toMatchObject({ name: 'Ada', age: 36 })
		expect(drift.form('profile').getState().dirty).toMatchObject({ name: true })
	})

	it('lets a non-empty DOM value win over the stored one (S2)', () => {
		window.localStorage.setItem(
			'drift:f',
			JSON.stringify({ v: 1, savedAt: new Date().toISOString(), values: { a: 'stored' } }),
		)

		const { drift, root } = setup(
			'<form data-drift-form="f" data-test-persist><input name="a" value="server"></form>',
		)

		expect(query(root, '[name=a]').value).toBe('server')
		expect(drift.form('f').getValue('a')).toBe('server')
	})

	it('prefers a value set through the API before the DOM existed', () => {
		window.localStorage.setItem(
			'drift:f',
			JSON.stringify({ v: 1, savedAt: new Date().toISOString(), values: { a: 'stored' } }),
		)

		const drift = new Drift()

		drift.form('f', { initialValues: { a: 'api' }, persist: true })

		const root = mount('<form data-drift-form="f"><input name="a"></form>')

		drift.observe(root)

		expect(query(root, '[name=a]').value).toBe('api')
	})

	it('restores over an empty initial value', () => {
		window.localStorage.setItem(
			'drift:f',
			JSON.stringify({ v: 1, savedAt: new Date().toISOString(), values: { a: 'stored' } }),
		)

		const drift = new Drift()

		drift.form('f', { initialValues: { a: '' }, persist: true })

		const root = mount('<form data-drift-form="f"><input name="a"></form>')

		drift.observe(root)

		expect(query(root, '[name=a]').value).toBe('stored')
	})

	it.each([
		['a number for a text field', { name: 5 }],
		['a string for a checkbox', { agree: 'yes' }],
		['unknown group options', { tags: ['zzz'] }],
		['a string for a group', { tags: 'a' }],
		['an unknown select option', { color: 'purple' }],
		['a string for a number', { age: 'old' }],
		['null for a text field', { name: null }],
		['an object for a text field', { name: { x: 1 } }],
	])('ignores %s (M8)', (_label, values) => {
		window.localStorage.setItem(
			'drift:profile',
			JSON.stringify({ v: 1, savedAt: new Date().toISOString(), values }),
		)

		const { drift } = setup(PROFILE)

		expect(drift.form('profile').getState().values).toEqual({
			name: '',
			agree: false,
			tags: [],
			color: 'r',
			age: null,
		})
	})

	it.each([
		['{"forms":{"f":null}}'],
		['"a string"'],
		['null'],
		['[]'],
		['not json'],
		['{"v":1,"savedAt":"x","values":{}}'],
		['{"v":"1","savedAt":"2026-01-01T00:00:00.000Z","values":{}}'],
		['{"v":1,"savedAt":"2026-01-01T00:00:00.000Z","values":[]}'],
		['{"v":1,"savedAt":"2026-01-01T00:00:00.000Z"}'],
	])('survives the malformed entry %s, and removes it (M8)', raw => {
		window.localStorage.setItem('drift:profile', raw)

		expect(() => setup(PROFILE)).not.toThrow()
		expect(window.localStorage.getItem('drift:profile')).toBeNull()
	})

	it('never brings back flags from an old blob: only values are read (M8)', () => {
		window.localStorage.setItem(
			'drift:profile',
			JSON.stringify({
				v: 1,
				savedAt: new Date().toISOString(),
				values: { name: 'Ada' },
				errors: { name: ['stale'] },
				isSubmitting: true,
				validatingFields: { name: true },
			}),
		)

		const { drift } = setup(PROFILE)
		const state = drift.form('profile').getState()

		expect(state.errors).toEqual({})
		expect(state.status).toBe('idle')
		expect(state.validating).toEqual({})
	})

	it('ignores the old drift-form-state key', () => {
		window.localStorage.setItem('drift-form-state', JSON.stringify({ forms: { profile: {} } }))

		const { drift } = setup(PROFILE)

		expect(drift.form('profile').getValue('name')).toBe('')
	})

	it('restores into a form added later', () => {
		window.localStorage.setItem(
			'drift:late',
			JSON.stringify({ v: 1, savedAt: new Date().toISOString(), values: { a: 'x' } }),
		)

		const { drift, root } = setup('')

		drift.form('late', { persist: true })
		root.innerHTML = '<form data-drift-form="late"><input name="a"></form>'
		drift.scan()

		expect(query(root, '[name=a]').value).toBe('x')
	})
})

describe('age and version', () => {
	function save(values: unknown, savedAt: Date, v = 1): void {
		window.localStorage.setItem(
			'drift:f',
			JSON.stringify({ v, savedAt: savedAt.toISOString(), values }),
		)
	}

	const html = '<form data-drift-form="f" data-test-persist><input name="a"></form>'

	it('drops an entry older than a day by default, and keeps a fresh one', () => {
		vi.setSystemTime(new Date('2026-06-02T12:00:00Z'))
		save({ a: 'old' }, new Date('2026-06-01T11:59:59Z'))

		expect(setup(html).drift.form('f').getValue('a')).toBe('')
		expect(window.localStorage.getItem('drift:f')).toBeNull()

		save({ a: 'fresh' }, new Date('2026-06-01T12:00:01Z'))

		expect(setup(html).drift.form('f').getValue('a')).toBe('fresh')
	})

	it('honours maxAgeMs', () => {
		vi.setSystemTime(new Date('2026-06-02T12:00:00Z'))
		save({ a: 'x' }, new Date('2026-06-02T11:59:00Z'))

		expect(
			setup(html, { persist: { maxAgeMs: 30_000 } })
				.drift.form('f')
				.getValue('a'),
		).toBe('')
	})

	it('drops a different version, unless migrate maps it', () => {
		save({ a: 'x' }, new Date(), 1)

		expect(
			setup(html, { persist: { version: 2 } })
				.drift.form('f')
				.getValue('a'),
		).toBe('')

		save({ old: 'x' }, new Date(), 1)

		const migrate = vi.fn((values: unknown) => ({ a: (values as { old: string }).old }))
		const migrated = setup(html, { persist: { version: 2, migrate } })

		expect(migrate).toHaveBeenCalledWith({ old: 'x' }, 1)
		expect(migrated.drift.form('f').getValue('a')).toBe('x')
	})

	it('drops the entry when migrate throws or returns a non-object', () => {
		save({ a: 'x' }, new Date(), 1)

		expect(
			setup(html, {
				persist: {
					version: 2,
					migrate: () => {
						throw new Error('bad')
					},
				},
			})
				.drift.form('f')
				.getValue('a'),
		).toBe('')

		save({ a: 'x' }, new Date(), 1)

		expect(
			setup(html, { persist: { version: 2, migrate: () => 'nope' } })
				.drift.form('f')
				.getValue('a'),
		).toBe('')
	})

	it('writes the configured version', () => {
		const { root } = setup(html, { persist: { version: 3 } })

		type(query(root, '[name=a]'), 'x')
		vi.advanceTimersByTime(100)

		expect(stored('drift:f').v).toBe(3)
	})
})

describe('writing and clearing', () => {
	it('flushes a pending save on pagehide and when the page becomes hidden (M8)', () => {
		const { root } = setup(PROFILE)

		type(query(root, '[name=name]'), 'one')
		window.dispatchEvent(new Event('pagehide'))

		expect(stored('drift:profile').values).toMatchObject({ name: 'one' })

		type(query(root, '[name=name]'), 'two')
		vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')
		document.dispatchEvent(new Event('visibilitychange'))

		expect(stored('drift:profile').values).toMatchObject({ name: 'two' })
	})

	it('flushes when the form leaves the DOM', () => {
		const { drift, root } = setup(PROFILE)

		type(query(root, '[name=name]'), 'bye')
		root.innerHTML = ''
		drift.scan()

		expect(stored('drift:profile').values).toMatchObject({ name: 'bye' })
	})

	it('flushes on disconnect', () => {
		const { drift, root } = setup(PROFILE)

		type(query(root, '[name=name]'), 'bye')
		drift.disconnect()

		expect(stored('drift:profile').values).toMatchObject({ name: 'bye' })
	})

	it('clears the entry after a successful submit, and not after an invalid one', async () => {
		const { drift, root } = setup(PROFILE)
		const form = drift.form('profile', {
			persist: true,
			validate: v => (v.name === 'ok' ? [] : [{ message: 'no' }]),
		})

		type(query(root, '[name=name]'), 'bad')
		vi.advanceTimersByTime(100)
		await form.submit()

		expect(window.localStorage.getItem('drift:profile')).not.toBeNull()

		type(query(root, '[name=name]'), 'ok')
		vi.advanceTimersByTime(100)
		await form.submit()

		expect(window.localStorage.getItem('drift:profile')).toBeNull()
	})

	it('clears the entry on reset, with no write left pending', async () => {
		const { drift, root } = setup(PROFILE)

		type(query(root, '[name=name]'), 'x')
		vi.advanceTimersByTime(100)
		type(query(root, '[name=name]'), 'y')
		await drift.form('profile').reset()
		vi.advanceTimersByTime(500)

		expect(window.localStorage.getItem('drift:profile')).toBeNull()
	})

	it('removes the entry when every persistable value is empty', () => {
		const { root } = setup(
			'<form data-drift-form="profile" data-test-persist><input name="name"></form>',
		)

		type(query(root, '[name=name]'), 'x')
		vi.advanceTimersByTime(100)
		type(query(root, '[name=name]'), '')
		vi.advanceTimersByTime(100)

		expect(window.localStorage.getItem('drift:profile')).toBeNull()
	})

	it('clearPersisted clears one form, or every key under the prefix and nothing else', () => {
		const storage = memoryStorage({ other: 'keep', 'drift:orphan': '{}' })
		const { drift, root } = setup(
			`<form data-drift-form="a" data-test-persist><input name="x"></form>
			<form data-drift-form="b" data-test-persist><input name="y"></form>`,
			{ persist: { storage } },
		)

		type(query(root, '[name=x]'), '1')
		type(query(root, '[name=y]'), '2')
		vi.advanceTimersByTime(100)

		drift.clearPersisted('a')

		expect(Array.from(storage.data.keys()).sort()).toEqual(['drift:b', 'drift:orphan', 'other'])

		drift.clearPersisted()

		expect(Array.from(storage.data.keys())).toEqual(['other'])
	})

	it('clears a form that has no record yet', () => {
		window.localStorage.setItem('drift:ghost', '{}')
		new Drift().clearPersisted('ghost')

		expect(window.localStorage.getItem('drift:ghost')).toBeNull()
	})

	it('reports a failing storage once, and keeps the form working in memory', () => {
		const storage = memoryStorage()

		storage.setItem = () => {
			throw new Error('quota')
		}

		const { drift, root } = setup(PROFILE, { persist: { storage } })
		const errors: DriftEventMap['error'][] = []

		drift.on('error', e => errors.push(e))
		type(query(root, '[name=name]'), 'x')
		vi.advanceTimersByTime(100)
		type(query(root, '[name=name]'), 'y')
		vi.advanceTimersByTime(100)

		expect(errors).toHaveLength(1)
		expect(errors[0]).toMatchObject({ phase: 'persist', formKey: 'profile' })
		expect(drift.form('profile').getValue('name')).toBe('y')
	})

	it('treats unreadable storage as empty', () => {
		const storage = memoryStorage()

		storage.getItem = () => {
			throw new Error('denied')
		}
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(() => setup(PROFILE, { persist: { storage } })).not.toThrow()
	})
})

describe('createPersister', () => {
	it('resolves window.localStorage only when first used', () => {
		const access = vi.spyOn(window, 'localStorage', 'get')
		const persister = createPersister(undefined, () => undefined)

		expect(access).not.toHaveBeenCalled()

		persister.load('f')

		expect(access).toHaveBeenCalledTimes(1)
	})

	it('reports a localStorage that throws on access, and does nothing', () => {
		vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
			throw new DOMException('denied', 'SecurityError')
		})

		const report = vi.fn()
		const persister = createPersister(undefined, report)

		expect(persister.load('f')).toBeNull()

		persister.save('f', {})

		expect(report).toHaveBeenCalledTimes(1)
	})
})
