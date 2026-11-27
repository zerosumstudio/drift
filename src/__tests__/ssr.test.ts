// @vitest-environment node

/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, expect, it } from 'vitest'
import { Drift } from '../drift.js'
import { trackProgrammaticChanges } from '../track.js'

/*
 *   TESTS
 ***************************************************************************************************/
describe('in Node, with no DOM (#2)', () => {
	it('has no DOM globals, so a touched one would throw', () => {
		expect(typeof document).toBe('undefined')
		expect(typeof HTMLFormElement).toBe('undefined')
	})

	it('configures a form with every option', () => {
		const drift = new Drift({ persist: {}, aria: true, trackProgrammaticChanges })
		const form = drift.form('f', {
			validate: () => undefined,
			fields: { a: { validate: 'native', validateOn: 'blur', transform: value => value } },
			validateOn: { debounceMs: 100 },
			initialValues: { a: 'x' },
			persist: true,
		})

		drift.form('g', { validate: 'native' })
		drift.form('h')

		expect(form.getState().values).toEqual({ a: 'x' })
	})

	it('runs the whole handle API', async () => {
		const drift = new Drift()
		const form = drift.form('f', {
			fields: { a: { validate: v => (v ? undefined : 'Required') } },
		})

		form.setValue('a', '')
		form.setValues({ a: '1' })
		form.setErrors({ a: ['e'] })
		form.clearErrors()
		form.unsetValue('a')
		form.setInitialValues({ a: 'seed' })

		expect(await form.validate('a')).toBe(true)
		expect((await form.submit()).status).toBe('submitted')

		await form.reset()
		drift.scan()
		drift.clearPersisted()
		drift.disconnect()

		expect(drift.getForms().size).toBe(1)
	})

	it('throws a DriftError with NO_DOM from observe()', () => {
		expect(() => {
			new Drift().observe()
		}).toThrow(expect.objectContaining({ code: 'NO_DOM' }))
	})
})
