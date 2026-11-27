/*
 *   IMPORTS
 ***************************************************************************************************/
import { attributeOf } from './dom.js'
import type { FieldElement, FieldKind } from './fields.js'
import { isRecord } from './path.js'
import type { PersistConfig, PersistStorage, Values } from './types.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface Persister {
	load(formKey: string): Values | null
	save(formKey: string, values: Values): void
	clear(formKey: string): void
	/** Clears every key under the prefix, plus the given form keys. */
	clearAll(formKeys: Iterable<string>): void
}

/*
 *   CONSTANTS
 ***************************************************************************************************/
const DAY_MS = 86_400_000

/** Autocomplete tokens whose values are never stored, whatever the app asks for. */
const DENIED_AUTOCOMPLETE = new Set([
	'cc-number',
	'cc-csc',
	'cc-exp',
	'cc-exp-month',
	'cc-exp-year',
	'cc-name',
	'cc-given-name',
	'cc-additional-name',
	'cc-family-name',
	'cc-type',
	'one-time-code',
	'current-password',
	'new-password',
])

const DENIED_TYPES = new Set(['password', 'hidden'])

/*
 *   DENYLIST
 ***************************************************************************************************/
/** Elements that were ever denied. A show-password toggle can't make one storable again. */
const denied = new WeakSet<Element>()

function isOptedOut(value: string | null): boolean {
	const normalized = value?.trim().toLowerCase()

	return normalized === 'off' || normalized === 'false'
}

function violatesDenylist(element: FieldElement, persistAttribute: string): boolean {
	if (element instanceof HTMLInputElement && DENIED_TYPES.has(element.type)) return true

	if (isOptedOut(attributeOf(element, persistAttribute))) return true

	const tokens = (attributeOf(element, 'autocomplete') ?? '').toLowerCase().split(/\s+/)

	return tokens.some(token => DENIED_AUTOCOMPLETE.has(token))
}

/** Denies an element for good if it breaks the denylist, and returns true when that is new. */
export function markIfDenied(element: FieldElement, persistAttribute: string): boolean {
	if (denied.has(element) || !violatesDenylist(element, persistAttribute)) {
		return false
	}

	denied.add(element)

	return true
}

/**
 * Whether a field's value may be stored. The denylist is fixed: files, password and hidden inputs,
 * payment and one-time-code autocomplete tokens, and anything marked `data-drift-persist="off"`.
 */
export function isPersistable(
	kind: FieldKind,
	elements: readonly FieldElement[],
	persistAttribute: string,
): boolean {
	if (kind === 'file') {
		return false
	}

	return elements.every(
		element => !denied.has(element) && !violatesDenylist(element, persistAttribute),
	)
}

/** Removes what 1.4 stored under one key for every form, including card numbers and passwords. */
export function removeLegacyState(): void {
	try {
		if (typeof window !== 'undefined') window.localStorage.removeItem('drift-form-state')
	} catch {
		// Storage can be blocked, and there is nothing to clean up then
	}
}

/*
 *   STORAGE
 ***************************************************************************************************/
function parseEnvelope(raw: string): { v: number; savedAt: string; values: Values } | null {
	let envelope: unknown

	try {
		envelope = JSON.parse(raw)
	} catch {
		return null
	}

	if (!isRecord(envelope)) {
		return null
	}

	const { v, savedAt, values } = envelope

	if (typeof v !== 'number' || typeof savedAt !== 'string' || !isRecord(values)) {
		return null
	}

	return { v, savedAt, values }
}

export function createPersister(
	config: PersistConfig | undefined,
	report: (error: unknown, formKey: string) => void,
): Persister {
	const prefix = config?.keyPrefix ?? 'drift'
	const version = config?.version ?? 1
	const maxAgeMs = config?.maxAgeMs ?? DAY_MS
	let resolved: PersistStorage | null | undefined

	function getStorage(): PersistStorage | null {
		if (resolved !== undefined) {
			return resolved
		}

		try {
			resolved =
				config?.storage ?? (typeof window === 'undefined' ? null : window.localStorage)
		} catch (error) {
			report(error, '')
			resolved = null
		}

		return resolved
	}

	const toStorageKey = (formKey: string) => `${prefix}:${formKey}`

	function remove(formKey: string): void {
		try {
			getStorage()?.removeItem(toStorageKey(formKey))
		} catch (error) {
			report(error, formKey)
		}
	}

	/** Reads an entry's values, or null when it is malformed, expired or from another version. */
	function parse(raw: string, formKey: string): Values | null | undefined {
		const envelope = parseEnvelope(raw)

		if (!envelope || !isFresh(envelope.savedAt)) {
			return null
		}

		if (envelope.v === version) {
			return envelope.values
		}

		return migrate(envelope.values, envelope.v, formKey)
	}

	function isFresh(savedAt: string): boolean {
		const age = Date.now() - Date.parse(savedAt)

		return !Number.isNaN(age) && age >= 0 && age <= maxAgeMs
	}

	/** Returns undefined when migrate throws, so the entry is kept for a fixed migrate to read. */
	function migrate(values: Values, from: number, formKey: string): Values | null | undefined {
		if (!config?.migrate) {
			return null
		}

		try {
			const migrated = config.migrate(values, from)

			return isRecord(migrated) ? migrated : null
		} catch (error) {
			report(error, formKey)

			return undefined
		}
	}

	return {
		load(formKey) {
			const store = getStorage()

			if (!store) {
				return null
			}

			let raw: string | null

			try {
				raw = store.getItem(toStorageKey(formKey))
			} catch (error) {
				report(error, formKey)

				return null
			}

			if (raw === null) {
				return null
			}

			const values = parse(raw, formKey)

			if (values === null) {
				remove(formKey)
			}

			return values ?? null
		},

		save(formKey, values) {
			try {
				getStorage()?.setItem(
					toStorageKey(formKey),
					JSON.stringify({ v: version, savedAt: new Date().toISOString(), values }),
				)
			} catch (error) {
				report(error, formKey)
			}
		},

		clear: remove,

		clearAll(formKeys) {
			const keys = new Set<string>(formKeys)
			const store = getStorage()

			if (store?.key && store.length !== undefined) {
				for (let index = 0; index < store.length; index++) {
					const stored = store.key(index)

					if (stored?.startsWith(`${prefix}:`)) keys.add(stored.slice(prefix.length + 1))
				}
			}

			for (const key of keys) remove(key)
		},
	}
}
