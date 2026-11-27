/*
 *   IMPORTS
 ***************************************************************************************************/
import { buildName, type PathSegment } from './path.js'
import type { Issue } from './types.js'

/*
 *   STANDARD SCHEMA TYPES
 ***************************************************************************************************/
/**
 * The subset of the Standard Schema v1 spec drift needs. Any compliant validator (zod, valibot,
 * arktype, ...) satisfies it structurally, so drift takes a schema without depending on a library.
 */
export interface StandardSchemaV1<Input = unknown, Output = Input> {
	readonly '~standard': {
		readonly version: 1
		readonly vendor: string
		readonly validate: (
			value: unknown,
		) => StandardResult<Output> | Promise<StandardResult<Output>>
		readonly types?: { readonly input: Input; readonly output: Output } | undefined
	}
}

export type StandardResult<Output> =
	| { readonly value: Output; readonly issues?: undefined }
	| { readonly issues: readonly StandardIssue[] }

export interface StandardIssue {
	readonly message: string
	readonly path?: ReadonlyArray<PropertyKey | { readonly key: PropertyKey }> | undefined
}

export type InferSchemaOutput<TSchema extends StandardSchemaV1> = NonNullable<
	TSchema['~standard']['types']
>['output']

/*
 *   HELPERS
 ***************************************************************************************************/
export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
	if (typeof value !== 'object' || value === null || !('~standard' in value)) return false

	const standard = (value as StandardSchemaV1)['~standard'] as unknown

	return (
		typeof standard === 'object' &&
		standard !== null &&
		typeof (standard as { validate?: unknown }).validate === 'function'
	)
}

function toSegment(key: PropertyKey | { readonly key: PropertyKey }): PathSegment {
	const raw = typeof key === 'object' ? key.key : key

	return typeof raw === 'number' ? raw : String(raw)
}

/** Turns schema issues into drift issues. A pathless issue has no name, so it belongs to the form. */
export function fromStandardIssues(issues: readonly StandardIssue[]): Issue[] {
	return issues.map(issue => ({
		message: issue.message,
		name: issue.path?.length ? buildName(issue.path.map(toSegment)) : undefined,
	}))
}
