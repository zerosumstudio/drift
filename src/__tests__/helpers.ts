/*
 *   IMPORTS
 ***************************************************************************************************/
import { Drift } from '../drift.js'
import type { DriftConfig } from '../types.js'

/*
 *   HELPERS
 ***************************************************************************************************/
export function mount(html: string): HTMLElement {
	const container = document.createElement('div')

	container.innerHTML = html
	document.body.appendChild(container)

	return container
}

export function setup(html: string, config?: DriftConfig): { drift: Drift; root: HTMLElement } {
	const root = mount(html)
	const drift = new Drift(config)

	drift.observe(root)

	return { drift, root }
}

export function query<T extends Element = HTMLInputElement>(root: ParentNode, selector: string): T {
	const element = root.querySelector<T>(selector)

	if (!element) throw new Error(`No element matches ${selector}`)

	return element
}

export function type(element: HTMLInputElement | HTMLTextAreaElement, value: string): void {
	element.value = value
	element.dispatchEvent(new Event('input', { bubbles: true }))
}

export function change(element: HTMLElement): void {
	element.dispatchEvent(new Event('change', { bubbles: true }))
}

export function blur(element: HTMLElement): void {
	element.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))
}

export function focus(element: HTMLElement): void {
	element.dispatchEvent(new FocusEvent('focusin', { bubbles: true }))
}

export function submitEvent(form: HTMLElement): Event {
	const event = new Event('submit', { bubbles: true, cancelable: true })

	form.dispatchEvent(event)

	return event
}

/** Lets the observer's microtask and any pending promise chains run. */
export async function flush(): Promise<void> {
	await new Promise<void>(resolve => {
		setTimeout(resolve, 0)
	})
}

export function deferred<T = void>(): {
	promise: Promise<T>
	resolve: (value: T) => void
	reject: (error: unknown) => void
} {
	let resolve!: (value: T) => void
	let reject!: (error: unknown) => void
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})

	return { promise, resolve, reject }
}
