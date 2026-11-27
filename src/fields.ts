/*
 *   TYPES
 ***************************************************************************************************/
export type FieldElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement

export type FieldKind =
	| 'text'
	| 'number'
	| 'checkbox'
	| 'checkboxGroup'
	| 'radio'
	| 'select'
	| 'selectMultiple'
	| 'file'

/** How one kind of field is read, written, defaulted and checked. */
export interface FieldCodec {
	read(elements: readonly FieldElement[]): unknown
	write(elements: readonly FieldElement[], value: unknown): void
	readDefault(elements: readonly FieldElement[]): unknown
	isEmpty(value: unknown): boolean
	/** Coerces an api-supplied value to the kind's type. A file input throws before anything changes. */
	normalize(value: unknown): unknown
	/** True when a stored value has the right type for these elements. Used when restoring. */
	matches(value: unknown, elements: readonly FieldElement[]): boolean
}

/*
 *   ELEMENTS
 ***************************************************************************************************/
const UNTRACKED_TYPES = new Set(['submit', 'button', 'reset', 'image'])

/** An input that holds a value, a textarea or a select. Buttons and the like are not fields. */
export function isFieldTag(element: Element): element is FieldElement {
	return (
		element instanceof HTMLTextAreaElement ||
		element instanceof HTMLSelectElement ||
		(element instanceof HTMLInputElement && !UNTRACKED_TYPES.has(element.type))
	)
}

export function isTrackable(element: Element): element is FieldElement {
	return isFieldTag(element) && element.name !== '' && !element.disabled
}

/** The kind a single element gives a field. A checkbox group is decided by the field. */
export function baseKind(element: FieldElement): FieldKind {
	if (element instanceof HTMLSelectElement) {
		return element.multiple ? 'selectMultiple' : 'select'
	}

	if (element instanceof HTMLTextAreaElement) {
		return 'text'
	}

	switch (element.type) {
		case 'checkbox':
			return 'checkbox'
		case 'radio':
			return 'radio'
		case 'number':
		case 'range':
			return 'number'
		case 'file':
			return 'file'
		default:
			return 'text'
	}
}

/*
 *   HELPERS
 ***************************************************************************************************/
export function isEqualValue(a: unknown, b: unknown): boolean {
	if (Object.is(a, b)) {
		return true
	}

	if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) {
		return false
	}

	return a.every((item, index) => Object.is(item, b[index]))
}

function toText(value: unknown): string {
	if (typeof value === 'string') {
		return value
	}

	return typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint'
		? String(value)
		: ''
}

function toNumber(value: unknown): number | null {
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : null
	}

	if (typeof value !== 'string' || value.trim() === '') {
		return null
	}

	const parsed = Number(value)

	return Number.isFinite(parsed) ? parsed : null
}

function toOptionalText(value: unknown): string | null {
	return value === null || value === undefined ? null : toText(value)
}

function isEmptyList(value: unknown): boolean {
	return Array.isArray(value) && value.length === 0
}

function toTextList(value: unknown): string[] {
	if (Array.isArray(value)) {
		return (value as unknown[]).map(toText)
	}

	return value === null || value === undefined || value === '' ? [] : [toText(value)]
}

function getOptionValues(elements: readonly FieldElement[]): Set<string> {
	const first = elements[0]

	if (first instanceof HTMLSelectElement) {
		return new Set(Array.from(first.options, option => option.value))
	}

	return new Set(elements.map(element => element.value))
}

/** A list of strings that are all options the field has. */
function matchesOptions(value: unknown, elements: readonly FieldElement[]): boolean {
	const known = getOptionValues(elements)

	return Array.isArray(value) && value.every(item => typeof item === 'string' && known.has(item))
}

function getInputs(elements: readonly FieldElement[]): HTMLInputElement[] {
	return elements as HTMLInputElement[]
}

function getSelect(elements: readonly FieldElement[]): HTMLSelectElement {
	return elements[0] as HTMLSelectElement
}

/*
 *   CODECS
 ***************************************************************************************************/
const text: FieldCodec = {
	read: elements => elements[0]?.value ?? '',
	write: (elements, value) => {
		const element = elements[0]

		if (element) {
			element.value = toText(value)
		}
	},
	readDefault: elements =>
		(elements[0] as HTMLInputElement | HTMLTextAreaElement | undefined)?.defaultValue ?? '',
	isEmpty: value => value === '',
	normalize: toText,
	matches: value => typeof value === 'string',
}

const number: FieldCodec = {
	read: elements => {
		const value = getInputs(elements)[0]?.valueAsNumber

		return value === undefined || Number.isNaN(value) ? null : value
	},
	write: (elements, value) => {
		const element = elements[0]

		if (element) {
			element.value = value === null ? '' : toText(value)
		}
	},
	readDefault: elements => toNumber(getInputs(elements)[0]?.defaultValue),
	isEmpty: value => value === null,
	normalize: toNumber,
	matches: value => value === null || (typeof value === 'number' && Number.isFinite(value)),
}

const checkbox: FieldCodec = {
	read: elements => getInputs(elements)[0]?.checked ?? false,
	write: (elements, value) => {
		const element = getInputs(elements)[0]

		if (element) {
			element.checked = Boolean(value)
		}
	},
	readDefault: elements => getInputs(elements)[0]?.defaultChecked ?? false,
	isEmpty: value => value === false,
	normalize: Boolean,
	matches: value => typeof value === 'boolean',
}

const checkboxGroup: FieldCodec = {
	read: elements =>
		getInputs(elements)
			.filter(element => element.checked)
			.map(element => element.value),
	write: (elements, value) => {
		const selected = toTextList(value)

		for (const element of getInputs(elements)) {
			element.checked = selected.includes(element.value)
		}
	},
	readDefault: elements =>
		getInputs(elements)
			.filter(element => element.defaultChecked)
			.map(element => element.value),
	isEmpty: isEmptyList,
	normalize: toTextList,
	matches: matchesOptions,
}

const radio: FieldCodec = {
	read: elements => getInputs(elements).find(element => element.checked)?.value ?? null,
	write: (elements, value) => {
		const selected = toOptionalText(value)

		for (const element of getInputs(elements)) {
			element.checked = element.value === selected
		}
	},
	readDefault: elements =>
		getInputs(elements).find(element => element.defaultChecked)?.value ?? null,
	isEmpty: value => value === null,
	normalize: toOptionalText,
	matches: (value, elements) =>
		value === null || (typeof value === 'string' && getOptionValues(elements).has(value)),
}

const select: FieldCodec = {
	read: elements => getSelect(elements).value,
	write: (elements, value) => {
		getSelect(elements).value = toText(value)
	},
	readDefault: elements => {
		const options = Array.from(getSelect(elements).options)

		return (options.find(option => option.defaultSelected) ?? options[0])?.value ?? ''
	},
	isEmpty: value => value === '',
	normalize: toText,
	matches: (value, elements) => typeof value === 'string' && getOptionValues(elements).has(value),
}

const selectMultiple: FieldCodec = {
	read: elements => Array.from(getSelect(elements).selectedOptions, option => option.value),
	write: (elements, value) => {
		const selected = toTextList(value)

		for (const option of getSelect(elements).options) {
			option.selected = selected.includes(option.value)
		}
	},
	readDefault: elements =>
		Array.from(getSelect(elements).options)
			.filter(option => option.defaultSelected)
			.map(option => option.value),
	isEmpty: isEmptyList,
	normalize: toTextList,
	matches: matchesOptions,
}

const file: FieldCodec = {
	read: elements => Array.from(getInputs(elements)[0]?.files ?? []),
	write: (elements, value) => {
		const element = getInputs(elements)[0]

		if (element && (value === null || isEmptyList(value))) {
			element.value = ''
		}
	},
	readDefault: () => [],
	isEmpty: isEmptyList,
	normalize: value => {
		if (value === null || (Array.isArray(value) && value.length === 0)) return []

		throw new TypeError('A file input can only be cleared, with [] or null')
	},
	matches: () => false,
}

/**
 * Whether a DOM value counts as unset when registering. A select always has a value, so one with
 * no explicit default and its first option chosen is unset, and doesn't block a restore.
 */
export function isBlank(
	kind: FieldKind,
	elements: readonly FieldElement[],
	value: unknown,
): boolean {
	if (FIELD_CODECS[kind].isEmpty(value)) {
		return true
	}

	if (kind !== 'select') {
		return false
	}

	const options = Array.from(getSelect(elements).options)

	return !options.some(option => option.defaultSelected) && value === options[0]?.value
}

export const FIELD_CODECS = {
	text,
	number,
	checkbox,
	checkboxGroup,
	radio,
	select,
	selectMultiple,
	file,
} satisfies Record<FieldKind, FieldCodec>
