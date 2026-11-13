import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(__dirname, '../../../..');
const ADAPTERS = 'src/lib/services/adapters';
const ALLOWED = ['src/lib/controllers/sync/', `${ADAPTERS}/`];

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]
	);
}

const toPosix = (path: string) => path.split('\\').join('/');

/** Import-Specifier aus `import ... from`, `export ... from`, `import '...'` und `import('...')`. */
function specifiers(source: string): string[] {
	const pattern = /(?:\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\1/g;
	return [...source.matchAll(pattern)].map((m) => m[2]);
}

/** Löst einen Specifier relativ zur Datei bzw. über `$lib` auf (repo-relativ, `/`-getrennt). */
function target(file: string, spec: string): string | null {
	if (spec.startsWith('.'))
		return toPosix(relative(root, resolve(dirname(join(root, file)), spec)));
	if (spec === '$lib' || spec.startsWith('$lib/')) return `src/lib${spec.slice(4)}`;
	return null;
}

/** Repo-relative Dateien außerhalb der erlaubten Orte, die `services/adapters` importieren. */
function offenders(sources: Readonly<Record<string, string>>): string[] {
	return Object.entries(sources)
		.filter(([file]) => !ALLOWED.some((dir) => file.startsWith(dir)))
		.filter(
			([file, source]) =>
				source.includes('services/adapters') ||
				specifiers(source).some((spec) => {
					const path = target(file, spec);
					return path !== null && (path === ADAPTERS || path.startsWith(`${ADAPTERS}/`));
				})
		)
		.map(([file]) => file);
}

describe('statischer Import-Test (T13)', () => {
	it('services/adapters wird in src/ nur unter controllers/sync importiert', () => {
		const sources = Object.fromEntries(
			files(join(root, 'src'))
				.filter((f) => /\.(ts|svelte)$/.test(f))
				.map((f) => [toPosix(relative(root, f)), readFileSync(f, 'utf8')])
		);
		expect(Object.keys(sources).length).toBeGreaterThan(0);
		expect(offenders(sources)).toEqual([]);
	});

	it('erkennt Verstöße auch über relative Pfade und $lib', () => {
		const found = offenders({
			'src/lib/services/file/a.ts': "import { flowchartAdapter } from '../adapters/flowchart';",
			'src/lib/services/b.ts': "export * from './adapters';",
			'src/lib/c.svelte': "<script>const m = import('$lib/services/adapters/sequence');</script>",
			'src/lib/model/d.ts': "import '../services/adapters/flowchart/parser';",
			'src/routes/e.ts': "import x from '../lib/services/adapters';",
			'src/lib/f.ts': '// services/adapters\nexport {};',
			'src/lib/services/file/ok.ts':
				"import { a } from '../adapters-alt/x';\nimport b from './adapters';",
			'src/lib/services/ok2.ts': "import { readMeta } from './meta';",
			'src/lib/controllers/sync/registry.ts': "import x from '../../services/adapters/flowchart';",
			'src/lib/services/adapters/flowchart/index.ts': "export * from './parser';"
		});
		expect(found).toEqual([
			'src/lib/services/file/a.ts',
			'src/lib/services/b.ts',
			'src/lib/c.svelte',
			'src/lib/model/d.ts',
			'src/routes/e.ts',
			'src/lib/f.ts'
		]);
	});

	it('der Orchestrator importiert die Adapter tatsächlich', () => {
		const registry = readFileSync(join(root, 'src/lib/controllers/sync/registry.ts'), 'utf8');
		expect(registry).toContain('services/adapters');
	});
});
