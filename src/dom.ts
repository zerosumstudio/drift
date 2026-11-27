/* eslint-disable @typescript-eslint/unbound-method -- the accessors are always called on an element */

/*
 *   DOM ACCESS
 ***************************************************************************************************/
// A <form> exposes its fields as named properties that shadow its own methods and properties, so
// markup like <input name="getAttribute"> breaks form.getAttribute(). Every call that can land on
// a form element goes through the prototype instead.

export function attributeOf(element: Element, name: string): string | null {
	return Element.prototype.getAttribute.call(element, name)
}

export function closestOf(element: Element, selector: string): Element | null {
	return Element.prototype.closest.call(element, selector)
}

export function matchesSelector(element: Element, selector: string): boolean {
	return Element.prototype.matches.call(element, selector)
}

export function queryAllOf(element: Element, selector: string): Element[] {
	// The string-selector overload is flagged as deprecated by mistake
	// eslint-disable-next-line @typescript-eslint/no-deprecated
	return Array.from(Element.prototype.querySelectorAll.call(element, selector))
}

export function containsNode(parent: Node, child: Node): boolean {
	return Node.prototype.contains.call(parent, child)
}

/** Looked up on first use, since the DOM classes don't exist when this is imported in Node. */
let accessors:
	| {
			isConnected: () => boolean
			getNoValidate: () => boolean
			setNoValidate: (value: boolean) => void
	  }
	| undefined

function getAccessors() {
	accessors ??= {
		isConnected: Object.getOwnPropertyDescriptor(Node.prototype, 'isConnected')
			?.get as () => boolean,
		getNoValidate: Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'noValidate')
			?.get as () => boolean,
		setNoValidate: Object.getOwnPropertyDescriptor(HTMLFormElement.prototype, 'noValidate')
			?.set as (value: boolean) => void,
	}

	return accessors
}

export function isConnectedNode(node: Node): boolean {
	return getAccessors().isConnected.call(node)
}

export function setNoValidate(form: HTMLFormElement, value: boolean): void {
	getAccessors().setNoValidate.call(form, value)
}

export function getNoValidate(form: HTMLFormElement): boolean {
	return getAccessors().getNoValidate.call(form)
}

export function addListener(
	target: EventTarget,
	type: string,
	listener: EventListener,
	options: AddEventListenerOptions,
): void {
	EventTarget.prototype.addEventListener.call(target, type, listener, options)
}

export function requestSubmitOf(form: HTMLFormElement, submitter: HTMLElement | undefined): void {
	HTMLFormElement.prototype.requestSubmit.call(form, submitter)
}
