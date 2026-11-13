/** Reine Hilfen der Canvas-Interaktion: Flow-Ereignisse -> Command-Eingaben. */
import { guidesFor, type Rect } from '../common/grid';
import type { Move } from './commands';
import { editorText, type FlowModel } from './mapping';

type Placed = { id: string; position: { x: number; y: number }; parentId?: string };

/** Gezogene Flow-Knoten (Position relativ zum Container) als absolute Ziele. */
export function dragMoves(dragged: readonly Placed[], geometry: Record<string, Rect>): Move[] {
	return dragged.map((n) => {
		const base = n.parentId ? geometry[n.parentId] : undefined;
		return { id: n.id, x: n.position.x + (base?.x ?? 0), y: n.position.y + (base?.y ?? 0) };
	});
}

/** Tastatur-Verschiebung bekannter Elemente. */
export function nudgeMoves(
	ids: readonly string[],
	geometry: Record<string, Rect>,
	dx: number,
	dy: number
): Move[] {
	return ids
		.filter((id) => geometry[id])
		.map((id) => ({ id, x: geometry[id].x + dx, y: geometry[id].y + dy }));
}

export type EditTarget = { id: string; text: string; box: Rect };

const EDGE_BOX = { w: 160, h: 40 };

/** Editor-Text und Lage (Flow-Koordinaten) für Knoten, Container oder Kante. */
export function editTarget(flow: FlowModel, id: string): EditTarget | null {
	const node = flow.nodes.find((n) => n.id === id);
	if (node) return { id, text: editorText(node.data.label), box: flow.geometry[id] };
	const edge = flow.edges.find((e) => e.id === id);
	if (!edge) return null;
	const s = flow.geometry[edge.source];
	const t = flow.geometry[edge.target];
	const cx = (s.x + s.w / 2 + t.x + t.w / 2) / 2;
	const cy = (s.y + s.h / 2 + t.y + t.h / 2) / 2;
	return {
		id,
		text: editorText(edge.data?.label ?? ''),
		box: { x: cx - EDGE_BOX.w / 2, y: cy - EDGE_BOX.h / 2, ...EDGE_BOX }
	};
}

/** Hilfslinien für den gezogenen Knoten gegen alle übrigen, außer dem eigenen Container. */
export function dragGuides(target: Placed, draggedIds: readonly string[], flow: FlowModel) {
	const own = flow.geometry[target.id];
	if (!own) return { vertical: [], horizontal: [] };
	const [at] = dragMoves([target], flow.geometry);
	const skip = new Set([...draggedIds, target.parentId]);
	const others = flow.nodes.filter((n) => !skip.has(n.id)).map((n) => flow.geometry[n.id]);
	return guidesFor({ ...own, x: at.x, y: at.y }, others);
}

export type View = { x: number; y: number; zoom: number };

/** Rand zum Pane-Rand, wenn ein Element in den Sichtbereich geholt wird. */
const REVEAL_MARGIN = 24;

/** Neuer Offset einer Achse: unverändert, minimal verschoben (mit Rand) oder zentriert. */
function revealAxis(offset: number, start: number, len: number, extent: number, zoom: number) {
	const lo = start * zoom + offset;
	const hi = lo + len * zoom;
	if (lo >= 0 && hi <= extent) return offset;
	if (hi - lo > extent - 2 * REVEAL_MARGIN) return extent / 2 - (start + len / 2) * zoom;
	return lo < 0 ? offset + REVEAL_MARGIN - lo : offset - (hi - extent + REVEAL_MARGIN);
}

/**
 * Viewport, der `box` (Flow-Koordinaten) vollständig in der Fläche `size` zeigt (V-21).
 * `null`, wenn `box` schon vollständig sichtbar ist oder die Fläche ungemessen ist (kein Sprung);
 * der Zoom bleibt stets gleich.
 */
export function revealViewport(
	box: Rect,
	view: View,
	size: { width: number; height: number }
): View | null {
	if (size.width <= 0 || size.height <= 0) return null;
	const x = revealAxis(view.x, box.x, box.w, size.width, view.zoom);
	const y = revealAxis(view.y, box.y, box.h, size.height, view.zoom);
	return x === view.x && y === view.y ? null : { x, y, zoom: view.zoom };
}

/** System-Zwischenablage (Ausschnitt von `navigator.clipboard`). */
export type SystemClipboard = Pick<Clipboard, 'readText' | 'writeText'>;

/**
 * Zwischenablage des Canvas (T133 C3): Schreiben in die System-Zwischenablage und in einen
 * fensterinternen Puffer (zuletzt Kopiertes/Ausgeschnittenes). Lesen aus der System-Zwischenablage
 * nur mit Leserecht (`canRead`); abgelehnt, leer oder ohne API gilt der Puffer, damit Einfügen im
 * Fenster auch ohne Leserecht (Firefox) funktioniert. Schlug das letzte Schreiben fehl, gilt der
 * Puffer ebenfalls (sonst käme älterer Systeminhalt). `null`: nichts zum Einfügen.
 */
export function canvasClipboard(
	system: () => SystemClipboard | undefined,
	canRead: () => Promise<boolean>
) {
	let buffer: string | null = null;
	/** Letztes Schreiben in die System-Zwischenablage fehlgeschlagen: dort steht Älteres. */
	let stale = false;
	return {
		write(text: string) {
			buffer = text;
			stale = false;
			system()
				?.writeText(text)
				.catch(() => {
					if (buffer === text) stale = true;
				});
		},
		async read(): Promise<string | null> {
			const clip = system();
			if (clip && !stale && (await canRead())) {
				const text = await clip.readText().catch(() => '');
				if (text) return text;
			}
			return buffer;
		}
	};
}

/**
 * Leserecht der Zwischenablage ohne Rückfrage-Schleife: `granted`/`prompt` ja (Chromium fragt in der
 * Geste), `denied` nein; ein unbekannter Name `clipboard-read` (Firefox, Safari) oder fehlende API:
 * nein, dort liefe `readText` über ein Einfüge-Popup des Browsers.
 */
export async function clipboardReadable(permissions: Permissions | undefined): Promise<boolean> {
	if (!permissions) return false;
	try {
		const status = await permissions.query({ name: 'clipboard-read' as PermissionName });
		return status.state !== 'denied';
	} catch {
		return false;
	}
}
