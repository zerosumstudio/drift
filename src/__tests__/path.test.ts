/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, expect, it } from 'vitest'
import {
	MISSING,
	buildName,
	cloneValues,
	flattenValues,
	freezeDeep,
	getPath,
	hasPath,
	parseName,
	readPath,
	setPath,
	unsetPath,
} from '../path.js'

/*
 *   TESTS
 ***************************************************************************************************/
describe('parseName', () => {
	it('parses keys, nested keys and indices', () => {
		expect(parseName('email')?.path).toEqual(['email'])
		expect(parseName('user.address.city')?.path).toEqual(['user', 'address', 'city'])
		expect(parseName('items[0].name')?.path).toEqual(['items', 0, 'name'])
	})

	it('keeps every index of a multi-dimensional name (L1)', () => {
		expect(parseName('m[0][1]')?.path).toEqual(['m', 0, 1])
	})

	it('marks a trailing [] as an array name without adding a segment (L1)', () => {
		expect(parseName('tags[]')).toEqual({ path: ['tags'], isArrayName: true })
		expect(parseName('a.tags[]')?.path).toEqual(['a', 'tags'])
		expect(parseName('tags')?.isArrayName).toBe(false)
	})

	it.each([
		'',
		'.a',
		'a.',
		'a..b',
		'[0]',
		'a[',
		'a[x]',
		'a[-1]',
		'a]b',
		'a[]b',
		'a[][0]',
		'a[10000]',
	])('rejects the malformed name %j', name => {
		expect(parseName(name)).toBeNull()
	})

	it.each(['__proto__', 'constructor', 'prototype', 'a.__proto__', 'a.constructor.b'])(
		'rejects the prototype-reaching name %j (S3)',
		name => {
			expect(parseName(name)).toBeNull()
		},
	)

	it('accepts ordinary names that match inherited properties, since reads are own-only (S3)', () => {
		expect(parseName('toString')?.path).toEqual(['toString'])
		expect(parseName('valueOf')?.path).toEqual(['valueOf'])
	})
})

describe('buildName', () => {
	it.each(['a', 'a.b.c', 'items[0].name', 'm[0][1]', 'a.b[2]'])(
		'is the inverse of parseName for %s',
		name => {
			const parsed = parseName(name)

			expect(parsed && buildName(parsed.path)).toBe(name)
		},
	)
})

describe('reading', () => {
	const values = { a: { b: [{ c: 1 }, 'x'] }, toString: 'mine' }

	it('reads nested values', () => {
		expect(getPath(values, ['a', 'b', 0, 'c'])).toBe(1)
		expect(hasPath(values, ['a', 'b', 1])).toBe(true)
	})

	it('only reads own properties (S3)', () => {
		expect(readPath({}, ['toString'])).toBe(MISSING)
		expect(readPath({}, ['constructor'])).toBe(MISSING)
		expect(getPath(values, ['toString'])).toBe('mine')
	})

	it('tells a missing path apart from an undefined value', () => {
		expect(getPath(values, ['a', 'z'])).toBeUndefined()
		expect(hasPath(values, ['a', 'z'])).toBe(false)
		expect(hasPath({ a: undefined }, ['a'])).toBe(true)
	})

	it('does not read array length from an array', () => {
		expect(hasPath([1], ['length'])).toBe(false)
		expect(hasPath({ a: [1] }, ['a', 'length'])).toBe(false)
	})
})

describe('writing', () => {
	it('builds objects and arrays from a path', () => {
		expect(setPath({}, ['items', 0, 'name'], 'A')).toEqual({ items: [{ name: 'A' }] })
		expect(setPath({}, ['m', 0, 1], 'x')).toEqual({ m: [[undefined, 'x']] })
	})

	it('shares untouched branches and freezes new nodes (L9)', () => {
		const first = setPath({}, ['a', 'x'], 1)
		const second = setPath(first, ['b'], 2)

		expect(second.a).toBe(first.a)
		expect(Object.isFrozen(second)).toBe(true)
		expect(Object.isFrozen(second.a)).toBe(true)
		expect(() => {
			;(second as Record<string, unknown>).c = 1
		}).toThrow(TypeError)
	})

	it('stores an array leaf as a frozen copy', () => {
		const list = ['a']
		const next = setPath({}, ['tags'], list)

		list.push('b')

		expect(next.tags).toEqual(['a'])
		expect(Object.isFrozen(next.tags)).toBe(true)
	})

	it('never reaches the prototype through a written key', () => {
		const next = setPath({}, ['toString'], 'x')

		expect(Object.getPrototypeOf(next)).toBe(Object.prototype)
		expect(Reflect.get(next, 'toString')).toBe('x')
		expect(Object.prototype.toString).toBeTypeOf('function')
	})

	it('removes a key, and splices an array index', () => {
		expect(unsetPath({ a: 1, b: 2 }, ['a'])).toEqual({ b: 2 })
		expect(unsetPath({ items: [{ n: 1 }, { n: 2 }] }, ['items', 0])).toEqual({
			items: [{ n: 2 }],
		})
		expect(unsetPath({ a: { b: 1, c: 2 } }, ['a', 'b'])).toEqual({ a: { c: 2 } })
	})

	it('returns the same object when there is nothing to unset', () => {
		const values = { a: 1 }

		expect(unsetPath(values, ['z'])).toBe(values)
	})
})

describe('whole values', () => {
	it('flattens a nested object into leaves', () => {
		const leaves = flattenValues({
			user: { name: 'A' },
			tags: ['x', 'y'],
			items: [{ id: 1 }, { id: 2 }],
		})

		expect(leaves).toEqual([
			[['user', 'name'], 'A'],
			[['tags'], ['x', 'y']],
			[['items', 0, 'id'], 1],
			[['items', 1, 'id'], 2],
		])
	})

	it('skips prototype-reaching keys', () => {
		const hostile = JSON.parse('{"__proto__": {"x": 1}, "ok": 1}') as Record<string, unknown>

		expect(flattenValues(hostile)).toEqual([[['ok'], 1]])
	})

	it('keeps non-plain leaves by reference when cloning', () => {
		const file = new File(['a'], 'a.txt')
		const copy = cloneValues({ list: [file], nested: { n: 1 } })

		expect(copy.list[0]).toBe(file)
		expect(copy.nested).toEqual({ n: 1 })
	})

	it('freezes deeply', () => {
		const frozen = freezeDeep({ a: { b: [1, { c: 2 }] } })

		expect(Object.isFrozen(frozen.a.b[1])).toBe(true)
	})
})
