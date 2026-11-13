import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { codeApply, createHistory, undo } from '../../../../src/lib/controllers/commands/history';
import {
	createCommandStore,
	type CommandState
} from '../../../../src/lib/controllers/commands/store';
import {
	addNode,
	moveToContainer,
	removeNode,
	updateNode
} from '../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import { emptyDoc, node, sampleDoc } from '../../model/fixtures';

const rename = (id: string, label: string) => ({
	label: 'rename',
	do: (d: Parameters<typeof updateNode>[0]) => updateNode(d, id, { label })
});

describe('codeApply (history)', () => {
	it('ersetzt das Modell atomar als ein Undo-Schritt und hebt den Zähler an', () => {
		const start = sampleDoc();
		const parsed = emptyDoc({ nodes: [node('n7')], order: ['n7'] });
		let h = codeApply(createHistory(start), parsed, 'text');
		expect(h.doc).toBe(parsed);
		expect(h.past).toEqual([{ label: 'codeApply', before: start, after: parsed, payload: 'text' }]);
		expect(h.counters.n).toBe(8);
		h = undo(h);
		expect(h.doc).toBe(start);
		expect(h.counters.n).toBe(8);
	});

	it('optionale Zähler-Untergrenze (O-22): hebt an, senkt nie, Undo senkt nicht', () => {
		const start = sampleDoc();
		const parsed = emptyDoc({ nodes: [node('n2')], order: ['n2'] });
		let h = codeApply(createHistory(start), parsed, undefined, { n: 9, e: 1, c: 4 });
		expect(h.counters).toEqual({ n: 9, e: 3, c: 4 });
		h = codeApply(h, parsed, undefined, { n: 3, e: 1, c: 1 });
		expect(h.counters.n).toBe(9);
		h = undo(undo(h));
		expect(h.counters.n).toBe(9);
	});
});

describe('createCommandStore', () => {
	it('liefert Zustand mit canUndo/canRedo und benachrichtigt Abonnenten', () => {
		const store = createCommandStore(sampleDoc());
		const seen: CommandState[] = [];
		const stop = store.subscribe((s) => seen.push(s));
		expect(seen[0]).toMatchObject({ canUndo: false, canRedo: false });
		store.execute(rename('n1', 'A'));
		expect(seen.at(-1)).toMatchObject({ canUndo: true, canRedo: false });
		expect(seen.at(-1)!.doc.nodes[0].label).toBe('A');
		const entry = store.undo();
		expect(entry?.label).toBe('rename');
		expect(seen.at(-1)).toMatchObject({ canUndo: false, canRedo: true });
		expect(store.redo()?.label).toBe('rename');
		expect(get(store).doc.nodes[0].label).toBe('A');
		stop();
	});

	it('undo/redo ohne Einträge liefert undefined', () => {
		const store = createCommandStore(sampleDoc());
		expect(store.undo()).toBeUndefined();
		expect(store.redo()).toBeUndefined();
	});

	it('Snapshots sind unveränderlich: Mutation ändert den Store nicht', () => {
		const input = sampleDoc();
		const store = createCommandStore(input);
		const snapshot = get(store).doc;
		expect(() => {
			(snapshot.nodes[0] as { label: string }).label = 'X';
		}).toThrow(TypeError);
		expect(() => snapshot.order.push('X')).toThrow(TypeError);
		input.nodes[0].label = 'Y';
		expect(get(store).doc.nodes[0].label).toBe('n1');
		store.execute({ label: 'add', do: (d, ctx) => addNode(d, node(ctx.newId('n'))) });
		const next = get(store).doc;
		expect(Object.isFrozen(next.nodes.at(-1))).toBe(true);
		expect(() => {
			next.layout.positions.n1[0] = 99;
		}).toThrow(TypeError);
	});

	it('transaction bündelt mehrere Commands (Gruppen-Drag) zu einem Undo-Schritt', () => {
		const store = createCommandStore(sampleDoc());
		const before = get(store).doc;
		store.transaction('Gruppe verschieben', [
			{ label: 'm1', do: (d) => moveToContainer(d, 'n1', 'c1') },
			{ label: 'm2', do: (d) => moveToContainer(d, 'n2', 'c1') }
		]);
		expect(get(store).doc.order).toEqual(['e1', 'c1']);
		expect(store.undo()?.label).toBe('Gruppe verschieben');
		expect(get(store).doc).toBe(before);
		expect(get(store).canUndo).toBe(false);
	});

	it('codeApply ersetzt atomar, ein Undo-Schritt, Payload kommt beim Undo zurück', () => {
		const store = createCommandStore(sampleDoc());
		store.execute({ label: 'del', do: (d) => removeNode(d, 'n2', 'cascade') });
		const parsed = emptyDoc({ nodes: [node('n1')], order: ['n1'] });
		store.codeApply(parsed, { change: 'x' });
		expect(get(store).doc).toEqual(parsed);
		expect(Object.isFrozen(get(store).doc)).toBe(true);
		expect(store.undo()?.payload).toEqual({ change: 'x' });
		expect(get(store).doc.nodes.map((n) => n.id)).toEqual(['n1', 'n3']);
		store.undo();
		expect(get(store).doc).toEqual(sampleDoc());
	});

	it('codeApply mit Knoten-ID __proto__: Position bleibt eigene Eigenschaft (T142)', () => {
		const own = (entries: [string, number[]][]) => {
			const map = Object.create(null) as Record<string, unknown>;
			for (const [k, v] of entries) {
				Object.defineProperty(map, k, {
					value: v,
					enumerable: true,
					writable: true,
					configurable: true
				});
			}
			return map as DiagramDocument['layout']['positions'];
		};
		const layout = (positions: DiagramDocument['layout']['positions']) => ({
			...emptyDoc().layout,
			positions
		});
		const store = createCommandStore(
			emptyDoc({
				layout: layout(
					own([
						['A', [0, 0, 0, 0]],
						['__proto__', [1, 1, 0, 0]]
					])
				)
			})
		);
		store.codeApply(
			emptyDoc({
				layout: layout(
					own([
						['A', [0, 0, 0, 0]],
						['__proto__', [7, 7, 0, 0]]
					])
				)
			}),
			'x'
		);
		const positions = get(store).doc.layout.positions;
		expect(Object.hasOwn(positions, '__proto__')).toBe(true);
		expect(positions['__proto__']).toEqual([7, 7, 0, 0]);
		expect(Object.keys(positions)).toEqual(['A', '__proto__']);
		expect(Object.getPrototypeOf(positions)).not.toEqual([7, 7, 0, 0]);
	});

	it('codeApply mit Zähler-Untergrenze: neue IDs folgen ihr, auch nach Undo', () => {
		const store = createCommandStore(emptyDoc());
		const ids: string[] = [];
		const newId = {
			label: 'id',
			do: (d: Parameters<typeof updateNode>[0], ctx: { newId(p: 'n'): string }) => {
				ids.push(ctx.newId('n'));
				return d;
			}
		};
		store.codeApply(emptyDoc(), 'x', { n: 5, e: 1, c: 1 });
		store.execute(newId);
		store.undo();
		store.undo();
		store.execute(newId);
		expect(ids).toEqual(['n5', 'n6']);
	});

	it('fehlschlagender Command lässt Store unverändert', () => {
		const store = createCommandStore(sampleDoc());
		const before = get(store);
		expect(() => store.execute(rename('xX', 'A'))).toThrow(/xX/);
		expect(get(store)).toBe(before);
	});
});

describe('createCommandStore W03-Close-out', () => {
	it('friert flach eingefrorene Fremdobjekte aus Commands tief ein', () => {
		const store = createCommandStore(sampleDoc());
		const style = Object.freeze({ nested: { color: 'red' } });
		store.execute({
			label: 'style',
			do: (d) => updateNode(d, 'n1', { style: style as unknown as Record<string, string> })
		});
		const nested = (get(store).doc.nodes[0].style as unknown as typeof style).nested;
		expect(Object.isFrozen(nested)).toBe(true);
	});

	it('Mischfolge execute/transaction/codeApply/undo/redo bleibt konsistent', () => {
		const store = createCommandStore(sampleDoc());
		store.execute(rename('n1', 'X'));
		store.transaction('zwei', [rename('n1', 'Y'), rename('n1', 'Z')]);
		const parsed = { ...sampleDoc(), nodes: [] };
		store.codeApply(parsed, 'p');
		expect(get(store).doc.nodes).toEqual([]);
		expect(store.undo()?.payload).toBe('p');
		expect(get(store).doc.nodes[0].label).toBe('Z');
		store.undo();
		expect(get(store).doc.nodes[0].label).toBe('X');
		store.redo();
		expect(get(store).doc.nodes[0].label).toBe('Z');
		expect(get(store).canRedo).toBe(true);
		store.execute(rename('n1', 'W'));
		expect(get(store).canRedo).toBe(false);
	});
});

describe('createCommandStore codeApply teilt Unverändertes (T142)', () => {
	it('übernimmt unveränderte Teile aus dem Vorzustand, Neues isoliert und gefroren', () => {
		const store = createCommandStore(sampleDoc());
		const prev = get(store).doc;
		const next = structuredClone(sampleDoc());
		next.nodes[1] = { ...next.nodes[1], label: 'neu' };
		store.codeApply(next, 'p');
		const doc = get(store).doc;
		expect(doc).toEqual(next);
		expect(doc.nodes[0]).toBe(prev.nodes[0]);
		expect(doc.nodes[2]).toBe(prev.nodes[2]);
		expect(doc.edges).toBe(prev.edges);
		expect(doc.nodes[1]).not.toBe(prev.nodes[1]);
		expect(doc.nodes[1]).not.toBe(next.nodes[1]);
		expect(doc.nodes[1].style).toBe(prev.nodes[1].style);
		expect(Object.isFrozen(doc.nodes[1])).toBe(true);
		expect(Object.isFrozen(doc.nodes[0])).toBe(true);
		expect(store.undo()?.payload).toBe('p');
		expect(get(store).doc).toBe(prev);
	});

	it('Mutation des übergebenen Objekts nach codeApply erreicht den Store nicht', () => {
		const store = createCommandStore(sampleDoc());
		const next = structuredClone(sampleDoc());
		next.nodes[1].label = 'neu';
		next.nodes[1].props.extra = { tief: 1 };
		store.codeApply(next);
		next.nodes[1].label = 'außen';
		(next.nodes[1].props.extra as { tief: number }).tief = 2;
		next.nodes.push(node('n9'));
		const doc = get(store).doc;
		expect(doc.nodes[1].label).toBe('neu');
		expect(doc.nodes[1].props.extra).toEqual({ tief: 1 });
		expect(doc.nodes).toHaveLength(3);
		expect(() => {
			(doc.nodes[1].props.extra as { tief: number }).tief = 3;
		}).toThrow();
	});

	it('identischer Inhalt liefert den Vorzustand selbst', () => {
		const store = createCommandStore(sampleDoc());
		const prev = get(store).doc;
		store.codeApply(structuredClone(sampleDoc()), 'p');
		expect(get(store).doc).toBe(prev);
		expect(get(store).canUndo).toBe(true);
	});
});

describe('Code-Einträge ohne Modell (T142 Rückfall E)', () => {
	const titled = (title: string) => ({ ...structuredClone(sampleDoc()), title });
	const rebuilder = (seen: string[]) => (text: string) => {
		seen.push(text);
		return titled(text);
	};

	it('codeApply mit Quelltext hält kein Modell; Undo/Redo bauen per rebuild neu', () => {
		const store = createCommandStore(titled('T0'), undefined, 'T0');
		store.codeApply(titled('T1'), 'p', undefined, 'T1');
		const seen: string[] = [];
		const entry = store.undo(rebuilder(seen));
		expect(entry).toEqual({
			label: 'codeApply',
			beforeSource: 'T0',
			afterSource: 'T1',
			payload: 'p'
		});
		expect(entry).not.toHaveProperty('before');
		expect(entry).not.toHaveProperty('after');
		expect(seen).toEqual(['T0']);
		expect(get(store).doc).toStrictEqual(titled('T0'));
		expect(Object.isFrozen(get(store).doc)).toBe(true);
		store.redo(rebuilder(seen));
		expect(seen).toEqual(['T0', 'T1']);
		expect(get(store).doc).toStrictEqual(titled('T1'));
	});

	it('Re-Parse teilt Unverändertes mit dem aktuellen Stand', () => {
		const store = createCommandStore(titled('T0'), undefined, 'T0');
		store.codeApply(titled('T1'), 'p', undefined, 'T1');
		const current = get(store).doc;
		store.undo(rebuilder([]));
		expect(get(store).doc.nodes).toBe(current.nodes);
	});

	it('Eintrag ohne Modelländerung bei bekanntem Quelltext: Undo ohne Re-Parse', () => {
		const store = createCommandStore(titled('T0'), undefined, 'T0');
		store.codeApply(titled('T1'), 'p', undefined, 'T1');
		const doc = get(store).doc;
		store.execute({ label: 'codeEdit', do: (d) => d }, 'q');
		const seen: string[] = [];
		expect(store.undo(rebuilder(seen))).toEqual({
			label: 'codeEdit',
			beforeSource: 'T1',
			afterSource: 'T1',
			payload: 'q'
		});
		expect(seen).toEqual([]);
		expect(get(store).doc).toBe(doc);
	});

	it('Grafik-Eintrag behält Referenzen (kein Re-Parse)', () => {
		const store = createCommandStore(titled('T0'), undefined, 'T0');
		const before = get(store).doc;
		store.execute(rename('n1', 'G'));
		const after = get(store).doc;
		expect(store.undo()).toMatchObject({ before, after });
		expect(get(store).doc).toBe(before);
	});

	it('rebuild liefert den aktuellen Stand (Fehler): Modell bleibt, Quelltext bleibt der aktuelle', () => {
		const store = createCommandStore(titled('T0'), undefined, 'T0');
		store.codeApply(titled('T1'), 'p', undefined, 'T1');
		const doc = get(store).doc;
		store.undo(() => doc);
		expect(get(store).doc).toBe(doc);
		const seen: string[] = [];
		store.redo(rebuilder(seen));
		// Aktueller Stand ist weiter T1: Redo nach T1 braucht keinen Re-Parse.
		expect(seen).toEqual([]);
		expect(get(store).doc).toBe(doc);
	});
});
