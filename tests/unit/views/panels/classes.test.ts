// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import {
	classCommand,
	classNameError,
	classPanelFor,
	saveClassCommand
} from '../../../../src/lib/views/panels/properties';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import { ctx, flow, flowOut, seq } from './helpers';

const parses = (text: string) =>
	mermaid.parse(text).then(
		() => true,
		() => false
	);

const BASE = 'flowchart LR\n  A[Start] --> B\n  B --> C\n';
const STYLED = `${BASE}  style A fill:#f00,stroke:#00F,stroke-width:2px,stroke-dasharray:5 5,color:#fff\n`;

/** Re-Parse ergibt dasselbe Modell in den betroffenen Teilen. */
function sameModel(doc: DiagramDocument) {
	const again = flow(flowOut(doc));
	const pick = (d: DiagramDocument) => ({
		classDefs: d.classDefs.map((c) => ({ name: c.name, style: c.style })),
		nodes: d.nodes.map((n) => ({ id: n.id, cssClasses: n.cssClasses, style: n.style })),
		edges: d.edges.map((e) => [e.sourceId, e.targetId])
	});
	expect(pick(again)).toEqual(pick(doc));
}

describe('Als Klasse speichern (T137 C2)', () => {
	it('erzeugt classDef und class-Zuweisung, entfernt den übertragenen Inline-Stil', async () => {
		const doc = flow(STYLED);
		const cmd = saveClassCommand(doc, 'A', 'hot');
		expect(cmd).not.toBeNull();
		expect(cmd!.label).toBe('Als Klasse speichern');
		const next = cmd!.do(doc, ctx);
		expect(next.classDefs.map((c) => c.name)).toEqual(['hot']);
		expect(next.classDefs[0].style).toEqual({
			fill: '#f00',
			stroke: '#00F',
			'stroke-width': '2px',
			'stroke-dasharray': '5 5',
			color: '#fff'
		});
		const a = next.nodes.find((n) => n.id === 'A')!;
		expect(a.cssClasses).toEqual(['hot']);
		expect(a.style).toEqual({});
		expect(next.modelVersion).toBeGreaterThan(doc.modelVersion);
		const out = flowOut(next);
		expect(out).toContain(
			'classDef hot fill:#f00,stroke:#00F,stroke-width:2px,stroke-dasharray:5 5,color:#fff'
		);
		expect(out).toContain('class A hot');
		expect(out).not.toContain('style A');
		// Unveränderte Teile bleiben byte-gleich.
		expect(out.startsWith('flowchart LR\n')).toBe(true);
		expect(out).toContain('  B --> C\n');
		expect(await parses(out)).toBe(true);
		sameModel(next);
	});

	it('Werte außerhalb der Allow-Liste bleiben inline und kommen nicht in die Klasse', async () => {
		const doc = flow(`${BASE}  style A fill:#0f0,font-weight:bold,stroke:red\n`);
		const next = saveClassCommand(doc, 'A', 'ok')!.do(doc, ctx);
		expect(next.classDefs[0].style).toEqual({ fill: '#0f0' });
		const a = next.nodes.find((n) => n.id === 'A')!;
		expect(a.style).toEqual({ 'font-weight': 'bold', stroke: 'red' });
		expect(a.cssClasses).toEqual(['ok']);
		const out = flowOut(next);
		expect(out).toContain('classDef ok fill:#0f0');
		expect(await parses(out)).toBe(true);
		sameModel(next);
	});

	it('bestehende Klassen des Knotens bleiben, neue Klasse kommt dazu', async () => {
		const doc = flow(`${STYLED}  classDef cool stroke:#123\n  class A cool\n`);
		const next = saveClassCommand(doc, 'A', 'hot')!.do(doc, ctx);
		expect(next.nodes.find((n) => n.id === 'A')!.cssClasses).toEqual(['cool', 'hot']);
		expect(next.classDefs.map((c) => c.name)).toEqual(['cool', 'hot']);
		const out = flowOut(next);
		expect(out).toContain('  classDef cool stroke:#123\n');
		expect(await parses(out)).toBe(true);
		sameModel(next);
	});

	it('ohne übertragbaren Stil, ungültiger Name oder anderes Ziel: kein Command', () => {
		const doc = flow(STYLED);
		expect(saveClassCommand(flow(BASE), 'A', 'hot')).toBeNull();
		expect(saveClassCommand(doc, 'A', 'end')).toBeNull();
		expect(saveClassCommand(doc, 'e1', 'hot')).toBeNull();
		expect(saveClassCommand(doc, null, 'hot')).toBeNull();
		expect(saveClassCommand(doc, 'X', 'hot')).toBeNull();
	});

	it('Command liest beim Ausführen den aktuellen Stand; Name inzwischen vergeben -> unverändert', () => {
		const doc = flow(STYLED);
		const cmd = saveClassCommand(doc, 'A', 'hot')!;
		const taken = flow(`${STYLED}  classDef hot fill:#000\n`);
		expect(cmd.do(taken, ctx)).toBe(taken);
	});
});

describe('Klassenname prüfen (T137 C2)', () => {
	const doc = flow(`${STYLED}  classDef cool stroke:#123\n`);

	it.each([
		'hot',
		'Hot_1',
		'a-b',
		'1a',
		'END',
		'end_x',
		'call-x',
		'direction',
		'-x',
		'x-',
		'-',
		'_'
	])('%s ist gültig und parst', async (name) => {
		expect(classNameError(doc, name)).toBeNull();
		const out = flowOut(saveClassCommand(doc, 'A', name)!.do(doc, ctx));
		expect(await parses(out)).toBe(true);
	});

	it.each([
		['', 'Bitte einen Klassennamen eingeben.'],
		['   ', 'Bitte einen Klassennamen eingeben.'],
		['a b', 'Klassennamen nur aus Buchstaben, Ziffern, _ und - bilden.'],
		['x"', 'Klassennamen nur aus Buchstaben, Ziffern, _ und - bilden.'],
		['x;y', 'Klassennamen nur aus Buchstaben, Ziffern, _ und - bilden.'],
		['default', '"default" ist in mermaid reserviert.'],
		['end', '"end" ist in mermaid reserviert.'],
		['end-x', '"end-x" ist in mermaid reserviert.'],
		['a--b', 'Klassennamen dürfen kein -- enthalten.'],
		['x--', 'Klassennamen dürfen kein -- enthalten.'],
		['--', 'Klassennamen dürfen kein -- enthalten.'],
		['href', '"href" ist in mermaid reserviert.'],
		['cool', 'Die Klasse "cool" gibt es schon.']
	])('%j wird abgelehnt', (name, message) => {
		expect(classNameError(doc, name)).toBe(message);
		expect(saveClassCommand(doc, 'A', name)).toBeNull();
	});

	it('Gegenprobe: abgelehnte Schlüsselwörter parst mermaid nicht', async () => {
		for (const name of ['end', 'end-x', 'href', 'style', 'class', 'graph-1', 'a--b', 'x--', '--']) {
			expect(classNameError(doc, name)).not.toBeNull();
			expect(await parses(`${BASE}  classDef ${name} fill:#f00\n  class A ${name}\n`)).toBe(false);
		}
	});
});

describe('Klassen-Liste (T137 C2)', () => {
	const TEXT =
		`${BASE}  classDef hot fill:#F00,stroke:red,color:#fff\n` +
		'  classDef default fill:#eee\n  classDef cool fill:#abc,stroke:#00f\n  class A hot\n';

	it('Einträge mit Vorschau nur aus Allow-Liste, ohne default, Zuweisung am Knoten', () => {
		const doc = flow(TEXT);
		expect(classPanelFor(doc, 'A')).toEqual({
			saveable: false,
			entries: [
				{ name: 'hot', fill: '#F00', color: '#fff', assigned: true },
				{ name: 'cool', fill: '#abc', stroke: '#00f', assigned: false }
			]
		});
		expect(classPanelFor(doc, 'B')?.entries.map((e) => e.assigned)).toEqual([false, false]);
	});

	it('nur für flowchart-Knoten', () => {
		const doc = flow(TEXT);
		expect(classPanelFor(doc, 'e1')).toBeNull();
		expect(classPanelFor(doc, null)).toBeNull();
		expect(classPanelFor(seq('sequenceDiagram\n  A->>B: x\n'), 'A')).toBeNull();
		expect(classPanelFor(flow(STYLED), 'A')).toEqual({ saveable: true, entries: [] });
	});

	it('Zuweisen und Entfernen als Command, Code gültig, Re-Parse = Modell', async () => {
		const doc = flow(TEXT);
		const added = classCommand(doc, 'B', 'cool', true)!.do(doc, ctx);
		expect(added.nodes.find((n) => n.id === 'B')!.cssClasses).toEqual(['cool']);
		const out = flowOut(added);
		expect(out).toContain('class B cool');
		expect(await parses(out)).toBe(true);
		sameModel(added);

		const removed = classCommand(doc, 'A', 'hot', false)!.do(doc, ctx);
		expect(removed.nodes.find((n) => n.id === 'A')!.cssClasses).toEqual([]);
		const out2 = flowOut(removed);
		expect(out2).not.toContain('class A hot');
		expect(out2).toContain('  classDef hot fill:#F00,stroke:red,color:#fff\n');
		expect(await parses(out2)).toBe(true);
		sameModel(removed);
	});

	it('ohne Wirkung oder unbekannte Klasse: kein Command', () => {
		const doc = flow(TEXT);
		expect(classCommand(doc, 'A', 'hot', true)).toBeNull();
		expect(classCommand(doc, 'B', 'hot', false)).toBeNull();
		expect(classCommand(doc, 'B', 'nope', true)).toBeNull();
		expect(classCommand(doc, 'B', 'default', true)).toBeNull();
		expect(classCommand(doc, 'e1', 'hot', true)).toBeNull();
	});
});
