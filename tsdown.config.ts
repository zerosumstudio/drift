import { defineConfig } from 'tsdown'

export default defineConfig({
	entry: { index: 'src/index.ts', track: 'src/track.ts' },
	format: 'esm',
	platform: 'browser',
	target: 'es2022',
	dts: true,
	clean: true,
	minify: false,
	sourcemap: false,
	outDir: 'dist',
})
