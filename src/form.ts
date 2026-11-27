/*
 *   IMPORTS
 ***************************************************************************************************/
import { applyAria, focusFirstInvalid } from './aria.js'
import { getNoValidate, setNoValidate } from './dom.js'
import {
	FIELD_CODECS,
	baseKind,
	isBlank,
	isEqualValue,
	type FieldCodec,
	type FieldElement,
	type FieldKind,
} from './fields.js'
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
	type Path,
} from './path.js'
import { isPersistable, markIfDenied, type Persister } from './persist.js'
import { fromStandardIssues, isStandardSchema, type StandardSchemaV1 } from './schema.js'
import type { ProgrammaticTracker } from './track.js'
import type {
	DriftEventMap,
	ErrorPhase,
	FieldOptions,
	FormHandle,
	FormOptions,
	FormState,
	FormStatus,
	FormValidator,
	Issue,
	ResetHandler,
	SubmitHandler,
	SubmitResult,
	ValidationTrigger,
	Values,
} from './types.js'
import { nativeIssues, toIssues } from './validation.js'

/*
 *   TYPES
 ***************************************************************************************************/
export interface AttributeNames {
	readonly form: string
	readonly ignore: string
	readonly persist: string
	readonly error: string
}

export interface ResolvedConfig {
	readonly attributes: AttributeNames
	readonly validateOn: ValidationTrigger
	readonly aria: boolean
	readonly track: ProgrammaticTracker | undefined
	readonly validatorErrorMessage: string
}

export interface FormHost {
	readonly config: ResolvedConfig
	readonly persister: Persister
	emit<TType extends keyof DriftEventMap>(type: TType, payload: DriftEventMap[TType]): void
	warn(message: string): void
}

export interface FieldRecord {
	readonly name: string
	readonly path: Path
	readonly pathKey: string
	kind: FieldKind
	elements: FieldElement[]
	defaultValue: unknown
	/** True while drift writes the DOM, so its own writes aren't read back as changes. */
	isWriting: boolean
}

type ErrorSource = `field:${string}` | 'form' | 'manual'
type WriteSource = 'user' | 'api' | 'init' | 'reset' | 'restore'
type Listener = (state: FormState) => void
type FieldValidatorSpec = NonNullable<FieldOptions['validate']>

interface Run {
	readonly controller: AbortController
	readonly name: string | undefined
	promise: Promise<boolean>
}

/** What a validation run is for. A scope limits a form-level run to one field's issues. */
interface RunTarget {
	readonly source: ErrorSource
	readonly scope: string | null
	readonly name: string | undefined
}

interface ResolvedOptions {
	validate: FormOptions['validate']
	fields: Map<string, FieldOptions>
	validateOn: FormOptions['validateOn']
	persist: boolean
}

/*
 *   CONSTANTS
 ***************************************************************************************************/
const EMPTY: Values = Object.freeze({})
const PERSIST_DEBOUNCE_MS = 100
const MAX_SUBMIT_PASSES = 3

/*
 *   HELPERS
 ***************************************************************************************************/
function createFlags<T>(): Record<string, T> {
	return Object.create(null) as Record<string, T>
}

function isGroupKind(kind: FieldKind): boolean {
	return kind === 'radio' || kind === 'checkbox' || kind === 'checkboxGroup'
}

/** Whether two paths run into each other, because one is a prefix of the other or they are equal. */
function isOverlapping(a: Path, b: Path): boolean {
	const length = Math.min(a.length, b.length)

	return a.slice(0, length).every((segment, index) => segment === b[index])
}

/*
 *   FORM RECORD
 ***************************************************************************************************/
/**
 * The state of one form. It exists from the first use of its key, and the element that the DOM
 * provides attaches to it. Values live here, so removing the element keeps them.
 */
export class FormRecord {
	readonly key: string
	readonly handle: FormHandle<unknown>
	element: Element | null = null

	readonly #host: FormHost
	readonly #fields = new Map<string, FieldRecord>()
	readonly #byPath = new Map<string, FieldRecord>()
	readonly #sources = new Map<ErrorSource, ReadonlyMap<string, readonly string[]>>()
	readonly #touched = new Set<string>()
	readonly #runs = new Map<string, Run>()
	readonly #timers = new Map<string, ReturnType<typeof setTimeout>>()
	readonly #listeners = new Set<Listener>()
	readonly #queue: Array<() => void> = []

	#values: Values = EMPTY
	#initialValues: Values = EMPTY
	#options: ResolvedOptions = {
		validate: undefined,
		fields: new Map(),
		validateOn: undefined,
		persist: false,
	}
	#submitHandler: SubmitHandler<unknown> | undefined
	#resetHandler: ResetHandler | undefined
	#submitRun: Promise<SubmitResult<unknown>> | null = null
	#submitController: AbortController | null = null
	#isSubmitting = false
	#submitCount = 0
	#valueVersion = 0
	#output: { readonly version: number; readonly value: unknown } | null = null
	#haveErrorsChanged = false
	#batchDepth = 0
	#hasPendingPublish = false
	#persistTimer: ReturnType<typeof setTimeout> | undefined
	#stored: Values | null | undefined
	#previousNoValidate: boolean | null = null
	#state: FormState

	constructor(key: string, host: FormHost) {
		this.key = key
		this.#host = host
		this.#state = this.#buildState()
		this.handle = this.#createHandle()
	}

	/*
	 *   OPTIONS
	 ************************************************************************************************/
	configure(options: FormOptions | undefined): void {
		if (!options) {
			return
		}

		const wasPersisted = this.#options.persist

		this.#options = {
			validate: options.validate,
			fields: new Map(Object.entries(options.fields ?? {})),
			validateOn: options.validateOn,
			persist: options.persist === true,
		}

		this.#dropOrphanedErrors()

		const { initialValues } = options

		// Configuring again with the same initial values, as a render would, must not undo typing
		if (
			initialValues &&
			JSON.stringify(initialValues) !== JSON.stringify(this.#initialValues)
		) {
			this.setInitialValues(initialValues)
		}

		this.#applyNoValidate()

		if (this.#options.persist && !wasPersisted && this.#fields.size > 0) {
			this.#stored = undefined
			this.#batch(() => {
				for (const field of this.#fields.values()) {
					this.#syncField(field, false)
				}
			})
		}
	}

	/** Errors written by a validator that options no longer have would block submit for good. */
	#dropOrphanedErrors(): void {
		let hasDropped = false

		for (const source of [...this.#sources.keys()]) {
			if (this.#isOrphaned(source)) {
				this.#sources.delete(source)
				hasDropped = true
			}
		}

		if (hasDropped) {
			this.#haveErrorsChanged = true
			this.#publish()
		}
	}

	#isOrphaned(source: ErrorSource): boolean {
		if (source === 'manual') {
			return false
		}

		if (source === 'form') {
			return !this.#hasFormValidator()
		}

		return this.#getFieldValidator(source.slice('field:'.length)) === undefined
	}

	isRunning(): boolean {
		return this.#submitRun !== null
	}

	hasSubmitHandler(): boolean {
		return this.#submitHandler !== undefined
	}

	#hasNativeValidation(): boolean {
		const { validate, fields } = this.#options

		return (
			validate === 'native' ||
			Array.from(fields.values()).some(item => item.validate === 'native')
		)
	}

	#applyNoValidate(): void {
		const form = this.element

		if (form === null || !(form instanceof HTMLFormElement)) {
			return
		}

		if (!this.#hasNativeValidation()) {
			this.#restoreNoValidate()
		} else if (this.#previousNoValidate === null) {
			this.#previousNoValidate = getNoValidate(form)
			setNoValidate(form, true)
		}
	}

	#restoreNoValidate(): void {
		const form = this.element

		if (form !== null && form instanceof HTMLFormElement && this.#previousNoValidate !== null) {
			setNoValidate(form, this.#previousNoValidate)
		}

		this.#previousNoValidate = null
	}

	/*
	 *   ELEMENT
	 ************************************************************************************************/
	attach(element: Element): void {
		this.element = element
		this.#stored = undefined
		this.#haveErrorsChanged = true
		this.#applyNoValidate()
		this.#host.emit('form:register', { formKey: this.key })
	}

	detach(): void {
		this.#abortAll()
		this.flushPersist()
		this.#restoreNoValidate()
		this.element = null
		this.#host.emit('form:unregister', { formKey: this.key })
	}

	getElements(): FieldElement[] {
		return Array.from(this.#fields.values()).flatMap(field => field.elements)
	}

	/*
	 *   FIELDS
	 ************************************************************************************************/
	#hasConflict(path: Path): boolean {
		return Array.from(this.#fields.values()).some(other => isOverlapping(path, other.path))
	}

	#skip(name: string, reason: string): null {
		this.#host.warn(`Field "${name}" in form "${this.key}" ${reason}, so it is not tracked`)

		return null
	}

	/** Whether an element may join a field that already has one. Only radios and checkboxes share. */
	#canJoin(field: FieldRecord, kind: FieldKind): boolean {
		const primary = field.elements[0]

		if (!primary || baseKind(primary) !== kind) {
			this.#skip(field.name, 'mixes input kinds')

			return false
		}

		if (kind !== 'radio' && kind !== 'checkbox') {
			this.#skip(field.name, 'appears twice')

			return false
		}

		return true
	}

	#createField(name: string, kind: FieldKind): FieldRecord | null {
		const parsed = parseName(name)

		if (!parsed) {
			return this.#skip(name, 'has a name that is not valid')
		}

		if (this.#hasConflict(parsed.path)) {
			return this.#skip(name, 'collides with another field')
		}

		const field: FieldRecord = {
			name,
			path: parsed.path,
			pathKey: buildName(parsed.path),
			kind: kind === 'checkbox' && parsed.isArrayName ? 'checkboxGroup' : kind,
			elements: [],
			defaultValue: undefined,
			isWriting: false,
		}

		this.#fields.set(name, field)
		this.#byPath.set(field.pathKey, field)

		return field
	}

	/** Adds an element to its field, creating the field when it's the first. Null when it's skipped. */
	bind(element: FieldElement): FieldRecord | null {
		const kind = baseKind(element)
		const existing = this.#fields.get(element.name)

		if (existing && !this.#canJoin(existing, kind)) {
			return null
		}

		const field = existing ?? this.#createField(element.name, kind)

		if (!field) {
			return null
		}

		field.elements.push(element)

		if (field.elements.length > 1) {
			field.elements.sort((a, b) =>
				a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
			)

			if (field.kind === 'checkbox') {
				field.kind = 'checkboxGroup'
			}
		}

		field.defaultValue = FIELD_CODECS[field.kind].readDefault(field.elements)
		this.noteElement(element)

		return field
	}

	/** Records that an element is denied for good, and drops what was stored for it. */
	noteElement(element: FieldElement): void {
		if (markIfDenied(element, this.#host.config.attributes.persist)) {
			this.#schedulePersist()
		}
	}

	/** Removes an element from its field. The field goes with its last element, and its value stays. */
	unbind(field: FieldRecord, element: FieldElement): void {
		field.elements = field.elements.filter(item => item !== element)
		this.#haveErrorsChanged = true

		if (field.elements.length > 0) {
			this.#batch(() => {
				this.#syncField(field, false)
				this.#publish()
			})

			return
		}

		this.#fields.delete(field.name)
		this.#byPath.delete(field.pathKey)
		this.#cancel(field.name)
		this.#removeErrors(field.name, source => source !== 'manual')
		this.#host.emit('field:unregister', { formKey: this.key, name: field.name })
		this.#publish()
	}

	/** Reconciles the DOM with the stored value for newly bound fields, then announces them. */
	register(fields: Iterable<FieldRecord>): void {
		this.#batch(() => {
			for (const field of fields) {
				try {
					this.#syncField(field, true)
				} catch (error) {
					this.#fail('register', error, field.name)
				}
			}

			// Errors that exist before their fields do get their aria markup now
			this.#haveErrorsChanged = true
			this.#publish()
		})
	}

	/**
	 * The DOM wins when it holds a value. Otherwise the form's own value is written into the
	 * element, then a stored value, and an empty DOM value is recorded last.
	 */
	#syncField(field: FieldRecord, announce: boolean): void {
		const codec = FIELD_CODECS[field.kind]
		const dom = codec.read(field.elements)
		const current = getPath(this.#values, field.path)

		if (!isBlank(field.kind, field.elements, dom) || field.kind === 'file') {
			this.#write(field.path, dom, 'restore', true)
		} else if (hasPath(this.#values, field.path) && !codec.isEmpty(current)) {
			this.#write(field.path, current, 'restore')
		} else {
			const stored = this.#getStoredValue(field)

			if (stored === MISSING || codec.isEmpty(stored)) {
				this.#write(field.path, dom, 'restore', true)
			} else {
				this.#write(field.path, stored, 'restore')
			}
		}

		if (announce) {
			const value = getPath(this.#values, field.path)

			this.#notify(() => {
				this.#host.emit('field:register', { formKey: this.key, name: field.name, value })
			})
		}
	}

	/*
	 *   WRITING
	 ************************************************************************************************/
	#getInitialValue(field: FieldRecord): unknown {
		const initial = readPath(this.#initialValues, field.path)

		if (initial === MISSING || field.kind === 'file') {
			return field.defaultValue
		}

		return FIELD_CODECS[field.kind].normalize(initial)
	}

	/** Applies the field's transform, coerces the value to its kind, and writes it into the DOM. */
	#prepare(
		field: FieldRecord,
		value: unknown,
		source: WriteSource,
		domHasValue: boolean,
	): unknown {
		const codec = FIELD_CODECS[field.kind]
		const isExternal = source === 'user' || source === 'api'
		const transform = isExternal ? this.#options.fields.get(field.name)?.transform : undefined
		let next = value

		if (transform) {
			next = codec.normalize(transform(next))
		} else if (!domHasValue) {
			next = codec.normalize(field.kind === 'file' && !isExternal ? [] : next)
		}

		return domHasValue ? next : this.#writeDom(field, codec, next)
	}

	/** Writes the DOM, and reads it back, because the DOM is what holds the real value. */
	#writeDom(field: FieldRecord, codec: FieldCodec, value: unknown): unknown {
		field.isWriting = true

		try {
			codec.write(field.elements, value)

			return codec.read(field.elements)
		} finally {
			field.isWriting = false
		}
	}

	/**
	 * The one way a value changes. `domHasValue` says the DOM already holds the value, which is true
	 * for user input and for a programmatic write that was detected.
	 */
	#write(path: Path, value: unknown, source: WriteSource, domHasValue = source === 'user'): void {
		const field = this.#byPath.get(buildName(path))
		const next = field ? this.#prepare(field, value, source, domHasValue) : value

		if (hasPath(this.#values, path) && isEqualValue(getPath(this.#values, path), next)) {
			return
		}

		this.#values = setPath(this.#values, path, next)
		this.#valueVersion++
		this.#output = null

		if (source === 'user' || source === 'api') {
			this.#announceChange(field?.name ?? buildName(path), next, source)
		} else {
			this.#publish()
		}
	}

	#announceChange(name: string, value: unknown, source: 'user' | 'api'): void {
		this.#removeErrors(name, errorSource => errorSource === 'manual')
		this.#schedulePersist()
		this.#publish()
		this.#notify(() => {
			this.#host.emit('field:change', { formKey: this.key, name, value, source })
		})
		this.#triggerValidation(name, 'change')
	}

	/** Reads a field's value from the DOM into state. Used for input events and tracked writes. */
	readFromDom(field: FieldRecord, source: 'user' | 'api', isCommit = false): void {
		const value = FIELD_CODECS[field.kind].read(field.elements)

		this.#batch(() => {
			if (isCommit && isGroupKind(field.kind)) {
				this.#markTouched(field.name)
			}

			this.#write(field.path, value, source, true)
		})
	}

	focus(field: FieldRecord): void {
		this.#host.emit('field:focus', { formKey: this.key, name: field.name })
	}

	blur(field: FieldRecord): void {
		this.#markTouched(field.name)
		this.#host.emit('field:blur', { formKey: this.key, name: field.name })
		this.#triggerValidation(field.name, 'blur')
	}

	#markTouched(name: string): void {
		if (this.#touched.has(name)) {
			return
		}

		this.#touched.add(name)
		this.#publish()
	}

	#resolvePath(name: string): Path | null {
		return this.#fields.get(name)?.path ?? parseName(name)?.path ?? null
	}

	#resolveName(raw: string): string {
		return this.#byPath.get(raw)?.name ?? raw
	}

	/*
	 *   ERRORS
	 ************************************************************************************************/
	#hasValidatorErrors(name?: string): boolean {
		for (const [source, errors] of this.#sources) {
			if (source !== 'manual' && (name === undefined ? errors.size > 0 : errors.has(name))) {
				return true
			}
		}

		return false
	}

	#setSource(source: ErrorSource, errors: ReadonlyMap<string, readonly string[]>): void {
		if (errors.size > 0) {
			this.#sources.set(source, errors)
		} else {
			this.#sources.delete(source)
		}

		this.#haveErrorsChanged = true
	}

	/** Removes a name's errors from the sources the filter picks, and says whether any went. */
	#removeErrors(name: string, shouldRemove: (source: ErrorSource) => boolean): boolean {
		let hasRemoved = false

		for (const [source, errors] of this.#sources) {
			if (!errors.has(name) || !shouldRemove(source)) {
				continue
			}

			const next = new Map(errors)

			next.delete(name)
			this.#setSource(source, next)
			hasRemoved = true
		}

		return hasRemoved
	}

	#applyIssues(source: ErrorSource, issues: readonly Issue[], scope: string | null): void {
		const written = new Map<string, string[]>()

		for (const issue of issues) {
			const name = issue.name ? this.#resolveName(issue.name) : ''
			const list = written.get(name) ?? []

			list.push(issue.message)
			written.set(name, list)
		}

		if (scope === null) {
			this.#setSource(source, written)

			return
		}

		const next = new Map(this.#sources.get(source))
		const messages = written.get(scope)

		if (messages) {
			next.set(scope, messages)
		} else {
			next.delete(scope)
		}

		this.#setSource(source, next)
	}

	setErrors(errors: Readonly<Record<string, readonly string[]>>): void {
		const next = new Map(this.#sources.get('manual'))
		let hasChanged = false

		for (const [name, messages] of Object.entries(errors)) {
			if (messages.length === 0) {
				hasChanged = next.delete(name) || hasChanged
			} else if (!isEqualValue(next.get(name), messages)) {
				next.set(name, [...messages])
				hasChanged = true
			}
		}

		if (hasChanged) {
			this.#setSource('manual', next)
			this.#publish()
		}
	}

	clearErrors(name?: string): void {
		let hasChanged: boolean

		if (name === undefined) {
			hasChanged = this.#sources.size > 0
			this.#sources.clear()
		} else {
			hasChanged = this.#removeErrors(name, () => true)
		}

		if (hasChanged) {
			this.#haveErrorsChanged = true
			this.#publish()
		}
	}

	/*
	 *   VALIDATION
	 ************************************************************************************************/
	#getFieldValidator(name: string): FieldValidatorSpec | undefined {
		const own = this.#options.fields.get(name)?.validate

		if (own !== undefined) {
			return own
		}

		return this.#options.validate === 'native' ? 'native' : undefined
	}

	#hasFormValidator(): boolean {
		const { validate } = this.#options

		return validate !== undefined && validate !== 'native'
	}

	#triggerValidation(name: string, event: 'change' | 'blur'): void {
		if (this.#getFieldValidator(name) === undefined && !this.#hasFormValidator()) {
			return
		}

		const trigger =
			this.#options.fields.get(name)?.validateOn ??
			this.#options.validateOn ??
			this.#host.config.validateOn

		if (trigger === event || this.#hasValidatorErrors(name)) {
			this.#clearTimer(name)
			void this.#validateField(name)
		} else if (event === 'change' && typeof trigger === 'object') {
			this.#debounceValidation(name, trigger.debounceMs)
		}
	}

	#debounceValidation(name: string, delayMs: number): void {
		this.#clearTimer(name)
		this.#timers.set(
			name,
			setTimeout(() => {
				this.#timers.delete(name)
				void this.#validateField(name)
			}, delayMs),
		)
	}

	#clearTimer(name: string): void {
		const timer = this.#timers.get(name)

		if (timer === undefined) {
			return
		}

		clearTimeout(timer)
		this.#timers.delete(name)
	}

	/** Runs `task` as the current run for its target. A newer run for the same target supersedes it. */
	#execute(
		target: RunTarget,
		task: (signal: AbortSignal) => readonly Issue[] | Promise<readonly Issue[]>,
	): Promise<boolean> {
		const { source, scope, name } = target
		const key = scope === null ? source : `form:${scope}`

		this.#runs.get(key)?.controller.abort()

		const run: Run = {
			controller: new AbortController(),
			name,
			promise: Promise.resolve(false),
		}

		this.#runs.set(key, run)
		this.#publish()
		this.#notify(() => {
			this.#host.emit('validation:start', { formKey: this.key, name })
		})

		const latest = () => this.#runs.get(key)?.promise ?? Promise.resolve(false)
		const isCurrent = () => this.#runs.get(key) === run

		run.promise = (async () => {
			let isValid = false

			try {
				let issues: readonly Issue[]

				try {
					issues = await task(run.controller.signal)
				} catch (error) {
					if (!isCurrent()) {
						return await latest()
					}

					issues = [{ message: this.#host.config.validatorErrorMessage, name }]
					this.#fail('validate', error, name)
				}

				if (!isCurrent()) {
					return await latest()
				}

				this.#applyIssues(source, issues, scope)
				isValid = issues.length === 0

				return isValid
			} finally {
				if (isCurrent()) {
					this.#runs.delete(key)
					this.#publish()
					this.#notify(() => {
						this.#host.emit('validation:end', { formKey: this.key, name, isValid })
					})
				}
			}
		})()

		return run.promise
	}

	#runFieldValidator(name: string, validator: FieldValidatorSpec): Promise<boolean> {
		const target: RunTarget = { source: `field:${name}`, scope: null, name }

		return this.#execute(target, async signal => {
			const field = this.#fields.get(name)
			const path = this.#resolvePath(name)
			const value = path ? getPath(this.#values, path) : undefined

			if (validator === 'native') {
				return field ? nativeIssues(field.elements, name) : []
			}

			if (isStandardSchema(validator)) {
				const result = await validator['~standard'].validate(value)

				return (result.issues ?? []).map(issue => ({ message: issue.message, name }))
			}

			return toIssues(await validator(value, { name, values: this.#values, signal }), name)
		})
	}

	#runFormValidator(scope: string | null): Promise<boolean> {
		const validator = this.#options.validate as FormValidator | StandardSchemaV1

		if (scope === null) {
			for (const [key, run] of this.#runs) {
				if (key.startsWith('form:')) {
					run.controller.abort()
					this.#runs.delete(key)
				}
			}
		}

		const target: RunTarget = { source: 'form', scope, name: scope ?? undefined }

		return this.#execute(target, async signal => {
			const version = this.#valueVersion

			if (isStandardSchema(validator)) {
				const result = await validator['~standard'].validate(this.#values)

				if (result.issues) {
					this.#output = null

					return fromStandardIssues(result.issues)
				}

				this.#output = { version, value: result.value }

				return []
			}

			return toIssues(await validator(this.#values, { signal }), undefined)
		})
	}

	async #validateField(name: string): Promise<boolean> {
		const runs: Array<Promise<boolean>> = []
		const validator = this.#getFieldValidator(name)

		if (validator !== undefined) {
			runs.push(this.#runFieldValidator(name, validator))
		}

		if (this.#hasFormValidator()) {
			runs.push(this.#runFormValidator(name))
		}

		await Promise.all(runs)

		return !this.#hasValidatorErrors(name)
	}

	async #validateAll(): Promise<boolean> {
		const runs: Array<Promise<boolean>> = []

		for (const field of this.#fields.values()) {
			const validator = this.#getFieldValidator(field.name)

			if (validator !== undefined) {
				runs.push(this.#runFieldValidator(field.name, validator))
			}
		}

		if (this.#hasFormValidator()) {
			runs.push(this.#runFormValidator(null))
		}

		await Promise.all(runs)

		return !this.#hasValidatorErrors()
	}

	validate(name?: string): Promise<boolean> {
		return name === undefined ? this.#validateAll() : this.#validateField(name)
	}

	/** Aborts every run and timer, and the in-flight submit's signal. */
	#abortAll(): void {
		for (const run of this.#runs.values()) {
			run.controller.abort()
		}

		for (const timer of this.#timers.values()) {
			clearTimeout(timer)
		}

		this.#runs.clear()
		this.#timers.clear()
		this.#submitController?.abort()
	}

	#cancel(name: string): void {
		this.#clearTimer(name)

		for (const key of [`field:${name}`, `form:${name}`]) {
			this.#runs.get(key)?.controller.abort()
			this.#runs.delete(key)
		}
	}

	/*
	 *   SUBMIT
	 ************************************************************************************************/
	submit(): Promise<SubmitResult<unknown>> {
		if (this.#submitRun) {
			return this.#submitRun
		}

		this.#submitRun = this.#runSubmit()

		return this.#submitRun
	}

	async #runSubmit(): Promise<SubmitResult<unknown>> {
		const controller = new AbortController()
		let result: SubmitResult<unknown>

		this.#submitController = controller
		this.#isSubmitting = true
		this.#submitCount++
		this.#sources.delete('manual')
		this.#haveErrorsChanged = true
		this.#publish()
		this.#host.emit('submit:start', { formKey: this.key })

		try {
			result = await this.#attemptSubmit(controller.signal)
		} catch (error) {
			this.#fail('submit', error)
			result = { status: 'failed', error }
		} finally {
			this.#submitRun = null
			this.#isSubmitting = false

			if (this.#submitController === controller) {
				this.#submitController = null
			}

			this.#publish()
		}

		this.#host.emit('submit:end', { formKey: this.key, result })

		return result
	}

	async #attemptSubmit(signal: AbortSignal): Promise<SubmitResult<unknown>> {
		let isStable = false

		for (let pass = 0; pass < MAX_SUBMIT_PASSES && !isStable; pass++) {
			const version = this.#valueVersion
			const isValid = await this.#validateAll()

			if (signal.aborted) {
				return { status: 'invalid' }
			}

			if (!isValid) {
				if (this.#host.config.aria) {
					focusFirstInvalid(this.#fields.values(), this.#state.errors)
				}

				return { status: 'invalid' }
			}

			isStable = version === this.#valueVersion
		}

		if (!isStable) {
			this.#fail(
				'submit',
				new Error('The values kept changing, so the form was not submitted'),
			)

			return { status: 'invalid' }
		}

		const values =
			this.#output?.version === this.#valueVersion
				? this.#output.value
				: cloneValues(this.#values)

		await this.#submitHandler?.(values, { formKey: this.key, signal })
		this.clearPersisted()

		return { status: 'submitted', values }
	}

	/*
	 *   RESET AND VALUES
	 ************************************************************************************************/
	async reset(): Promise<void> {
		this.#abortAll()
		this.#batch(() => {
			this.#values = this.#initialValues
			this.#valueVersion++
			this.#output = null

			for (const field of this.#fields.values()) {
				this.#write(field.path, this.#getInitialValue(field), 'reset')
			}

			this.#sources.clear()
			this.#touched.clear()
			this.#submitCount = 0
			this.#haveErrorsChanged = true
			this.clearPersisted()
			this.#publish()
		})
		this.#host.emit('form:reset', { formKey: this.key })

		try {
			await this.#resetHandler?.()
		} catch (error) {
			this.#fail('reset', error)
		}
	}

	setInitialValues(values: Values): void {
		this.#initialValues = freezeDeep(cloneValues(values))
		this.#batch(() => {
			for (const [path, value] of flattenValues(this.#initialValues)) {
				this.#write(path, value, 'init')
			}
		})
	}

	setValue(name: string, value: unknown): void {
		const path = this.#resolvePath(name)

		if (!path) {
			this.#host.warn(`"${name}" is not a valid field name`)

			return
		}

		this.#write(path, value, 'api')
	}

	setValues(values: Values): void {
		this.#batch(() => {
			for (const [path, value] of flattenValues(values)) {
				this.#write(path, value, 'api')
			}
		})
	}

	unsetValue(name: string): void {
		const path = this.#resolvePath(name)

		if (!path) {
			return
		}

		if (!hasPath(this.#values, path)) {
			this.clearErrors(name)

			return
		}

		this.#values = unsetPath(this.#values, path)
		this.#valueVersion++
		this.#output = null
		this.#touched.delete(name)
		this.#schedulePersist()
		this.clearErrors(name)
		this.#publish()
	}

	getValue(name: string): unknown {
		const path = this.#resolvePath(name)

		return path ? getPath(this.#values, path) : undefined
	}

	/*
	 *   PERSISTENCE
	 ************************************************************************************************/
	#schedulePersist(): void {
		if (!this.#options.persist) {
			return
		}

		clearTimeout(this.#persistTimer)
		this.#persistTimer = setTimeout(() => {
			this.flushPersist()
		}, PERSIST_DEBOUNCE_MS)
	}

	/** Writes a pending save now, which is what a page hide needs. */
	flushPersist(): void {
		if (this.#persistTimer === undefined) {
			return
		}

		clearTimeout(this.#persistTimer)
		this.#persistTimer = undefined

		if (!this.#options.persist) {
			return
		}

		const attribute = this.#host.config.attributes.persist
		let saved: Values = {}
		let hasValues = false

		for (const field of this.#fields.values()) {
			const value = getPath(this.#values, field.path)

			if (
				isPersistable(field.kind, field.elements, attribute) &&
				!FIELD_CODECS[field.kind].isEmpty(value)
			) {
				saved = setPath(saved, field.path, value)
				hasValues = true
			}
		}

		if (hasValues) {
			this.#host.persister.save(this.key, saved)
		} else {
			this.#host.persister.clear(this.key)
		}
	}

	clearPersisted(): void {
		clearTimeout(this.#persistTimer)
		this.#persistTimer = undefined
		this.#stored = null
		this.#host.persister.clear(this.key)
	}

	#getStoredValue(field: FieldRecord): unknown {
		const attribute = this.#host.config.attributes.persist

		if (!this.#options.persist || !isPersistable(field.kind, field.elements, attribute)) {
			return MISSING
		}

		this.#stored ??= this.#host.persister.load(this.key)

		const value = readPath(this.#stored, field.path)

		return FIELD_CODECS[field.kind].matches(value, field.elements) ? value : MISSING
	}

	/*
	 *   SNAPSHOT
	 ************************************************************************************************/
	/** The messages of every source, by name, without repeats. A pathless issue is under ''. */
	#mergeErrors(): Map<string, string[]> {
		const merged = new Map<string, string[]>()

		for (const errors of this.#sources.values()) {
			for (const [name, messages] of errors) {
				const list = merged.get(name) ?? []

				merged.set(name, [...list, ...messages.filter(message => !list.includes(message))])
			}
		}

		return merged
	}

	#getStatus(): FormStatus {
		if (this.#isSubmitting) {
			return 'submitting'
		}

		return this.#runs.size > 0 ? 'validating' : 'idle'
	}

	#buildState(): FormState {
		const errors = createFlags<readonly string[]>()
		const dirty = createFlags<true>()
		const touched = createFlags<true>()
		const validating = createFlags<true>()
		let formErrors: readonly string[] = []

		for (const [name, list] of this.#mergeErrors()) {
			if (name === '') {
				formErrors = Object.freeze(list)
			} else {
				errors[name] = Object.freeze(list)
			}
		}

		for (const field of this.#fields.values()) {
			if (!isEqualValue(getPath(this.#values, field.path), this.#getInitialValue(field))) {
				dirty[field.name] = true
			}
		}

		for (const name of this.#touched) {
			touched[name] = true
		}

		for (const run of this.#runs.values()) {
			if (run.name !== undefined) {
				validating[run.name] = true
			}
		}

		const isValid = Object.keys(errors).length === 0 && formErrors.length === 0
		const status = this.#getStatus()

		return Object.freeze({
			values: this.#values,
			errors: Object.freeze(errors),
			formErrors,
			touched: Object.freeze(touched),
			dirty: Object.freeze(dirty),
			validating: Object.freeze(validating),
			status,
			submitCount: this.#submitCount,
			isValid,
			isDirty: Object.keys(dirty).length > 0,
			canSubmit: status === 'idle' && isValid,
		})
	}

	/** Groups changes into one snapshot, one notification and one round of events. */
	#batch(run: () => void): void {
		this.#batchDepth++

		try {
			run()
		} finally {
			this.#batchDepth--

			if (this.#batchDepth === 0 && this.#hasPendingPublish) {
				this.#hasPendingPublish = false
				this.#publish()
			}
		}
	}

	#publish(): void {
		if (this.#batchDepth > 0) {
			this.#hasPendingPublish = true

			return
		}

		this.#state = this.#buildState()

		if (this.#haveErrorsChanged && this.element) {
			this.#haveErrorsChanged = false

			if (this.#host.config.aria) {
				applyAria(
					this.element,
					this.#host.config.attributes.error,
					this.#fields.values(),
					this.#state.errors,
				)
			}
		}

		for (const listener of [...this.#listeners]) {
			try {
				listener(this.#state)
			} catch (error) {
				console.error('[drift] A subscriber threw', error)
			}
		}

		for (const run of this.#queue.splice(0)) {
			run()
		}
	}

	#notify(run: () => void): void {
		if (this.#batchDepth > 0) {
			this.#queue.push(run)
		} else {
			run()
		}
	}

	#fail(phase: ErrorPhase, error: unknown, name?: string): void {
		this.#host.emit('error', { formKey: this.key, phase, error, name })
	}

	/*
	 *   HANDLE
	 ************************************************************************************************/
	#createHandle(): FormHandle<unknown> {
		return {
			formKey: this.key,
			getState: () => this.#state,
			subscribe: listener => {
				this.#listeners.add(listener)

				return () => {
					this.#listeners.delete(listener)
				}
			},
			getValue: name => this.getValue(name),
			setValue: (name, value) => {
				this.setValue(name, value)
			},
			setValues: values => {
				this.setValues(values)
			},
			unsetValue: name => {
				this.unsetValue(name)
			},
			setInitialValues: values => {
				this.setInitialValues(values)
			},
			setErrors: errors => {
				this.setErrors(errors)
			},
			clearErrors: name => {
				this.clearErrors(name)
			},
			validate: name => this.validate(name),
			submit: () => this.submit(),
			reset: () => this.reset(),
			onSubmit: handler => {
				this.#submitHandler = handler

				return () => {
					if (this.#submitHandler === handler) {
						this.#submitHandler = undefined
					}
				}
			},
			onReset: handler => {
				this.#resetHandler = handler

				return () => {
					if (this.#resetHandler === handler) {
						this.#resetHandler = undefined
					}
				}
			},
		}
	}
}
