/*
 *   IMPORTS
 ***************************************************************************************************/
import { attributeOf, queryAllOf } from './dom.js'
import type { FieldElement } from './fields.js'

/*
 *   TYPES
 ***************************************************************************************************/
interface AriaField {
	readonly name: string
	readonly elements: readonly FieldElement[]
}

type ErrorsByName = Readonly<Record<string, readonly string[]>>

/*
 *   STATE
 ***************************************************************************************************/
let slotCount = 0

/*
 *   HELPERS
 ***************************************************************************************************/
function createSlotId(doc: Document): string {
	let id: string

	do {
		id = `drift-error-${++slotCount}`
	} while (doc.getElementById(id))

	return id
}

function collectSlots(root: Element, slotAttribute: string): Map<string, Element> {
	const slots = new Map<string, Element>()

	for (const slot of queryAllOf(root, `[${slotAttribute}]`)) {
		const name = attributeOf(slot, slotAttribute)

		if (name !== null && !slots.has(name)) {
			slots.set(name, slot)
		}
	}

	return slots
}

function linkDescribedBy(element: FieldElement, id: string): void {
	const tokens = (element.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean)

	if (!tokens.includes(id)) {
		element.setAttribute('aria-describedby', [...tokens, id].join(' '))
	}
}

/*
 *   WIRING
 ***************************************************************************************************/
/**
 * Sets `aria-invalid` on invalid fields and writes the messages into the form's
 * `data-drift-error="<name>"` slots, linking each slot through `aria-describedby`.
 */
export function applyAria(
	root: Element,
	slotAttribute: string,
	fields: Iterable<AriaField>,
	errors: ErrorsByName,
): void {
	const slots = collectSlots(root, slotAttribute)

	for (const field of fields) {
		const messages = errors[field.name]
		const slot = slots.get(field.name)

		if (slot) {
			const text = messages ? messages.join(' ') : ''

			if (slot.textContent !== text) {
				slot.textContent = text
			}

			slot.id ||= createSlotId(slot.ownerDocument)
		}

		for (const element of field.elements) {
			if (messages) {
				element.setAttribute('aria-invalid', 'true')
			} else {
				element.removeAttribute('aria-invalid')
			}

			if (slot) {
				linkDescribedBy(element, slot.id)
			}
		}
	}
}

/** Focuses the first invalid field in DOM order. */
export function focusFirstInvalid(fields: Iterable<AriaField>, errors: ErrorsByName): void {
	let first: FieldElement | undefined

	for (const field of fields) {
		const element = field.elements[0]

		if (!element || !errors[field.name]) {
			continue
		}

		if (!first || first.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_PRECEDING) {
			first = element
		}
	}

	first?.focus()
}
