// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
	editTarget,
	keyIntent,
	stepCommand,
	toModelDelta,
	toScreenBox
} from '../../../../src/lib/views/canvas/sequence/interaction';
import { textMeasure, toSequence } from '../../../../src/lib/views/canvas/sequence/mapping';
import { apply, parseOk, SAMPLE, semantic } from './helpers';

const key = (
	k: string,
	mods: Partial<Record<'shiftKey' | 'ctrlKey' | 'metaKey' | 'altKey', boolean>> = {}
) => ({
	key: k,
	shiftKey: false,
	ctrlKey: false,
	metaKey: false,
	altKey: false,
	...mods
});
const on = { canvasFocused: true, editing: false };

describe('keyIntent', () => {
	it('Einzeltasten nur bei Canvas-Fokus und ohne Editor', () => {
		expect(keyIntent(key('F2'), on)).toEqual({ type: 'edit' });
		expect(keyIntent(key('Delete'), on)).toEqual({ type: 'delete' });
		expect(keyIntent(key('Backspace'), on)).toEqual({ type: 'delete' });
		expect(keyIntent(key('ArrowLeft'), on)).toEqual({ type: 'step', axis: 'x', dir: -1 });
		expect(keyIntent(key('ArrowDown'), on)).toEqual({ type: 'step', axis: 'y', dir: 1 });
		expect(keyIntent(key('ArrowUp'), on)).toEqual({ type: 'step', axis: 'y', dir: -1 });
		expect(keyIntent(key('ArrowRight'), on)).toEqual({ type: 'step', axis: 'x', dir: 1 });
		expect(keyIntent(key('F2'), { canvasFocused: false, editing: false })).toBeNull();
		expect(keyIntent(key('Delete'), { canvasFocused: true, editing: true })).toBeNull();
		expect(keyIntent(key('d', { ctrlKey: true }), on)).toBeNull();
		expect(keyIntent(key('x'), on)).toBeNull();
	});
});

describe('stepCommand', () => {
	const doc = parseOk(SAMPLE);
	const view = toSequence(doc, [], textMeasure);

	it('Teilnehmer horizontal, übrige Elemente vertikal', () => {
		const right = stepCommand(doc, view, 'A', 'x', 1)!;
		expect(semantic(apply(doc, right)).participants.map((p) => p.id)).toEqual(['B', 'A']);
		expect(stepCommand(doc, view, 'A', 'y', 1)).toBeNull();
		const down = stepCommand(doc, view, 'e1', 'y', 1)!;
		expect(apply(doc, down).order.slice(2, 5)).toEqual(['n1', 'e1', 'c1']);
		expect(stepCommand(doc, view, 'e1', 'x', 1)).toBeNull();
		expect(stepCommand(doc, view, 'c1:1', 'y', 1)).toBeNull();
		expect(stepCommand(doc, view, 'fehlt', 'y', 1)).toBeNull();
	});
});

describe('editTarget', () => {
	const doc = parseOk(SAMPLE);
	const view = toSequence(doc, [], textMeasure);

	it('Label-Text und Lage je Element', () => {
		expect(editTarget(doc, view, 'A')).toMatchObject({ id: 'A', text: 'Alice' });
		expect(editTarget(doc, view, 'e1')).toMatchObject({ id: 'e1', text: 'Hallo' });
		expect(editTarget(doc, view, 'n1')).toMatchObject({ text: 'Notiz' });
		expect(editTarget(doc, view, 'c1')).toMatchObject({ text: 'Fall' });
		expect(editTarget(doc, view, 'c1:1')).toMatchObject({ text: 'Sonst' });
		const box = editTarget(doc, view, 'e1')!.box;
		expect(box.w).toBeGreaterThan(0);
	});

	it('nicht editierbar: Aktivierung, Basis-Teilnehmer, unbekannt', () => {
		expect(editTarget(doc, view, 'e3')).toBeNull();
		expect(editTarget(doc, view, 'fehlt')).toBeNull();
		const d = parseOk('sequenceDiagram\nbox currentcolor G\nparticipant X\nend\nX->>Y: a\n');
		expect(editTarget(d, toSequence(d, [], textMeasure), 'X')).toBeNull();
	});
});

describe('Zoom-Umrechnung (T124)', () => {
	it('toModelDelta teilt Bildschirm-Pixel durch den Zoom', () => {
		expect(toModelDelta(100, -40, 0.5)).toEqual({ dx: 200, dy: -80 });
		expect(toModelDelta(100, -40, 2)).toEqual({ dx: 50, dy: -20 });
	});

	it('toScreenBox verschiebt um den Ursprung und skaliert', () => {
		const box = { x: 30, y: 50, w: 100, h: 40 };
		expect(toScreenBox(box, { x: 10, y: 20 }, 2)).toEqual({ x: 40, y: 60, w: 200, h: 80 });
		expect(toScreenBox(box, { x: 10, y: 20 }, 0.5)).toEqual({ x: 10, y: 15, w: 50, h: 20 });
	});
});
