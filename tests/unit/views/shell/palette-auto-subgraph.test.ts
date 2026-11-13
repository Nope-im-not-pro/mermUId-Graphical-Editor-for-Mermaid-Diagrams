// @vitest-environment jsdom
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createSync } from '../../../../src/lib/controllers/sync';
import { TOOLS } from '../../../../src/lib/views/shell/palette';
import { fakeAdapters } from '../../controllers/sync/helpers';

// T111 C3 I3 (O-111 (1)): Palette-Werkzeuge benennen keine aus Meta geladenen Auto-ID-Container um.

const TWO = [
	'flowchart TD',
	'    subgraph Erste Gruppe',
	'        A',
	'    end',
	'    subgraph Zweite Gruppe',
	'        B',
	'    end',
	''
].join('\n');
const LEGACY =
	'%% @mermuid: {"v":1,"layout":"manual","pos":{"subGraph1":[10,10,100,80],"B":[20,30,80,42]}}\n';

async function apply(toolId: string) {
	const sync = await createSync(TWO + LEGACY, { adapters: fakeAdapters });
	await sync.execute(TOOLS.find((t) => t.id === toolId)!.command({ x: 300, y: 300 }));
	return { doc: get(sync.commands).doc, code: get(sync).code };
}

describe('Palette mit Legacy-Meta `subGraph1` (unbenannter Subgraph mit Position)', () => {
	it('Container: neuer Rahmen enthält nur den neuen Knoten, Zweite Gruppe bleibt', async () => {
		const { doc, code } = await apply('container');
		const second = doc.containers.find((c) => c.label === 'Zweite Gruppe')!;
		expect(second).toMatchObject({ id: 'subGraph1', parentId: null });
		expect(second.sections[0].memberIds).toEqual(['B']);
		const box = doc.containers.find((c) => c.label !== 'Erste Gruppe' && c !== second)!;
		expect(box.sections[0].memberIds).toEqual(['n1']);
		expect(doc.layout.positions.subGraph1).toEqual([10, 10, 100, 80]);
		expect(code).toContain('    subgraph Zweite Gruppe\n        B\n    end\n');
	});

	it('Vorlage Linear: Titel und ID der Zweiten Gruppe bleiben', async () => {
		const { doc, code } = await apply('template:linear');
		expect(doc.containers.map((c) => [c.id, c.label, c.parentId])).toEqual([
			['subGraph0', 'Erste Gruppe', null],
			['subGraph1', 'Zweite Gruppe', null]
		]);
		expect(code.startsWith(TWO)).toBe(true);
		expect(code).not.toMatch(/subgraph c\d+/);
	});
});
