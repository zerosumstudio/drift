/*
 *   IMPORTS
 ***************************************************************************************************/
import { defineConfig } from 'vitest/config'

/*
 *   VITEST CONFIG
 ***************************************************************************************************/
export default defineConfig({
	test: {
		globals: true,
		environment: 'jsdom',
		setupFiles: ['./src/__tests__/setup.ts'],
		include: ['src/**/*.test.ts'],
		clearMocks: true,
		restoreMocks: true,
		coverage: {
			provider: 'v8',
			reporter: ['text', 'json', 'html', 'lcov'],
			include: ['src/**/*.ts'],
			exclude: ['src/__tests__/**', 'src/index.ts', '**/*.d.ts', '**/*.config.*'],
		},
	},
})
