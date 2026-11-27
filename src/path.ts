/*
 *   IMPORTS
 ***************************************************************************************************/
import type { Values } from './types.js'

/*
 *   TYPES
 ***************************************************************************************************/
export type PathSegment = string | number
export type Path = readonly PathSegment[]

export interface ParsedName {
	readonly path: Path
	/** The name ends in `[]`, which marks an array field. */
	readonly isArrayName: boolean
}

/*
 *   CONSTANTS
 ***************************************************************************************************/
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype'])
const STRUCTURAL: ReadonlySet<string> = new Set(['.', '[', ']'])
/** What `readPath` returns for an absent path, so `undefined` stays a real value. */
export const MISSING = Symbol('missing')

/*
 *   NAMES
 ***************************************************************************************************/
/**
 * Parse a field name such as `a.b`, `items[0].name`, `m[0][1]` or `tags[]` into path segments.
 * Returns null when the name is malformed or uses a key that could reach the prototype chain.
 */
export function parseName(name: string): ParsedName | null {
	const path: PathSegment[] = []
	let isArrayName: boolean
	let index = 0

	for (;;) {
		const start = index

		while (index < name.length && !STRUCTURAL.has(name.charAt(index))) {
			index++
		}

		const key = name.slice(start, index)

		if (key === '' || FORBIDDEN_KEYS.has(key)) return null

		path.push(key)

		const indexes = readIndexes(name, index, path)

		if (!indexes) return null

		index = indexes.next
		isArrayName = indexes.isArrayName

		if (index >= name.length) return { path, isArrayName }

		if (name.charAt(index) !== '.') return null

		index++
	}
}

/**
 * Reads the `[0]` parts after a key, and a closing `[]` that marks an array name. Pushes the
 * indexes onto `path` and returns where the key ends, or null when a bracket is malformed.
 */
function readIndexes(
	name: string,
	start: number,
	path: PathSegment[],
): { next: number; isArrayName: boolean } | null {
	let index = start

	while (name.charAt(index) === '[') {
		const close = name.indexOf(']', index)
		const digits = name.slice(index + 1, close)

		if (close === -1) return null

		if (digits === '') {
			return close === name.length - 1 ? { next: close + 1, isArrayName: true } : null
		}

		// One to four digits, so an index can't be big enough to allocate a huge array
		if (!/^\d{1,4}$/.test(digits)) return null

		path.push(Number(digits))
		index = close + 1
	}

	return { next: index, isArrayName: false }
}

/** The inverse of `parseName` for a path, so a Standard Schema issue path maps to a field name. */
export function buildName(path: Path): string {
	let name = ''

	for (const segment of path) {
		if (typeof segment === 'number') name += `[${segment}]`
		else name += name === '' ? segment : `.${segment}`
	}

	return name
}

/*
 *   READING
 ***************************************************************************************************/
export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readChild(node: unknown, segment: PathSegment): unknown {
	if (typeof segment === 'number') {
		return Array.isArray(node) && Object.hasOwn(node, segment)
			? (node[segment] as unknown)
			: MISSING
	}

	return isRecord(node) && Object.hasOwn(node, segment) ? node[segment] : MISSING
}

/** Reads a path using own properties only, and returns the `MISSING` sentinel when absent. */
export function readPath(root: unknown, path: Path): unknown {
	let node = root

	for (const segment of path) {
		node = readChild(node, segment)

		if (node === MISSING) return MISSING
	}

	return node
}

export function getPath(root: unknown, path: Path): unknown {
	const value = readPath(root, path)

	return value === MISSING ? undefined : value
}

export function hasPath(root: unknown, path: Path): boolean {
	return readPath(root, path) !== MISSING
}

/*
 *   WRITING
 ***************************************************************************************************/
/** Spread defines own properties, so an own `__proto__` key stays a plain key. */
function createRecord(source?: Record<string, unknown>): Record<string, unknown> {
	return { ...source }
}

function freezeLeaf(value: unknown): unknown {
	return Array.isArray(value) ? Object.freeze([...(value as unknown[])]) : value
}

function assign(node: unknown, path: Path, depth: number, value: unknown): unknown {
	const segment = path[depth]

	if (segment === undefined) return freezeLeaf(value)

	const existing = readChild(node, segment)
	const next = assign(existing === MISSING ? undefined : existing, path, depth + 1, value)

	if (typeof segment === 'number') {
		const copy: unknown[] = Array.isArray(node) ? [...(node as unknown[])] : []

		copy[segment] = next

		return Object.freeze(copy)
	}

	const copy = createRecord(isRecord(node) ? node : undefined)

	copy[segment] = next

	return Object.freeze(copy)
}

/** Returns a copy of `root` with the value written at `path`. New nodes are frozen. */
export function setPath(root: Values, path: Path, value: unknown): Values {
	return assign(root, path, 0, value) as Values
}

function remove(node: unknown, path: Path, depth: number): unknown {
	const segment = path[depth]

	if (segment === undefined) return node

	const isLast = depth === path.length - 1

	if (Array.isArray(node) && typeof segment === 'number') {
		const copy = [...(node as unknown[])]

		if (isLast) copy.splice(segment, 1)
		else copy[segment] = remove(copy[segment], path, depth + 1)

		return Object.freeze(copy)
	}

	const copy = createRecord(node as Record<string, unknown>)

	if (isLast) Reflect.deleteProperty(copy, segment)
	else copy[segment] = remove(copy[segment], path, depth + 1)

	return Object.freeze(copy)
}

/** Returns a copy of `root` without the value at `path`. An array index is spliced out. */
export function unsetPath(root: Values, path: Path): Values {
	if (!hasPath(root, path)) return root

	return remove(root, path, 0) as Values
}

/*
 *   WHOLE VALUES
 ***************************************************************************************************/
/**
 * Lists the leaves of a nested values object. An array of primitives is one leaf, which is how a
 * checkbox group or a multi-select is stored, while an array holding objects is walked by index.
 */
export function flattenValues(
	values: Values,
	base: Path = [],
	out: Array<readonly [Path, unknown]> = [],
): Array<readonly [Path, unknown]> {
	for (const [key, value] of Object.entries(values)) {
		if (FORBIDDEN_KEYS.has(key)) continue

		const path = [...base, key]

		if (isPlainObject(value)) {
			flattenValues(value, path, out)
		} else if (Array.isArray(value) && (value as unknown[]).some(isPlainObject)) {
			;(value as unknown[]).forEach((item, index) => {
				if (isPlainObject(item)) flattenValues(item, [...path, index], out)
				else out.push([[...path, index], item])
			})
		} else {
			out.push([path, value])
		}
	}

	return out
}

function isPlainObject(value: unknown): value is Values {
	if (!isRecord(value)) return false

	const prototype: unknown = Object.getPrototypeOf(value)

	return prototype === Object.prototype || prototype === null
}

/** A deep copy that keeps non-plain leaves, such as `File`, by reference. */
export function cloneValues<T>(value: T): T {
	if (Array.isArray(value)) return (value as unknown[]).map(cloneValues) as T

	if (isPlainObject(value)) {
		const entries = Object.entries(value).map(([key, child]) => [key, cloneValues(child)])

		return Object.fromEntries(entries) as T
	}

	return value
}

export function freezeDeep<T>(value: T): T {
	if (Array.isArray(value)) {
		for (const item of value as unknown[]) freezeDeep(item)

		return Object.freeze(value)
	}

	if (isPlainObject(value)) {
		for (const child of Object.values(value)) freezeDeep(child)

		return Object.freeze(value)
	}

	return value
}
