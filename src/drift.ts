/*
 *   IMPORTS
 ***************************************************************************************************/
import {
	addListener,
	attributeOf,
	closestOf,
	containsNode,
	isConnectedNode,
	matchesSelector,
	queryAllOf,
	requestSubmitOf,
} from './dom.js'
import { isFieldTag, isTrackable, type FieldElement } from './fields.js'
import { FormRecord, type FieldRecord, type FormHost, type ResolvedConfig } from './form.js'
import { collectTargets, observedAttributes } from './observer.js'
import { createPersister, removeLegacyState, type Persister } from './persist.js'
import type { StandardSchemaV1 } from './schema.js'
import type {
	DriftConfig,
	DriftErrorCode,
	DriftEventMap,
	FormHandle,
	FormOptions,
	FormOutput,
	FormState,
	SchemaFormOptions,
} from './types.js'

/*
 *   TYPES
 ***************************************************************************************************/
interface Binding {
	readonly record: FormRecord
	readonly field: FieldRecord
	readonly element: FieldElement
	readonly type: string
	restore: (() => void) | null
}

type Listener = (event: unknown) => void

declare const process: { env: { NODE_ENV?: string } }

/*
 *   CONSTANTS
 ***************************************************************************************************/
const FIELD_SELECTOR = 'input, textarea, select'

/** Bundlers replace this, and a page with no bundler has no `process` and so counts as development. */
const IS_DEVELOPMENT = (() => {
	try {
		return process.env.NODE_ENV !== 'production'
	} catch {
		return true
	}
})()

/** Shared by every instance, so two of them on one DOM can't re-submit each other forever. */
const passThrough = new WeakSet<Element>()

/*
 *   ERRORS
 ***************************************************************************************************/
export class DriftError extends Error {
	readonly code: DriftErrorCode

	constructor(message: string, code: DriftErrorCode, options?: { cause?: unknown }) {
		super(message, options)
		this.name = 'DriftError'
		this.code = code
	}
}

/*
 *   DRIFT
 ***************************************************************************************************/
/**
 * Tracks forms and fields by their presence in the DOM. A form's key and its fields come from the
 * elements, and `form(key)` configures and reads the form those elements define. Calling it before
 * the element exists only creates the record that the DOM later fills.
 */
export class Drift {
	private readonly config: ResolvedConfig
	private readonly records = new Map<string, FormRecord>()
	private readonly listeners = new Map<keyof DriftEventMap, Set<Listener>>()
	private readonly persister: Persister
	private readonly warned = new Set<string>()
	private readonly failedForms = new WeakSet<Element>()
	private readonly host: FormHost

	private bindings = new WeakMap<Element, Binding>()
	private formOf = new WeakMap<Element, FormRecord>()
	private root: Element | null = null
	private controller: AbortController | null = null
	private observer: MutationObserver | null = null
	private hasReportedPersistError = false
	private hasSkipped = false
	private hasFreed = false

	constructor(config: DriftConfig = {}) {
		const prefix = config.attributePrefix ?? 'data-drift'

		this.config = {
			attributes: {
				form: `${prefix}-form`,
				ignore: `${prefix}-ignore`,
				persist: `${prefix}-persist`,
				error: `${prefix}-error`,
			},
			validateOn: config.validateOn ?? 'submit',
			aria: config.aria ?? false,
			track: config.trackProgrammaticChanges,
			validatorErrorMessage: config.validatorErrorMessage ?? 'Could not validate this field.',
		}

		removeLegacyState()

		this.persister = createPersister(config.persist, (error, formKey) => {
			if (this.hasReportedPersistError) {
				return
			}

			this.hasReportedPersistError = true
			this.emit('error', { formKey, phase: 'persist', error })
		})

		this.host = {
			config: this.config,
			persister: this.persister,
			emit: (type, payload) => {
				this.emit(type, payload)
			},
			warn: message => {
				this.warn(message)
			},
		}
	}

	/*
	 *   PUBLIC
	 ************************************************************************************************/
	/** Starts tracking the forms inside `root`, which defaults to `document.body`. */
	observe(root?: Element): void {
		const target = root ?? this.getDefaultRoot()

		this.disconnect()

		const controller = new AbortController()
		const options = { signal: controller.signal }
		const doc = target.ownerDocument

		this.controller = controller
		this.root = target

		addListener(target, 'input', this.handleInput, options)
		addListener(target, 'change', this.handleInput, options)
		addListener(target, 'focusin', this.handleFocusIn, options)
		addListener(target, 'focusout', this.handleFocusOut, options)
		addListener(target, 'submit', this.handleSubmit, options)
		addListener(target, 'reset', this.handleReset, options)
		doc.defaultView?.addEventListener('pagehide', this.handlePageHide, options)
		doc.addEventListener('visibilitychange', this.handleVisibility, options)

		this.observer = new MutationObserver(records => {
			this.process(records)
		})
		this.observer.observe(target, {
			childList: true,
			subtree: true,
			attributes: true,
			attributeFilter: observedAttributes(this.config.attributes),
		})

		this.reconcile(target)
	}

	/** Stops tracking and releases listeners, timers and runs. Values are kept for a later `observe()`. */
	disconnect(): void {
		this.controller?.abort()
		this.observer?.disconnect()
		this.controller = null
		this.observer = null
		this.root = null

		for (const record of this.records.values()) {
			if (record.element) {
				record.detach()
			}

			for (const element of record.getElements()) {
				this.unbindElement(element)
			}
		}

		this.bindings = new WeakMap()
		this.formOf = new WeakMap()
	}

	/** Applies pending DOM changes now instead of on the observer's next microtask. */
	scan(): void {
		if (this.observer) {
			this.process(this.observer.takeRecords())
		}
	}

	/** Configures and reads a form. The same key always returns the same handle. */
	form<TSchema extends StandardSchemaV1>(
		key: string,
		options: SchemaFormOptions<TSchema>,
	): FormHandle<FormOutput<TSchema>>
	form(key: string, options?: FormOptions): FormHandle
	form(key: string, options?: FormOptions | SchemaFormOptions<StandardSchemaV1>): FormHandle {
		const record = this.getRecord(key)

		record.configure(options)

		return record.handle as FormHandle
	}

	getForms(): ReadonlyMap<string, FormState> {
		return new Map(Array.from(this.records, ([key, record]) => [key, record.handle.getState()]))
	}

	on<TType extends keyof DriftEventMap>(
		type: TType,
		listener: (event: DriftEventMap[TType]) => void,
	): () => void {
		const set = this.listeners.get(type) ?? new Set<Listener>()
		const stored = listener as Listener

		set.add(stored)
		this.listeners.set(type, set)

		return () => {
			set.delete(stored)
		}
	}

	/** Clears one form's stored values, or every form's. Call it on sign-out. */
	clearPersisted(formKey?: string): void {
		if (formKey !== undefined) {
			const record = this.records.get(formKey)

			if (record) {
				record.clearPersisted()
			} else {
				this.persister.clear(formKey)
			}

			return
		}

		for (const record of this.records.values()) {
			record.clearPersisted()
		}

		this.persister.clearAll(this.records.keys())
	}

	/*
	 *   RECORDS AND EVENTS
	 ************************************************************************************************/
	private getRecord(key: string): FormRecord {
		let record = this.records.get(key)

		if (!record) {
			record = new FormRecord(key, this.host)
			this.records.set(key, record)
		}

		return record
	}

	private emit<TType extends keyof DriftEventMap>(
		type: TType,
		payload: DriftEventMap[TType],
	): void {
		const set = this.listeners.get(type)

		if (!set || set.size === 0) {
			if (type === 'error') {
				this.logError(payload as DriftEventMap['error'])
			}

			return
		}

		for (const listener of [...set]) {
			try {
				listener(payload)
			} catch (error) {
				console.error('[drift] A listener threw', error)
			}
		}
	}

	/** Logs where an error came from, never its message, which can echo a field's value. */
	private logError({ phase, formKey, name, error }: DriftEventMap['error']): void {
		const kind = error instanceof Error ? error.name : typeof error
		const field = name === undefined ? '' : `, field "${name}"`

		console.error(`[drift] ${phase} error (${kind}) in form "${formKey}"${field}`)
	}

	/** Warns once per message, and only in development. */
	private warn(message: string): void {
		if (!IS_DEVELOPMENT || this.warned.has(message)) {
			return
		}

		this.warned.add(message)
		console.warn(`[drift] ${message}`)
	}

	private getDefaultRoot(): Element {
		if (typeof document === 'undefined') {
			throw new DriftError('There is no document to observe. Pass a root element.', 'NO_DOM')
		}

		const body = document.body as HTMLElement | null

		if (!body) {
			throw new DriftError(
				'document.body does not exist yet. Call observe() after DOMContentLoaded.',
				'NO_BODY',
			)
		}

		return body
	}

	/*
	 *   RECONCILING
	 ************************************************************************************************/
	private process(records: readonly MutationRecord[]): void {
		for (const node of collectTargets(records)) {
			this.reconcile(node)
		}

		// A duplicate was skipped while its twin was still bound, and the twin has gone since
		if (this.hasSkipped && this.hasFreed && this.root) {
			this.hasSkipped = false
			this.hasFreed = false
			this.reconcile(this.root)
		}

		this.hasFreed = false
	}

	private queryWithin(node: Element, selector: string): Element[] {
		const found = queryAllOf(node, selector)

		return matchesSelector(node, selector) ? [node, ...found] : found
	}

	private reconcile(node: Node): void {
		if (!(node instanceof Element)) {
			return
		}

		const registered = new Map<FormRecord, Set<FieldRecord>>()

		for (const element of this.queryWithin(node, `[${this.config.attributes.form}]`)) {
			this.reconcileForm(element)
		}

		for (const element of this.queryWithin(node, FIELD_SELECTOR)) {
			this.reconcileField(element, registered)
		}

		for (const [record, fields] of registered) {
			record.register(fields)
		}
	}

	private isTracked(element: Element): boolean {
		return (
			this.root !== null &&
			isConnectedNode(element) &&
			containsNode(this.root, element) &&
			!closestOf(element, `[${this.config.attributes.ignore}]`)
		)
	}

	private reconcileForm(element: Element): void {
		const key = attributeOf(element, this.config.attributes.form)
		const current = this.formOf.get(element)
		const trackedKey = key !== null && key !== '' && this.isTracked(element) ? key : null

		if (current && current.key !== trackedKey) {
			this.formOf.delete(element)
			this.hasFreed = true
			current.detach()
		}

		if (trackedKey === null || this.formOf.has(element)) {
			return
		}

		const record = this.getRecord(trackedKey)

		if (record.element && record.element !== element) {
			this.hasSkipped = true
			this.warn(
				`Form "${trackedKey}" is on more than one element, so the later one is not tracked`,
			)

			return
		}

		this.attachForm(element, record, trackedKey)
	}

	private attachForm(element: Element, record: FormRecord, key: string): void {
		try {
			this.formOf.set(element, record)
			record.attach(element)
		} catch (error) {
			// A form that can't be tracked must not fall back to a native submit with its values
			this.formOf.delete(element)
			this.failedForms.add(element)
			this.emit('error', { formKey: key, phase: 'register', error })

			return
		}

		const { persist } = this.config.attributes

		if (attributeOf(element, persist) !== null) {
			this.warn(
				`Form "${key}" has ${persist}, which does nothing on a form. Use drift.form('${key}', { persist: true })`,
			)
		}
	}

	private findOwner(element: Element): FormRecord | null {
		if (!this.isTracked(element)) {
			return null
		}

		const host = closestOf(element, `[${this.config.attributes.form}]`)

		return (host && this.formOf.get(host)) ?? null
	}

	private keepsBinding(binding: Binding, owner: FormRecord, element: FieldElement): boolean {
		return (
			isTrackable(element) &&
			binding.record === owner &&
			binding.field.name === element.name &&
			binding.type === element.type
		)
	}

	private reconcileField(element: Element, registered: Map<FormRecord, Set<FieldRecord>>): void {
		if (!isFieldTag(element)) {
			return
		}

		const existing = this.bindings.get(element)
		const owner = this.findOwner(element)

		if (existing && owner && this.keepsBinding(existing, owner, element)) {
			owner.noteElement(element)

			return
		}

		if (existing) {
			this.unbindElement(element)
		}

		if (!owner || !isTrackable(element)) {
			return
		}

		const field = owner.bind(element)

		if (!field) {
			this.hasSkipped = true

			return
		}

		this.bindings.set(element, this.createBinding(owner, field, element))

		const fields = registered.get(owner) ?? new Set<FieldRecord>()

		fields.add(field)
		registered.set(owner, fields)
	}

	private createBinding(record: FormRecord, field: FieldRecord, element: FieldElement): Binding {
		const restore =
			field.kind === 'file'
				? null
				: (this.config.track?.(
						element,
						field.kind,
						() => {
							record.readFromDom(field, 'api')
						},
						() => field.isWriting,
					) ?? null)

		return { record, field, element, type: element.type, restore }
	}

	private unbindElement(element: Element): void {
		const binding = this.bindings.get(element)

		if (!binding) {
			return
		}

		this.bindings.delete(element)
		this.hasFreed = true
		binding.restore?.()
		binding.record.unbind(binding.field, binding.element)
	}

	/*
	 *   ROOT LISTENERS
	 ************************************************************************************************/
	private getBinding(event: Event): Binding | undefined {
		return event.target instanceof Element ? this.bindings.get(event.target) : undefined
	}

	private readonly handleInput = (event: Event): void => {
		const binding = this.getBinding(event)

		if (!binding || binding.field.isWriting) {
			return
		}

		binding.record.readFromDom(binding.field, 'user', event.type === 'change')
	}

	private readonly handleFocusIn = (event: Event): void => {
		const binding = this.getBinding(event)

		if (binding) {
			binding.record.focus(binding.field)
		}
	}

	private readonly handleFocusOut = (event: Event): void => {
		const binding = this.getBinding(event)

		if (binding) {
			binding.record.blur(binding.field)
		}
	}

	private readonly handleSubmit = (event: Event): void => {
		const form = event.target instanceof Element ? event.target : null
		const record = form && this.formOf.get(form)

		if (form && this.failedForms.has(form)) {
			event.preventDefault()

			return
		}

		if (!form || !record || passThrough.has(form)) {
			return
		}

		event.preventDefault()

		const submitter = (event as SubmitEvent).submitter as HTMLElement | null | undefined
		const hadHandler = record.hasSubmitHandler()
		const startsRun = !record.isRunning()

		void record.submit().then(result => {
			const isDone = result.status === 'submitted' && startsRun && !hadHandler

			// A browser ignores requestSubmit() inside the dispatch of the event it answers, and
			// microtasks still run inside it, so the re-submit waits for a task of its own
			if (isDone && form instanceof HTMLFormElement) {
				setTimeout(() => {
					this.submitNatively(form, record, submitter ?? undefined)
				}, 0)
			}
		})
	}

	/** Submits a validated form that has no handler, so `action` and the submitter still work. */
	private submitNatively(
		form: HTMLFormElement,
		record: FormRecord,
		submitter: HTMLElement | undefined,
	): void {
		if (!isConnectedNode(form)) {
			return
		}

		passThrough.add(form)

		try {
			requestSubmitOf(form, submitter)
		} catch (error) {
			this.emit('error', { formKey: record.key, phase: 'submit', error })
		} finally {
			passThrough.delete(form)
		}
	}

	private readonly handleReset = (event: Event): void => {
		const record = event.target instanceof Element ? this.formOf.get(event.target) : undefined

		if (!record) {
			return
		}

		event.preventDefault()
		void record.reset()
	}

	private readonly handlePageHide = (): void => {
		for (const record of this.records.values()) {
			record.flushPersist()
		}
	}

	private readonly handleVisibility = (): void => {
		if (this.root?.ownerDocument.visibilityState === 'hidden') {
			this.handlePageHide()
		}
	}
}
