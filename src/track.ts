/* eslint-disable @typescript-eslint/unbound-method -- the accessors are always called on the element */

/*
 *   IMPORTS
 ***************************************************************************************************/
import type { FieldElement, FieldKind } from './fields.js'

/*
 *   TYPES
 ***************************************************************************************************/
/** What `trackProgrammaticChanges` is: pass this entry's function in the `Drift` config. */
export type ProgrammaticTracker = (
	element: FieldElement,
	kind: FieldKind,
	onChange: () => void,
	isWriting: () => boolean,
) => (() => void) | null

/*
 *   HELPERS
 ***************************************************************************************************/
/** The element's own descriptor (React's value tracker defines one), or the first on its prototypes. */
function findDescriptor(element: FieldElement, property: string): PropertyDescriptor | undefined {
	let prototype: unknown = element

	while (prototype) {
		const descriptor = Object.getOwnPropertyDescriptor(prototype, property)

		if (descriptor) {
			return descriptor
		}

		prototype = Object.getPrototypeOf(prototype)
	}

	return undefined
}

function getAccessors(
	descriptor: PropertyDescriptor | undefined,
): { read: () => unknown; write: (value: unknown) => void } | null {
	const read = descriptor?.get as (() => unknown) | undefined
	const write = descriptor?.set as ((value: unknown) => void) | undefined

	return read && write ? { read, write } : null
}

/*
 *   PROGRAMMATIC CHANGES
 ***************************************************************************************************/
/**
 * Reports `element.value = x` and `element.checked = x` writes that fire no event. It wraps the
 * element's own descriptor when there is one, or the prototype's otherwise, and returns a function
 * that puts the previous state back.
 */
export const trackProgrammaticChanges: ProgrammaticTracker = (
	element,
	kind,
	onChange,
	isWriting,
) => {
	const isCheckable = kind === 'checkbox' || kind === 'checkboxGroup' || kind === 'radio'
	const property = isCheckable ? 'checked' : 'value'
	const own = Object.getOwnPropertyDescriptor(element, property)
	const descriptor = own ?? findDescriptor(element, property)
	const accessors = getAccessors(descriptor)

	if (!descriptor || !accessors) {
		return null
	}

	const { read, write } = accessors

	Object.defineProperty(element, property, {
		configurable: true,
		enumerable: descriptor.enumerable ?? false,
		get: () => read.call(element),
		set: (next: unknown) => {
			const before = read.call(element)

			write.call(element, next)

			if (!isWriting() && !Object.is(before, read.call(element))) {
				onChange()
			}
		},
	})

	return () => {
		if (own) {
			Object.defineProperty(element, property, own)
		} else {
			Reflect.deleteProperty(element, property)
		}
	}
}
