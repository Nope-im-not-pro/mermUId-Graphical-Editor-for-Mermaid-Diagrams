/** Reine Hilfen der Sequenz-Interaktion: Tasten -> Absicht, Absicht -> Command, Editor-Ziel. */
import type { Command } from '../../../controllers/commands/history';
import type { DiagramDocument } from '../../../model/types';
import { resolveShortcut, type KeyLike } from '../common/shortcuts';
import { editorText, parseSectionId, type Box, type SeqView } from './mapping';
import { stepParticipant, stepVertical } from './order';

export type SeqAction =
	{ type: 'edit' } | { type: 'delete' } | { type: 'step'; axis: 'x' | 'y'; dir: -1 | 1 };

/** Einzeltasten über `resolveShortcut` (Canvas-Fokus, kein Editor); Duplizieren entfällt. */
export function keyIntent(
	e: KeyLike,
	ctx: { canvasFocused: boolean; editing: boolean }
): SeqAction | null {
	const action = resolveShortcut(e, { ...ctx, step: 1 });
	if (!action || action.type === 'duplicate') return null;
	if (action.type !== 'move') return action;
	return action.dx !== 0
		? { type: 'step', axis: 'x', dir: action.dx < 0 ? -1 : 1 }
		: { type: 'step', axis: 'y', dir: action.dy < 0 ? -1 : 1 };
}

/** Pfeiltaste am Element: Teilnehmer nur horizontal, übrige nur vertikal. */
export function stepCommand(
	doc: DiagramDocument,
	view: SeqView,
	id: string,
	axis: 'x' | 'y',
	dir: -1 | 1
): Command | null {
	const item = view.items.find((i) => i.id === id);
	if (!item) return null;
	const horizontal = item.type === 'participant' || item.type === 'actor';
	if (horizontal !== (axis === 'x')) return null;
	return horizontal ? stepParticipant(doc, id, dir) : stepVertical(doc, id, dir);
}

export type EditTarget = { id: string; text: string; box: Box };

/** Editor-Text (Modell-Label) und Lage für editierbare Elemente. */
export function editTarget(doc: DiagramDocument, view: SeqView, id: string): EditTarget | null {
	const item = view.items.find((i) => i.id === id);
	if (!item?.editable) return null;
	let label: string;
	if (item.type === 'section') {
		const s = parseSectionId(id)!;
		label = doc.containers.find((c) => c.id === s.containerId)!.sections[s.index].label;
	} else {
		const el =
			doc.nodes.find((n) => n.id === id) ??
			doc.edges.find((e) => e.id === id) ??
			doc.containers.find((c) => c.id === id)!;
		label = el.label;
	}
	return { id, text: editorText(label), box: item.box };
}

/** Zeiger-Verschiebung in Bildschirm-Pixeln -> Modell-Einheiten (CSS-Skalierung, T124). */
export function toModelDelta(dx: number, dy: number, zoom: number): { dx: number; dy: number } {
	return { dx: dx / zoom, dy: dy / zoom };
}

/** Modell-Box -> Lage in der gescrollten Fläche: um den viewBox-Ursprung verschoben, skaliert. */
export function toScreenBox(box: Box, origin: { x: number; y: number }, zoom: number): Box {
	return {
		x: (box.x - origin.x) * zoom,
		y: (box.y - origin.y) * zoom,
		w: box.w * zoom,
		h: box.h * zoom
	};
}

/** Abstand des Fokusrings zur Box in Bildschirm-Pixeln (V-32, T124 C2). */
export const RING_GAP = 3;

/** Fokusring um eine Modell-Box: Abstand bei jedem Zoom `RING_GAP` Bildschirm-Pixel. */
export function focusRing(box: Box, zoom: number): Box {
	const gap = RING_GAP / zoom;
	return { x: box.x - gap, y: box.y - gap, w: box.w + 2 * gap, h: box.h + 2 * gap };
}
