import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const model = join(__dirname, '../../../src/lib/model');

/** Import-Specifier aus `import ... from`, `export ... from`, `import '...'` und `import('...')`. */
function specifiers(source: string): string[] {
	const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g;
	return [...source.matchAll(pattern)].map((m) => m[2]);
}

describe('model: keine Importe aus services/controllers/views (T128 C3)', () => {
	const sources = readdirSync(model).map((f) => ({
		f,
		text: readFileSync(join(model, f), 'utf8')
	}));

	it('findet operations.ts und errors.ts', () => {
		expect(sources.map(({ f }) => f)).toEqual(
			expect.arrayContaining(['operations.ts', 'errors.ts'])
		);
	});

	it('nur relative Importe innerhalb von model', () => {
		const bad = sources.flatMap(({ f, text }) =>
			specifiers(text)
				.filter((spec) => spec.startsWith('..') || spec.startsWith('$lib'))
				.map((spec) => `${f}: ${spec}`)
		);
		expect(bad).toEqual([]);
	});

	it.each(['services/', 'controllers/', 'views/'])('kein Vorkommen von %s', (needle) => {
		expect(sources.filter(({ text }) => text.includes(needle)).map(({ f }) => f)).toEqual([]);
	});
});
