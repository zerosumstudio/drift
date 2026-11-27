/*
 *   IMPORTS
 ***************************************************************************************************/
import { afterEach } from 'vitest'

/*
 *   SETUP
 ***************************************************************************************************/
afterEach(() => {
	// The node-environment tests have no document
	if (typeof document === 'undefined') return

	document.body.innerHTML = ''
	window.localStorage.clear()
})
