/*
 *   IMPORTS
 ***************************************************************************************************/
import type { InferSchemaOutput, StandardSchemaV1 } from './schema.js'
import type { ProgrammaticTracker } from './track.js'

/*
 *   VALUES
 ***************************************************************************************************/
export type Values = Record<string, unknown>

export type DeepReadonly<T> = T extends (...args: never[]) => unknown
	? T
	: T extends readonly (infer U)[]
		? readonly DeepReadonly<U>[]
		: T extends object
			? { readonly [K in keyof T]: DeepReadonly<T[K]> }
			: T

/*
 *   VALIDATION
 ***************************************************************************************************/
export interface Issue {
	readonly message: string
	/** The field the issue belongs to. Defaults to the validated field, or the form when pathless. */
	readonly name?: string | undefined
}

export type ValidateResult = string | readonly Issue[] | undefined

export interface ValidatorContext {
	readonly name: string
	readonly values: DeepReadonly<Values>
	readonly signal: AbortSignal
}

export type FieldValidator = (
	value: unknown,
	context: ValidatorContext,
) => ValidateResult | Promise<ValidateResult>

export type FormValidator = (
	values: DeepReadonly<Values>,
	context: { readonly signal: AbortSignal },
) => readonly Issue[] | undefined | Promise<readonly Issue[] | undefined>

export type ValidationTrigger = 'submit' | 'blur' | 'change' | { readonly debounceMs: number }

/*
 *   FORM STATE
 ***************************************************************************************************/
export type FormStatus = 'idle' | 'validating' | 'submitting'

export interface FormState<TValues = Values> {
	readonly values: DeepReadonly<TValues>
	readonly errors: Readonly<Record<string, readonly string[]>>
	readonly formErrors: readonly string[]
	readonly touched: Readonly<Record<string, true>>
	readonly dirty: Readonly<Record<string, true>>
	readonly validating: Readonly<Record<string, true>>
	readonly status: FormStatus
	readonly submitCount: number
	readonly isValid: boolean
	readonly isDirty: boolean
	readonly canSubmit: boolean
}

/*
 *   SUBMIT
 ***************************************************************************************************/
export type SubmitResult<TValues> =
	| { readonly status: 'submitted'; readonly values: TValues }
	| { readonly status: 'invalid' }
	| { readonly status: 'failed'; readonly error: unknown }

export type ResetHandler = () => void | Promise<void>

export type SubmitHandler<TValues> = (
	values: TValues,
	context: { readonly formKey: string; readonly signal: AbortSignal },
) => void | Promise<void>

/*
 *   OPTIONS
 ***************************************************************************************************/
export interface FieldOptions {
	validate?: FieldValidator | StandardSchemaV1 | 'native'
	validateOn?: ValidationTrigger
	transform?: (value: unknown) => unknown
}

interface BaseFormOptions {
	fields?: Readonly<Record<string, FieldOptions>>
	validateOn?: ValidationTrigger
	initialValues?: Values
	/** Stores this form's values, subject to the fixed denylist. Only code can turn it on. */
	persist?: boolean
}

export interface FormOptions extends BaseFormOptions {
	validate?: FormValidator | StandardSchemaV1 | 'native'
}

export interface SchemaFormOptions<TSchema extends StandardSchemaV1> extends BaseFormOptions {
	validate: TSchema
}

export type FormOutput<TSchema> = TSchema extends StandardSchemaV1
	? InferSchemaOutput<TSchema>
	: Values

/*
 *   FORM HANDLE
 ***************************************************************************************************/
export interface FormHandle<TValues = Values> {
	readonly formKey: string
	getState(): FormState
	subscribe(listener: (state: FormState) => void): () => void
	getValue(name: string): unknown
	setValue(name: string, value: unknown): void
	setValues(values: Values): void
	unsetValue(name: string): void
	setInitialValues(values: Values): void
	setErrors(errors: Readonly<Record<string, readonly string[]>>): void
	clearErrors(name?: string): void
	validate(name?: string): Promise<boolean>
	submit(): Promise<SubmitResult<TValues>>
	reset(): Promise<void>
	onSubmit(handler: SubmitHandler<TValues>): () => void
	onReset(handler: ResetHandler): () => void
}

/*
 *   PERSISTENCE
 ***************************************************************************************************/
export interface PersistStorage {
	getItem(key: string): string | null
	setItem(key: string, value: string): void
	removeItem(key: string): void
	/** `window.localStorage` has both, which lets `clearPersisted()` find every key under the prefix. */
	readonly length?: number
	key?(index: number): string | null
}

export interface PersistConfig {
	/** Default `window.localStorage`, resolved on first use. */
	storage?: PersistStorage
	/** Storage key prefix. Default `'drift'`. */
	keyPrefix?: string
	/** Default `1`. */
	version?: number
	/** Stored values older than this are dropped. Default one day. */
	maxAgeMs?: number
	migrate?: (values: unknown, fromVersion: number) => unknown
}

/*
 *   CONFIG
 ***************************************************************************************************/
export interface DriftConfig {
	/** Default `'data-drift'`, which gives `-form`, `-ignore`, `-persist` and `-error`. */
	attributePrefix?: string
	/** Default `'submit'`. */
	validateOn?: ValidationTrigger
	persist?: PersistConfig
	/** Default `false`. */
	aria?: boolean
	/** Default `false`. */
	trackProgrammaticChanges?: ProgrammaticTracker
	/** Default `'Could not validate this field.'`. */
	validatorErrorMessage?: string
}

/*
 *   EVENTS
 ***************************************************************************************************/
export interface DriftEventMap {
	'form:register': { readonly formKey: string }
	'form:unregister': { readonly formKey: string }
	'form:reset': { readonly formKey: string }
	'field:register': { readonly formKey: string; readonly name: string; readonly value: unknown }
	'field:unregister': { readonly formKey: string; readonly name: string }
	'field:change': {
		readonly formKey: string
		readonly name: string
		readonly value: unknown
		readonly source: 'user' | 'api'
	}
	'field:focus': { readonly formKey: string; readonly name: string }
	'field:blur': { readonly formKey: string; readonly name: string }
	'validation:start': { readonly formKey: string; readonly name?: string | undefined }
	'validation:end': {
		readonly formKey: string
		readonly name?: string | undefined
		readonly isValid: boolean
	}
	'submit:start': { readonly formKey: string }
	'submit:end': { readonly formKey: string; readonly result: SubmitResult<unknown> }
	error: {
		readonly formKey: string
		readonly name?: string | undefined
		readonly phase: ErrorPhase
		readonly error: unknown
	}
}

export type ErrorPhase = 'validate' | 'submit' | 'reset' | 'persist' | 'register'

export type DriftErrorCode = 'NO_DOM' | 'NO_BODY'
