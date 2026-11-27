/*
 *   IMPORTS
 ***************************************************************************************************/
import { describe, expect, it } from 'vitest'
import { FIELD_CODECS, baseKind, isEqualValue, isTrackable, type FieldElement } from '../fields.js'
import { mount } from './helpers.js'

/*
 *   HELPERS
 ***************************************************************************************************/
function elements(html: string, selector = 'input, textarea, select'): FieldElement[] {
	return Array.from(mount(html).querySelectorAll<FieldElement>(selector))
}

/*
 *   TESTS
 ***************************************************************************************************/
describe('kinds', () => {
	it.each([
		['<input type="text">', 'text'],
		['<input type="date">', 'text'],
		['<textarea></textarea>', 'text'],
		['<input type="number">', 'number'],
		['<input type="range">', 'number'],
		['<input type="checkbox">', 'checkbox'],
		['<input type="radio">', 'radio'],
		['<input type="file">', 'file'],
		['<select></select>', 'select'],
		['<select multiple></select>', 'selectMultiple'],
	])('classifies %s as %s', (html, kind) => {
		expect(baseKind(elements(html)[0]!)).toBe(kind)
	})

	it('does not track buttons, disabled or unnamed inputs', () => {
		const [button, submit, disabled, unnamed, ok] = elements(`
			<input type="button" name="a">
			<input type="submit" name="b">
			<input name="c" disabled>
			<input>
			<input name="d">
		`)

		expect([button, submit, disabled, unnamed, ok].map(el => isTrackable(el!))).toEqual([
			false,
			false,
			false,
			false,
			true,
		])
	})
})

describe('text', () => {
	it('reads, writes and captures the HTML default', () => {
		const els = elements('<input name="a" value="start">')
		const codec = FIELD_CODECS.text

		els[0]!.value = 'typed'

		expect(codec.read(els)).toBe('typed')
		expect(codec.readDefault(els)).toBe('start')

		codec.write(els, null)

		expect(els[0]!.value).toBe('')
	})

	it('returns an empty string for empty date and time inputs (L2)', () => {
		const els = elements('<input type="date" name="d"><input type="time" name="t">')

		expect(FIELD_CODECS.text.read([els[0]!])).toBe('')
		expect(FIELD_CODECS.text.read([els[1]!])).toBe('')
	})
})

describe('number', () => {
	it('reads an empty number input as null, not NaN (L2)', () => {
		const els = elements('<input type="number" name="n">')

		expect(FIELD_CODECS.number.read(els)).toBeNull()

		els[0]!.value = '12.5'

		expect(FIELD_CODECS.number.read(els)).toBe(12.5)
	})

	it('writes null as empty and normalizes strings', () => {
		const els = elements('<input type="number" name="n" value="3">')

		expect(FIELD_CODECS.number.readDefault(els)).toBe(3)
		expect(FIELD_CODECS.number.normalize('7')).toBe(7)
		expect(FIELD_CODECS.number.normalize('')).toBeNull()
		expect(FIELD_CODECS.number.normalize('abc')).toBeNull()
		expect(FIELD_CODECS.number.normalize(Infinity)).toBeNull()

		FIELD_CODECS.number.write(els, null)

		expect(els[0]!.value).toBe('')
	})
})

describe('checkbox groups', () => {
	const html = `
		<input type="checkbox" name="g" value="x" checked>
		<input type="checkbox" name="g" value="y">
		<input type="checkbox" name="g" value="z" checked>
	`

	it('reads the checked values in order (M9)', () => {
		expect(FIELD_CODECS.checkboxGroup.read(elements(html))).toEqual(['x', 'z'])
	})

	it('writes by value and ignores unknown ones', () => {
		const els = elements(html)

		FIELD_CODECS.checkboxGroup.write(els, ['y', 'nope'])

		expect(els.map(el => (el as HTMLInputElement).checked)).toEqual([false, true, false])
		expect(FIELD_CODECS.checkboxGroup.readDefault(els)).toEqual(['x', 'z'])
	})

	it('checks stored values against the options it has', () => {
		const els = elements(html)

		expect(FIELD_CODECS.checkboxGroup.matches(['x'], els)).toBe(true)
		expect(FIELD_CODECS.checkboxGroup.matches(['nope'], els)).toBe(false)
		expect(FIELD_CODECS.checkboxGroup.matches('x', els)).toBe(false)
	})
})

describe('radio, select and multi-select', () => {
	it('reads a radio group as the checked value or null', () => {
		const els = elements(
			'<input type="radio" name="r" value="a"><input type="radio" name="r" value="b">',
		)

		expect(FIELD_CODECS.radio.read(els)).toBeNull()

		FIELD_CODECS.radio.write(els, 'b')

		expect(FIELD_CODECS.radio.read(els)).toBe('b')

		FIELD_CODECS.radio.write(els, null)

		expect(FIELD_CODECS.radio.read(els)).toBeNull()
	})

	it('uses the selected option, or the first, as a select default', () => {
		const picked = elements(
			'<select><option value="1">1</option><option value="2" selected>2</option></select>',
		)
		const plain = elements(
			'<select><option value="1">1</option><option value="2">2</option></select>',
		)

		expect(FIELD_CODECS.select.readDefault(picked)).toBe('2')
		expect(FIELD_CODECS.select.readDefault(plain)).toBe('1')
	})

	it('reads and writes a multi-select as a list', () => {
		const els = elements(
			'<select multiple><option value="a" selected>a</option><option value="b">b</option></select>',
		)

		expect(FIELD_CODECS.selectMultiple.read(els)).toEqual(['a'])

		FIELD_CODECS.selectMultiple.write(els, ['b'])

		expect(FIELD_CODECS.selectMultiple.read(els)).toEqual(['b'])
	})
})

describe('file', () => {
	it('reads as a list of files and clears with [] or null (H3)', () => {
		const els = elements('<input type="file" name="f">')

		expect(FIELD_CODECS.file.read(els)).toEqual([])
		expect(() => {
			FIELD_CODECS.file.write(els, [])
		}).not.toThrow()
		expect(() => {
			FIELD_CODECS.file.write(els, null)
		}).not.toThrow()
	})

	it('refuses to be set to files, before anything changes (H3)', () => {
		expect(() => FIELD_CODECS.file.normalize([new File(['a'], 'a.txt')])).toThrow(TypeError)
		expect(() => FIELD_CODECS.file.normalize('C:\\fakepath\\a.txt')).toThrow(TypeError)
		expect(FIELD_CODECS.file.normalize(null)).toEqual([])
	})

	it('is never restored or persisted', () => {
		expect(FIELD_CODECS.file.matches([], [])).toBe(false)
	})
})

describe('isEqualValue', () => {
	it('compares primitives and arrays of primitives', () => {
		expect(isEqualValue('a', 'a')).toBe(true)
		expect(isEqualValue(['a', 'b'], ['a', 'b'])).toBe(true)
		expect(isEqualValue(['a'], ['b'])).toBe(false)
		expect(isEqualValue(null, '')).toBe(false)
		expect(isEqualValue([], [])).toBe(true)
	})

	it('compares files by identity', () => {
		const file = new File(['a'], 'a.txt')

		expect(isEqualValue([file], [file])).toBe(true)
		expect(isEqualValue([file], [new File(['a'], 'a.txt')])).toBe(false)
	})
})
