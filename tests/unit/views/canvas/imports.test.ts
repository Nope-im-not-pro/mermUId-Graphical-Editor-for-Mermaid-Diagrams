import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const views = join(__dirname, '../../../../src/lib/views');

function files(dir: string): string[] {
	return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
		e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]
	);
}

// Zusammengesetzt, damit diese Testdatei selbst den Suchtext nicht enthält.
const FORBIDDEN = [['services', 'adapters'].join('/'), ['@xyflow', 'system'].join('/')];

describe('views: verbotene Importe (DoD 4)', () => {
	const sources = files(views).map((f) => ({ f, text: readFileSync(f, 'utf8') }));

	it('findet Canvas-Dateien', () => {
		expect(sources.some(({ f }) => f.includes(join('canvas', 'graph')))).toBe(true);
	});

	it.each(FORBIDDEN)('kein Vorkommen von %s', (needle) => {
		expect(sources.filter(({ text }) => text.includes(needle)).map(({ f }) => f)).toEqual([]);
	});

	it('kein {@html} und kein foreignObject', () => {
		const bad = sources.filter(({ text }) => /\{@html|foreignObject/.test(text));
		expect(bad.map(({ f }) => f)).toEqual([]);
	});
});

describe('views: Sequenz-Erkennung nur über controllers/sync (T128, V-25)', () => {
	const sources = files(views).map((f) => ({ f, text: readFileSync(f, 'utf8') }));

	it('keine eigenen Module lexer/raw im Sequenz-Canvas', () => {
		const names = readdirSync(join(views, 'canvas', 'sequence'));
		expect(names).toContain('commands.ts');
		expect(names.filter((n) => /^(?:lexer|raw)\.ts$/.test(n))).toEqual([]);
	});

	it('kein Import von sequence/lexer oder sequence/raw', () => {
		const bad = sources.filter(({ text }) =>
			/from\s*['"][^'"]*(?:sequence\/|\.\/)(?:lexer|raw)['"]/.test(text)
		);
		expect(bad.map(({ f }) => f)).toEqual([]);
	});

	it('keine eigene Erkennungslogik (messageLexes/rawEvents) in der View', () => {
		const bad = sources.filter(({ text }) =>
			/\bfunction\s+(?:messageLexes|rawEvents)\b|\b(?:messageLexes|rawEvents)\s*=\s*\(/.test(text)
		);
		expect(bad.map(({ f }) => f)).toEqual([]);
	});

	it('commands.ts bezieht die Erkennung aus controllers/sync', () => {
		const text = readFileSync(join(views, 'canvas', 'sequence', 'commands.ts'), 'utf8');
		expect(text).toMatch(
			/import\s*\{[^}]*\bsequenceGrammar\b[^}]*\}\s*from\s*'\.\.\/\.\.\/\.\.\/controllers\/sync'/
		);
	});
});
