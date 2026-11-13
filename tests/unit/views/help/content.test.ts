// @vitest-environment jsdom
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { renderSvg } from '../../../../src/lib/services/render';
import { mermaidBlocks, parseMarkdown, type Block } from '../../../../src/lib/views/help/markdown';
import { insertSvg } from '../../../../src/lib/views/help/svg';

const dir = join(__dirname, '../../../../static/help');
const files = readdirSync(dir).filter((f) => f.endsWith('.md'));
const sources = files.map((f) => ({ f, text: readFileSync(join(dir, f), 'utf8') }));
const all = sources.map((s) => s.text).join('\n');
const blocks = parseMarkdown(all);
const diagrams = sources.flatMap(({ f, text }) =>
	mermaidBlocks(parseMarkdown(text)).map((code, i) => ({ name: `${f} #${i + 1}`, code }))
);

/** jsdom kennt keine SVG-Messfunktionen; nur im Test ersetzen (O-20, wie Render-Tests). */
function stubSvgMeasurement(): void {
	const proto = SVGElement.prototype as unknown as Record<string, unknown>;
	proto.getBBox = function (this: Element) {
		return { x: 0, y: 0, width: (this.textContent ?? '').length * 8, height: 16 };
	};
	proto.getComputedTextLength = function (this: Element) {
		return (this.textContent ?? '').length * 8;
	};
}

const plain = (b: Block): string =>
	b.type === 'table'
		? [...b.head, ...b.rows.flat()]
				.flat()
				.map((i) => i.text)
				.join(' | ')
		: b.type === 'list'
			? b.items
					.flat()
					.map((i) => i.text)
					.join(' ')
			: b.type === 'code' || b.type === 'mermaid'
				? b.text
				: b.content.map((i) => i.text).join('');

const headings = blocks.filter((b) => b.type === 'heading').map(plain);
const tables = blocks.filter((b): b is Extract<Block, { type: 'table' }> => b.type === 'table');
const rowText = (row: Extract<Block, { type: 'table' }>['rows'][number]) =>
	row.map((cell) => cell.map((i) => i.text).join(''));

beforeAll(stubSvgMeasurement);
afterEach(() => document.body.replaceChildren());

describe('Hilfe-Inhalt (static/help)', () => {
	it('mindestens eine Datei und mehrere Mermaid-Blöcke', () => {
		expect(files.length).toBeGreaterThan(0);
		expect(diagrams.length).toBeGreaterThanOrEqual(3);
	});

	it('keine Gedankenstriche U+2013/U+2014', () => {
		expect(all).not.toMatch(/[–—]/);
	});

	it('Kürzel-Tabelle nach KONZEPT §5 mit überschriebenen Browser-Kürzeln', () => {
		const table = tables.find((t) => t.head.flat().some((i) => i.text.includes('Kürzel')));
		expect(table).toBeDefined();
		const rows = table!.rows.map(rowText);
		const expected = [
			'Strg-S',
			'Strg-Z',
			'Strg-Y',
			'Entf',
			'Strg-D',
			'Strg-A',
			'Tab',
			'Pfeiltasten',
			'Alt-Pfeil',
			'F2',
			'C',
			'Strg-Plus',
			'Leertaste',
			'G',
			'Strg-E',
			'Strg-F',
			'F1',
			'Shift-F10'
		];
		for (const key of expected) {
			expect(
				rows.some((r) => r[1].includes(key)),
				key
			).toBe(true);
		}
		for (const key of ['Strg-D', 'Strg-E', 'Strg-F', 'Strg-S']) {
			const row = rows.find((r) => r[1].startsWith(key))!;
			expect(row[2], key).toMatch(/^überschrieben: /);
		}
	});

	it('Abschnitte: Positionen nur in mermUId, Lücken je Typ, click-Sicherheit', () => {
		expect(headings).toEqual(
			expect.arrayContaining([
				'Tastaturkürzel',
				'Positionen nur in mermUId',
				'Lücken je Diagrammtyp',
				'Sicherheit: click-Direktiven'
			])
		);
		expect(all).toMatch(/GitHub, mermaid\.live/);
		expect(all).toMatch(/nie ausgeführt/);
		expect(all).toMatch(/javascript:/);
		expect(all).toMatch(/nur Code/);
	});

	it.each(diagrams)('Mermaid-Block $name rendert über renderSvg fehlerfrei', async ({ code }) => {
		const result = await renderSvg(code);
		if (!result.ok) throw new Error(result.error.message);
		const target = document.createElement('div');
		document.body.append(target);
		expect(insertSvg(target, result.svg)).toBe(true);
	});

	it('click-Beispiel: eingebettete Vorschau enthält keinen navigierenden Verweis', async () => {
		const click = diagrams.find(({ code }) => /^\s*click /m.test(code));
		expect(click).toBeDefined();
		const result = await renderSvg(click!.code);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.svg).toMatch(/<a [^>]*href="https:/);
		const target = document.createElement('div');
		document.body.append(target);
		expect(insertSvg(target, result.svg)).toBe(true);
		expect(target.querySelectorAll('a').length).toBe(0);
		const external = [...target.querySelectorAll('*')].flatMap((e) =>
			[...e.attributes].filter((a) => a.localName === 'href' && !a.value.startsWith('#'))
		);
		expect(external).toHaveLength(0);
		// Pfeilspitzen: Marker-Definition und Verweis per url(#...) bleiben erhalten.
		const ref = target.querySelector('[marker-end]')?.getAttribute('marker-end');
		const id = /^url\(#([^)]+)\)$/.exec(ref ?? '')?.[1];
		expect(id).toBeDefined();
		expect(target.querySelector(`marker[id="${id}"]`)).not.toBeNull();
	});

	it('click mit mailto: und relativem Ziel: renderSvg weist ab, Hilfe nennt das', async () => {
		for (const target of ['mailto:a@example.org', '/foo']) {
			const result = await renderSvg(
				`flowchart LR\n  A[Doku] --> B[Ende]\n  click A "${target}" "Link"`
			);
			expect(result.ok, target).toBe(false);
			if (!result.ok) expect(result.error.message).toMatch(/^SVG verweist auf externe Ressource/);
		}
		expect(all).toMatch(/`mailto:`[^\n]*weist das ganze Diagramm ab/);
		expect(all).toMatch(/relative Ziele[^\n]*"SVG verweist auf externe Ressource"/);
	});

	it('click mit javascript: wird entfernt, Diagramm bleibt sichtbar, Hilfe nennt das', async () => {
		const result = await renderSvg(
			'flowchart LR\n  A[Doku] --> B[Ende]\n  click A "javascript:alert(1)" "Link"'
		);
		if (!result.ok) throw new Error(result.error.message);
		expect(result.svg).not.toMatch(/javascript:/);
		expect(all).toMatch(
			/`javascript:`: Mermaid entfernt das Link-Ziel\. Das Diagramm bleibt sichtbar/
		);
	});

	it('Hilfe beschreibt click-Verhalten in Vorschau und Export, Rücktaste als Ist-Zusatz', () => {
		expect(all).toMatch(/Vorschau[^.]*öffnet nichts/);
		expect(all).toMatch(/Mermaid-SVG[^.]*`https?`/);
		const table = tables.find((t) => t.head.flat().some((i) => i.text.includes('Kürzel')))!;
		const del = table.rows.map(rowText).find((r) => r[0] === 'Löschen')!;
		expect(del[2]).toMatch(/Ist-Stand: auch Rücktaste/);
	});

	it('mailto-Abweisung nur für Vorschau und Mermaid-SVG-Export', () => {
		expect(all).toMatch(/`mailto:`[^\n]*Vorschau und Mermaid-SVG-Export zeigen/);
	});

	it('sequence: nur per A->>()B oder participant B@{...} eingeführte Teilnehmer sind nicht grafisch bearbeitbar', () => {
		const hilfe = sources.find((s) => s.f === 'hilfe.md')!.text;
		const line = hilfe.split('\n').find((l) => l.includes('->>()'));
		expect(line).toBeDefined();
		expect(line).toMatch(/@\{/);
		expect(line).toMatch(/"Unbekannter Teilnehmer"/);
	});

	it('Graph-Kürzel als "Nur flowchart" gekennzeichnet', () => {
		const table = tables.find((t) => t.head.flat().some((i) => i.text.includes('Kürzel')))!;
		const rows = table.rows.map(rowText);
		for (const key of ['Strg-A', 'Tab / Shift-Tab', 'Alt-Pfeil', 'C oder', 'G / Shift-G']) {
			const row = rows.find((r) => r[1].startsWith(key))!;
			expect(row[2], key).toMatch(/^Nur flowchart/);
		}
	});
});
