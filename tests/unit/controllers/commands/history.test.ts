import { describe, expect, it } from 'vitest';
import {
	UNDO_DEPTH,
	codeApply,
	createHistory,
	execute,
	redo,
	transaction,
	undo,
	type Command,
	type History
} from '../../../../src/lib/controllers/commands/history';
import {
	addContainer,
	addEdge,
	addNode,
	moveToContainer,
	removeContainer,
	removeNode,
	reorder,
	updateNode
} from '../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import { container, edge, node, sampleDoc } from '../../model/fixtures';

const cmd = (label: string, op: Command['do']): Command => ({ label, do: op });
const addNew = cmd('add', (d, ctx) => addNode(d, node(ctx.newId('n'))));
const rename = (id: string, label: string) => cmd('rename', (d) => updateNode(d, id, { label }));

describe('execute / undo / redo', () => {
	it('führt Command aus und macht ihn rückgängig und wieder', () => {
		const start = sampleDoc();
		let h = execute(createHistory(start), rename('n1', 'Neu'));
		expect(h.doc.nodes[0].label).toBe('Neu');
		expect(h.past).toHaveLength(1);
		h = undo(h);
		expect(h.doc).toBe(start);
		expect(h.future).toHaveLength(1);
		h = redo(h);
		expect(h.doc.nodes[0].label).toBe('Neu');
		expect(h.future).toHaveLength(0);
	});

	it('undo/redo ohne Einträge lässt den Zustand unverändert', () => {
		const h = createHistory(sampleDoc());
		expect(undo(h)).toBe(h);
		expect(redo(h)).toBe(h);
	});

	it('neuer Command leert den Redo-Stack', () => {
		let h = execute(createHistory(sampleDoc()), rename('n1', 'A'));
		h = undo(h);
		expect(h.future).toHaveLength(1);
		h = execute(h, rename('n2', 'B'));
		expect(h.future).toHaveLength(0);
		expect(redo(h)).toBe(h);
	});

	it('fehlschlagender Command ändert nichts', () => {
		const h = createHistory(sampleDoc());
		expect(() => execute(h, rename('xX', 'A'))).toThrow(/xX/);
		expect(h.past).toHaveLength(0);
	});

	it('speichert beliebigen Payload am Eintrag (Schnittstelle für Text-ChangeSets)', () => {
		const h = execute(createHistory(sampleDoc()), rename('n1', 'A'), { changes: [1, 2] });
		expect(h.past[0]).toMatchObject({ label: 'rename', payload: { changes: [1, 2] } });
	});
});

describe('Command ohne Änderung (V-13)', () => {
	it('gleiches Dokument erzeugt keinen Undo-Schritt, Redo-Stack bleibt', () => {
		let h = undo(execute(createHistory(sampleDoc()), rename('n1', 'Neu')));
		const same = execute(
			h,
			cmd('noop', (d) => d)
		);
		expect(same).toBe(h);
		h = execute(h, rename('n1', 'n1'));
		expect(h.past).toHaveLength(0);
		expect(h.future).toHaveLength(1);
	});

	it('strukturell gleiches Dokument (nur modelVersion neu) erzeugt keinen Undo-Schritt', () => {
		const start = createHistory(sampleDoc());
		const h = execute(
			start,
			cmd('drag', (d) => ({ ...d, layout: { ...d.layout }, modelVersion: d.modelVersion + 1 }))
		);
		expect(h).toBe(start);
		const moved = execute(
			start,
			cmd('re', (d) => reorder(d, 'n1', 0))
		);
		expect(moved).toBe(start);
	});

	it('mit Payload bleibt der Eintrag (Zusatzdaten, z. B. Code-Edit)', () => {
		const h = execute(
			createHistory(sampleDoc()),
			cmd('codeEdit', (d) => d),
			{ text: 1 }
		);
		expect(h.past).toHaveLength(1);
	});
});

describe('Undo nach Löschen (FA-06)', () => {
	it('removeNode cascade: Knoten, Kanten, order, memberIds, sourceText, Positionen zurück', () => {
		const start = sampleDoc();
		const reference = structuredClone(start);
		let h = execute(
			createHistory(start),
			cmd('del', (d) => removeNode(d, 'n2', 'cascade'))
		);
		expect(h.doc.edges).toHaveLength(0);
		h = undo(h);
		expect(h.doc).toEqual(reference);
	});

	it('removeContainer: Container samt Kindern zurück', () => {
		const reference = structuredClone(sampleDoc());
		let h = execute(
			createHistory(sampleDoc()),
			cmd('del', (d) => removeContainer(d, 'c1', 'cascade'))
		);
		expect(h.doc.containers).toHaveLength(0);
		h = undo(h);
		expect(h.doc).toEqual(reference);
		h = redo(h);
		expect(h.doc.containers).toHaveLength(0);
	});
});

describe('ID-Zähler (D-03)', () => {
	it('add -> undo -> add vergibt eine neue ID', () => {
		let h = execute(createHistory(sampleDoc()), addNew);
		expect(h.doc.nodes.at(-1)!.id).toBe('n4');
		h = undo(h);
		expect(h.doc.nodes.map((n) => n.id)).not.toContain('n4');
		h = execute(h, addNew);
		expect(h.doc.nodes.at(-1)!.id).toBe('n5');
	});

	it('redo stellt die ursprüngliche ID her, Zähler bleibt monoton', () => {
		let h = undo(execute(createHistory(sampleDoc()), addNew));
		h = redo(h);
		expect(h.doc.nodes.at(-1)!.id).toBe('n4');
		h = execute(h, addNew);
		expect(h.doc.nodes.at(-1)!.id).toBe('n5');
	});

	it('übernimmt gespeicherte Zähler', () => {
		const h = execute(createHistory(sampleDoc(), { n: 9, e: 1, c: 1 }), addNew);
		expect(h.doc.nodes.at(-1)!.id).toBe('n9');
	});
});

describe('UNDO_DEPTH', () => {
	it('ist 200; bei 201 Commands fällt der älteste heraus', () => {
		expect(UNDO_DEPTH).toBe(200);
		let h = createHistory(sampleDoc());
		const states: DiagramDocument[] = [h.doc];
		for (let i = 0; i < 201; i++) {
			h = execute(h, rename('n1', `L${i}`));
			states.push(h.doc);
		}
		expect(h.past).toHaveLength(200);
		for (let i = 0; i < 200; i++) h = undo(h);
		expect(h.doc).toBe(states[1]);
		expect(undo(h)).toBe(h);
	});
});

describe('transaction', () => {
	it('bündelt mehrere Commands zu einem Undo-Schritt (Gruppen-Löschen)', () => {
		const start = sampleDoc();
		let h = execute(
			createHistory(start),
			transaction('Gruppe löschen', [
				cmd('a', (d) => removeNode(d, 'n1', 'cascade')),
				cmd('b', (d) => removeNode(d, 'n3', 'cascade'))
			])
		);
		expect(h.past).toHaveLength(1);
		expect(h.past[0].label).toBe('Gruppe löschen');
		expect(h.doc.nodes.map((n) => n.id)).toEqual(['n2']);
		h = undo(h);
		expect(h.doc).toBe(start);
	});

	it('ist atomar: Fehler im zweiten Command ändert weder Dokument noch Zähler', () => {
		const h = createHistory(sampleDoc());
		const tx = transaction('x', [addNew, rename('xX', 'A')]);
		expect(() => execute(h, tx)).toThrow(/xX/);
		expect(execute(h, addNew).doc.nodes.at(-1)!.id).toBe('n4');
	});
});

/** Deterministischer Pseudo-Zufall (mulberry32). */
function rng(seed: number) {
	let a = seed;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** Wählt einen gültigen Command passend zum aktuellen Dokument. */
function randomCommand(doc: DiagramDocument, rand: () => number): Command {
	const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)];
	const nodes = doc.nodes.map((n) => n.id);
	const ends = [...nodes, ...doc.containers.map((c) => c.id)];
	const options: Command[] = [
		addNew,
		cmd('addC', (d, ctx) => addContainer(d, container(ctx.newId('c'))))
	];
	if (ends.length >= 2) {
		options.push(cmd('addE', (d, ctx) => addEdge(d, edge(ctx.newId('e'), pick(ends), pick(ends)))));
	}
	if (nodes.length > 0) {
		const id = pick(nodes);
		options.push(rename(id, `L${Math.floor(rand() * 1000)}`));
		options.push(cmd('delN', (d) => removeNode(d, id, rand() < 0.5 ? 'cascade' : 'mark')));
		options.push(cmd('move', (d) => moveToContainer(d, id, null)));
		if (doc.containers.length > 0) {
			const target = pick(doc.containers).id;
			options.push(cmd('moveIn', (d) => moveToContainer(d, id, target)));
		}
	}
	if (doc.order.length > 0) {
		const id = pick(doc.order);
		options.push(cmd('reorder', (d) => reorder(d, id, Math.floor(rand() * 5))));
	}
	if (doc.containers.length > 0) {
		const id = pick(doc.containers).id;
		options.push(cmd('delC', (d) => removeContainer(d, id, 'cascade')));
	}
	return pick(options);
}

describe('100 gemischte Commands rückwärts und vorwärts', () => {
	it('stellt jeden Zwischenstand per Tiefenvergleich wieder her', () => {
		const rand = rng(42);
		let h: History = createHistory(sampleDoc());
		const states = [structuredClone(h.doc)];
		const labels = new Set<string>();
		for (let i = 0; i < 100; i++) {
			const command = randomCommand(h.doc, rand);
			labels.add(command.label);
			const steps = h.past.length;
			h = execute(h, command);
			// Commands ohne Änderung legen keinen Schritt ab (V-13).
			if (h.past.length > steps) states.push(structuredClone(h.doc));
		}
		expect(labels.size).toBeGreaterThanOrEqual(8);
		const n = states.length - 1;
		expect(n).toBeGreaterThanOrEqual(90);
		for (let i = n - 1; i >= 0; i--) {
			h = undo(h);
			expect(h.doc).toEqual(states[i]);
		}
		for (let i = 1; i <= n; i++) {
			h = redo(h);
			expect(h.doc).toEqual(states[i]);
		}
	});
});

describe('Code-Einträge: restoreSide (T142 E)', () => {
	it('erfolgreicher Re-Parse wertgleich zum aktuellen Stand: Stand und Quelltext bleiben', () => {
		const start = sampleDoc();
		// Zwei Texte (z. B. nur Leerzeichen verschieden) mit wertgleichem Parse.
		let h = createHistory(start, undefined, 'A');
		h = codeApply(h, start, undefined, undefined, 'A ');
		expect(h.past[0]).toMatchObject({ beforeSource: 'A', afterSource: 'A ' });
		const texts: string[] = [];
		const rebuild = (text: string) => {
			texts.push(text);
			return h.doc;
		};
		h = undo(h, rebuild);
		expect(texts).toEqual(['A']);
		expect(h.doc).toBe(start);
		// `h.doc` ist auch Parse von `A `: dieser Quelltext bleibt, Redo braucht keinen Re-Parse.
		expect(h.source).toBe('A ');
		h = redo(h, rebuild);
		expect(texts).toEqual(['A']);
		expect(h.doc).toBe(start);
		expect(h.source).toBe('A ');
	});
});
