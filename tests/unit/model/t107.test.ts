// @vitest-environment jsdom
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { Command } from '../../../src/lib/controllers/commands/history';
import { createSync } from '../../../src/lib/controllers/sync';
import { removeContainer, updateContainer, updateNode } from '../../../src/lib/model/operations';
import { validateModel } from '../../../src/lib/services/validator';
import { fakeAdapters } from '../controllers/sync/helpers';

const open = (text: string) => createSync(text, { adapters: fakeAdapters });
const cmd = (op: Command['do']): Command => ({ label: 'test', do: op });

describe('V-10: Subgraph löschen ohne Waisen', () => {
	it('entfernt rawBlocks und comments des Subgraphen; Validator ohne Befund', async () => {
		const sync = await open(
			'flowchart LR\n  X --> Y\n  subgraph S\n    %% Notiz\n\n    A --> B\n  end\n'
		);
		const before = get(sync.commands).doc;
		const inner = before.containers[0].sections[0].memberIds;
		const loose = (d: typeof before) =>
			[...d.comments, ...d.rawBlocks].map((x) => x.id).filter((id) => inner.includes(id));
		expect(loose(before)).toHaveLength(2);
		await sync.execute(cmd((d) => removeContainer(d, 'S', 'cascade')));
		const doc = get(sync.commands).doc;
		expect(loose(doc)).toEqual([]);
		expect(validateModel(doc)).toEqual([]);
		expect(get(sync).code).not.toContain('Notiz');
	});
});

describe('O-47/D4: leeres Label wird zu label := id', () => {
	const lines = (code: string) => code.split('\n').map((l) => l.trim());

	/** Label leeren, dann Fixpunkt prüfen: Code-Parse ergibt dasselbe Modell, zweites Schreiben byte-gleich. */
	async function clearAndCheck(text: string, clear: Command, expected: string) {
		const sync = await open(text);
		await sync.execute(clear);
		const code = get(sync).code;
		expect(lines(code)).toContain(expected);
		const model = get(sync.commands).doc;
		const again = await open(code);
		const reparsed = get(again.commands).doc;
		const strip = (d: typeof model) => [
			d.nodes.map(({ id, label, shape, parentId }) => ({ id, label, shape, parentId })),
			d.containers.map(({ id, label, parentId }) => ({ id, label, parentId }))
		];
		expect(strip(reparsed)).toEqual(strip(model));
		expect((await again.diff())?.model).toBe(code);
		await again.execute(cmd((d) => updateNode(d, 'Z', { label: 'Z2' })));
		expect(lines(get(again).code)).toContain(expected);
	}

	it('Standardknoten (Form default): A -> A', async () => {
		await clearAndCheck(
			'flowchart LR\n  A --> Z\n',
			cmd((d) => updateNode(updateNode(d, 'A', { label: 'x' }), 'A', { label: '' })),
			'A'
		);
	});

	it('Rechteck: A[x] -> A[A]', async () => {
		await clearAndCheck(
			'flowchart LR\n  A[x] --> Z\n',
			cmd((d) => updateNode(d, 'A', { label: '' })),
			'A[A] --> Z'
		);
	});

	it('Form bleibt: A((x)) -> A((A)), auch bei reinem Leerraum', async () => {
		await clearAndCheck(
			'flowchart LR\n  A((x)) --> Z\n',
			cmd((d) => updateNode(d, 'A', { label: '   ' })),
			'A((A)) --> Z'
		);
	});

	it('Subgraph: subgraph S [x] -> subgraph S', async () => {
		await clearAndCheck(
			'flowchart LR\n  subgraph S [x]\n    A\n  end\n  Z\n',
			cmd((d) => updateContainer(d, 'S', { label: '' })),
			'subgraph S'
		);
	});
});

describe('O-97: Label-Trim im Modell (wie mermaid und Adapter)', () => {
	it("Umbenennen auf 'Fertig ' schreibt in place, Re-Parse ergibt das Modell", async () => {
		const sync = await open('flowchart TD\n    A[Start] --> B[Ende]\n');
		await sync.execute(cmd((d) => updateNode(d, 'B', { label: 'Fertig ' })));
		const code = get(sync).code;
		expect(code).toBe('flowchart TD\n    A[Start] --> B[Fertig]\n');
		const model = get(sync.commands).doc;
		expect(model.nodes.find((n) => n.id === 'B')?.label).toBe('Fertig');
		const reparsed = get((await open(code)).commands).doc;
		const labels = (d: typeof model) =>
			d.nodes.map(({ id, label, shape }) => ({ id, label, shape }));
		expect(labels(reparsed)).toEqual(labels(model));
	});
});
