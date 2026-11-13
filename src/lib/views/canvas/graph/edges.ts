/**
 * Kantengeometrie für den Graph-Canvas: Pfad über `edgePath`, Pfeilspitzen über `markerFor`
 * als eigene SVG-Pfade (ohne `url()`-Referenzen).
 */
import { Position } from '@xyflow/svelte';
import { edgePath, markerFor, type EdgeEnd, type EdgeKind } from '../../../services/shapes';

export type HandleSide = 'n' | 'e' | 's' | 'w';

const SIDES: Record<HandleSide, Position> = {
	n: Position.Top,
	e: Position.Right,
	s: Position.Bottom,
	w: Position.Left
};

export function sideOf(handle: HandleSide): Position {
	return SIDES[handle];
}

/** Außennormale je Seite und Drehung einer Spitze, die in den Knoten zeigt. */
const NORMAL: Record<Position, { dx: number; dy: number; angle: number }> = {
	[Position.Left]: { dx: -1, dy: 0, angle: 0 },
	[Position.Top]: { dx: 0, dy: -1, angle: 90 },
	[Position.Right]: { dx: 1, dy: 0, angle: 180 },
	[Position.Bottom]: { dx: 0, dy: 1, angle: 270 }
};

/**
 * Lage des Umhäng-Griffs (F-03): um `by` entlang der Außennormale vor dem Kantenende, damit der
 * Griff neben dem Knoten liegt (Knoten und Handles liegen über der Label-Ebene).
 */
export function anchorPoint(end: EdgeEnd, by: number): { x: number; y: number } {
	const n = NORMAL[end.position];
	return { x: end.x + n.dx * by, y: end.y + n.dy * by };
}

export interface PlacedMarker {
	path: string;
	transform: string;
	filled: boolean;
}

export interface EdgeShape {
	path: string;
	labelX: number;
	labelY: number;
	markers: PlacedMarker[];
}

export function edgeGeometry(
	from: EdgeEnd,
	to: EdgeEnd,
	arrowHead: string,
	kind: EdgeKind = 'bezier'
): EdgeShape {
	const { start, end } = markerFor(arrowHead);
	const markers: PlacedMarker[] = [];
	const inset = (p: EdgeEnd, by: number): EdgeEnd => {
		const n = NORMAL[p.position];
		return { ...p, x: p.x + n.dx * by, y: p.y + n.dy * by };
	};
	const place = (p: EdgeEnd, path: string, filled: boolean) =>
		markers.push({
			path,
			transform: `translate(${p.x} ${p.y}) rotate(${NORMAL[p.position].angle})`,
			filled
		});
	if (start) place(from, start.path, start.filled);
	if (end) place(to, end.path, end.filled);
	const g = edgePath(
		kind,
		start ? inset(from, start.inset) : from,
		end ? inset(to, end.inset) : to
	);
	return { ...g, markers };
}

export type EdgeEndType = 'source' | 'target';

/**
 * Endpunkte nach dem Umhängen eines Kantenendes auf `nodeId` (F-03). `null`, wenn das Ende
 * unverändert bliebe oder eine Selbstkante entstünde: dann kein Command, kein Undo-Schritt.
 */
export function reconnectEnds(
	edge: { sourceId: string; targetId: string },
	end: EdgeEndType,
	nodeId: string
): { sourceId: string; targetId: string } | null {
	const next = end === 'source' ? { ...edge, sourceId: nodeId } : { ...edge, targetId: nodeId };
	if (next.sourceId === next.targetId) return null;
	if (next.sourceId === edge.sourceId && next.targetId === edge.targetId) return null;
	return { sourceId: next.sourceId, targetId: next.targetId };
}
