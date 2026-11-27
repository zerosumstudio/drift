/*
 *   IMPORTS
 ***************************************************************************************************/
import type { FieldElement } from './fields.js'
import type { Issue, ValidateResult } from './types.js'

/*
 *   RESULTS
 ***************************************************************************************************/
/**
 * Turns a validator's return value into issues. Anything that isn't a message, an issue list or
 * `undefined` throws, so a validator written for another API fails closed instead of passing.
 */
export function toIssues(result: ValidateResult, name: string | undefined): Issue[] {
	if (result === undefined || result === '') {
		return []
	}

	if (typeof result === 'string') {
		return [{ message: result, name }]
	}

	if (!Array.isArray(result)) {
		throw new TypeError('A validator must return a message, a list of issues or undefined')
	}

	return (result as readonly Issue[]).map(issue => {
		if (typeof issue.message !== 'string') {
			throw new TypeError('A validation issue needs a message')
		}

		return { message: issue.message, name: issue.name ?? name }
	})
}

/*
 *   NATIVE CONSTRAINT VALIDATION
 ***************************************************************************************************/
export function nativeIssues(elements: readonly FieldElement[], name: string): Issue[] {
	const messages = new Set<string>()

	for (const element of elements) {
		if (element.willValidate && !element.validity.valid) {
			messages.add(element.validationMessage || 'Invalid value')
		}
	}

	return Array.from(messages, message => ({ message, name }))
}
