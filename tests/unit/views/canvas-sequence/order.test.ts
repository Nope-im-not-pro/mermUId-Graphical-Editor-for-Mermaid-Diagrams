// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { textMeasure, toSequence } from '../../../../src/lib/views/canvas/sequence/mapping';
import {
	dropTarget,
	moveTo,
	participantIndexAt,
	participantOrder,
	reorderParticipants,
	stepParticipant,
	stepVertical,
	verticalGroups
} from '../../../../src/lib/views/canvas/sequence/order';
import { apply, parseOk, roundTrip, SAMPLE } from './helpers';

const doc = parseOk(SAMPLE);
type Alt = [string, string, [string, unknown[]][]];

async function check(command: Parameters<typeof roundTrip>[1], text = SAMPLE) {
	const r = await roundTrip(text, command);
	expect(r.same[0]).toEqual(r.same[1]);
	return r;
}

describe('Teilnehmer horizontal', () => {
	it('Reihenfolge und Schritt', async () => {
		expect(participantOrder(doc)).toEqual(['A', 'B']);
		const r = await check(stepParticipant(doc, 'A', 1)!);
		expect(r.same[0].participants.map((p) => p.id)).toEqual(['B', 'A']);
		expect(r.same[0].participants[1].label).toBe('Alice');
		expect(stepParticipant(doc, 'A', -1)).toBeNull();
		expect(stepParticipant(doc, 'zz', 1)).toBeNull();
	});

	it('implizite Teilnehmer werden deklariert', async () => {
		const r = await check(
			reorderParticipants(['C', 'B', 'A']),
			'sequenceDiagram\nA->>B: x\nB->>C: y\n'
		);
		expect(r.same[0].participants.map((p) => p.id)).toEqual(['C', 'B', 'A']);
	});

	it('RawBlock-Teilnehmer bleiben fest', () => {
		const based = parseOk('sequenceDiagram\nbox currentcolor G\nparticipant X\nend\nX->>Y: a\n');
		expect(() => apply(based, reorderParticipants(['Y', 'X']))).toThrow(
			'nicht grafisch editierbar'
		);
		expect(() => apply(doc, reorderParticipants(['A']))).toThrow('Teilnehmer');
	});

	it('Index beim Ziehen', () => {
		const v = toSequence(doc, [], textMeasure);
		const [a, b] = v.lifelines;
		expect(participantIndexAt(v, 'A', b.x + 1)).toBe(1);
		expect(participantIndexAt(v, 'B', a.x - 1)).toBe(0);
	});
});

describe('Nachrichten und Notizen vertikal', () => {
	it('Gruppen überspringen unsichtbare Elemente', () => {
		const groups = verticalGroups(doc, 'e1');
		// vor n1 | vor c1 | Anfang alt | Anfang else ... | hinter c1 (vor autonumber und Ende)
		expect(groups[0]).toEqual([
			{ parent: null, section: 0, index: 0 },
			{ parent: null, section: 0, index: 1 },
			{ parent: null, section: 0, index: 2 }
		]);
		expect(groups.at(-1)).toEqual([
			{ parent: null, section: 0, index: 4 },
			{ parent: null, section: 0, index: 5 }
		]);
	});

	it('Schritt nach unten und oben, auch in Blöcke hinein', async () => {
		const down = await check(stepVertical(doc, 'e1', 1)!);
		expect(down.same[0].body.slice(0, 2).map((x) => (x as unknown[])[0])).toEqual([
			'note',
			'message'
		]);
		const intoAlt = await check(stepVertical(doc, 'n1', 1)!);
		expect((intoAlt.same[0].body[1] as Alt)[2][0][1][0]).toEqual([
			'note',
			'over',
			['A', 'B'],
			'Notiz'
		]);
		const up = await check(stepVertical(doc, 'e2', -1)!);
		expect((up.same[0].body[2] as unknown[])[0]).toBe('message');
		expect(stepVertical(doc, 'e1', -1)).toBeNull();
		expect(stepVertical(doc, 'A', 1)).toBeNull();
	});

	it('Block verschieben, nicht in sich selbst', async () => {
		const r = await check(stepVertical(doc, 'c1', -1)!);
		expect((r.same[0].body[1] as unknown[])[0]).toBe('alt');
		for (const g of verticalGroups(doc, 'c1')) {
			expect(g.every((p) => p.parent !== 'c1')).toBe(true);
		}
	});

	it('Deaktivierung nicht vor Aktivierung', () => {
		expect(() => apply(doc, stepVertical(doc, 'e3', 1)!)).not.toThrow();
		const bad = moveTo('e5', { parent: 'c1', section: 1, index: 0 });
		expect(() => apply(doc, bad)).toThrow('Aktivierung');
	});

	it('Ablegen am nächsten Punkt', () => {
		const v = toSequence(doc, [], textMeasure);
		const e4 = v.items.find((i) => i.id === 'e4')!;
		expect(dropTarget(doc, v, 'e1', e4.box.y)).toEqual({ parent: 'c1', section: 1, index: 1 });
		expect(dropTarget(doc, v, 'e1', 99999)).toEqual({ parent: null, section: 0, index: 4 });
	});
});
