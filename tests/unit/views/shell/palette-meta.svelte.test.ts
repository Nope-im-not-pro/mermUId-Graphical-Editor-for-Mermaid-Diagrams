// @vitest-environment jsdom
// T138 C2: Palette bietet die fünf `@{ shape }`-Formen (F-07) an.
import mermaid from 'mermaid';
import { flushSync, mount, unmount } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import { createHistory, execute } from '../../../../src/lib/controllers/commands/history';
import { serialize } from '../../../../src/lib/services/adapters/flowchart';
import { META_SHAPE_NAMES } from '../../../../src/lib/services/shapes';
import Palette from '../../../../src/lib/views/shell/Palette.svelte';
import { applyLocale } from '../../../../src/lib/views/shell/i18n.svelte';
import { filterTools, TOOLS, toolById } from '../../../../src/lib/views/shell/palette';
import { parseOk } from '../canvas/helpers';

const NAMES: Record<string, [string, string]> = {
	doc: ['Dokument', 'Document'],
	delay: ['Verzögerung', 'Delay'],
	'sl-rect': ['Manuelle Eingabe', 'Manual input'],
	'h-cyl': ['Zylinder horizontal (Direktzugriff)', 'Horizontal cylinder (direct access storage)'],
	'lin-cyl': ['Zylinder mit Linie (Festplatte)', 'Lined cylinder (disk storage)']
};

const mounted: ReturnType<typeof mount>[] = [];
afterEach(() => {
	mounted.splice(0).forEach((m) => unmount(m));
	applyLocale('de');
});

describe('Palette: neue Formen', () => {
	it('je Form ein benanntes Form-Werkzeug (DE/EN)', () => {
		applyLocale('de');
		for (const shape of META_SHAPE_NAMES) {
			const tool = toolById(`shape:${shape}`);
			expect(tool?.kind).toBe('shape');
			expect(tool?.label).toBe(NAMES[shape][0]);
		}
		applyLocale('en');
		for (const shape of META_SHAPE_NAMES)
			expect(toolById(`shape:${shape}`)?.label).toBe(NAMES[shape][1]);
	});

	it('filterbar über die Suche', () => {
		applyLocale('de');
		const ids = (q: string) => filterTools(TOOLS, q).map((t) => t.id);
		expect(ids('dokument')).toEqual(['shape:doc']);
		expect(ids('verzög')).toEqual(['shape:delay']);
		expect(ids('MANUELLE')).toEqual(['shape:sl-rect']);
		expect(ids('festplatte')).toEqual(['shape:lin-cyl']);
		expect(ids('direktzugriff')).toEqual(['shape:h-cyl']);
		expect(ids('zylinder')).toEqual(['shape:cylinder', 'shape:h-cyl', 'shape:lin-cyl']);
	});

	it.each([...META_SHAPE_NAMES])(
		'%s: Einfügen erzeugt @{}-Knoten, gültig für mermaid',
		async (shape) => {
			const start = parseOk('flowchart LR\n');
			const { doc } = execute(
				createHistory(start),
				toolById(`shape:${shape}`)!.command({ x: 0, y: 0 })
			);
			expect(doc.nodes).toHaveLength(1);
			expect(doc.nodes[0].shape).toBe(shape);
			const out = serialize(doc);
			expect(out).toBe(`flowchart LR\n    ${doc.nodes[0].id}@{ shape: ${shape} }\n`);
			await expect(mermaid.parse(out)).resolves.toBeTruthy();
		}
	);

	it('Kacheln: eigenes Symbol, ziehbar, Klick bewaffnet', () => {
		applyLocale('de');
		const armed: string[] = [];
		const target = document.createElement('div');
		document.body.append(target);
		mounted.push(
			mount(Palette, {
				target,
				props: { armed: null, onarm: (id: string) => armed.push(id), onrelease: () => {} }
			})
		);
		flushSync();
		const tile = (label: string) =>
			[...target.querySelectorAll('button')].find((b) => b.textContent === label)!;
		const square = tile('Rechteck').querySelector('path')!.getAttribute('d');
		const glyphs = new Set<string | null>();
		for (const shape of META_SHAPE_NAMES) {
			const b = tile(NAMES[shape][0]);
			expect(b.getAttribute('draggable')).toBe('true');
			const d = b.querySelector('path')!.getAttribute('d');
			expect(d).not.toBe(square);
			glyphs.add(d);
			b.click();
		}
		expect(glyphs.size).toBe(5);
		expect(armed).toEqual(META_SHAPE_NAMES.map((s) => `shape:${s}`));
	});
});
