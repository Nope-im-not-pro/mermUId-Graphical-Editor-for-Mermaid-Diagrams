import { fileURLToPath } from 'node:url';
import adapter from '@sveltejs/adapter-static';
import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';
import { readVersion } from './scripts/version.mjs';

// N-01: elkjs (EPL-2.0) darf nicht ins Bundle. Alle Importpfade (auch Unterpfade wie
// elkjs/lib/elk.bundled.js) zeigen auf ein Stub-Modul.
const elkStub = fileURLToPath(new URL('./src/lib/stubs/elkjs.ts', import.meta.url));

// V-26: App-Version aus CHANGELOG.md (Pfad relativ zur Config, nicht zum cwd); Fallback und
// Warnung wie package-onefolder.mjs.
let appVersion = readVersion(fileURLToPath(new URL('./CHANGELOG.md', import.meta.url)));
if (!appVersion) {
	appVersion = '0.0.0_no-changelog';
	console.warn(`Warning: no version found in CHANGELOG.md, using ${appVersion}`);
}

export default defineConfig({
	define: { __APP_VERSION__: JSON.stringify(appVersion) },
	plugins: [
		sveltekit({
			adapter: adapter(),
			csp: {
				mode: 'hash',
				directives: {
					'default-src': ['self'],
					'script-src': ['self'],
					'style-src': ['self', 'unsafe-inline'],
					'img-src': ['self', 'data:', 'blob:'],
					'connect-src': ['self'],
					'worker-src': ['self'],
					'object-src': ['none'],
					'base-uri': ['none']
				}
			}
		})
	],
	resolve: {
		alias: [{ find: /^elkjs(\/.*)?$/, replacement: elkStub }],
		// O-26: Unter Vitest muss `mount` aus `svelte` die Client-Variante laden (Svelte-Doku).
		// Nur bei VITEST; Build und Dev behalten die Standard-Bedingungen.
		...(process.env.VITEST ? { conditions: ['browser'] } : {})
	},
	test: {
		include: ['tests/unit/**/*.test.ts'],
		environment: 'node',
		// T139 C2 (M-20, 2026-11-12): `isolate: false` gemessen, nicht übernommen (Bedingung
		// 3 Läufe grün verfehlt). Referenz Bestand: 183/183 Dateien, 3354/3354 Tests, 88,9 s.
		// isolate false: Lauf 1 11 rot (shell-props, exporting, page, validate-once, HelpPanel),
		// 84,5 s; Lauf 2 grün, 76,7 s; Lauf 3 17 rot (SequenceCanvas, shell-props, exporting,
		// validate-once), 74,1 s. Ursache vermutlich geteilter Modulzustand (nicht analysiert).
		coverage: {
			// Nur Quellcode; Doku neben dem Code (SUBSET.md) erzeugte PARSE_ERROR-Warnungen.
			include: ['src/**/*.{ts,svelte}'],
			exclude: ['src/**/*.md', 'src/**/*.d.ts']
		}
	}
});
