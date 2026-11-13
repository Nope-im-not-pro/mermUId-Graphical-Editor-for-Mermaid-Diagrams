/**
 * Globale Tastaturkürzel der Shell (KONZEPT §5, T21 C3). Reine Zuordnung Taste -> Aktion inkl.
 * Fokus-Regeln: Strg-Kürzel nur bei Fokus in der App, Einzeltasten nur bei fokussiertem Canvas
 * ohne Inline-Editor. Kürzel, die der Canvas selbst behandelt (F2, Entf, Strg-D/C/X/V, Pfeile ohne
 * Shift, Shift-F10), liefern hier `null` und werden nicht gedoppelt. T123 C3: Ausführung
 * (`perform`) und globaler Handler (`keyHandler`) aus der Shell.
 */
import type { Rect } from '../canvas/common/grid';

export type Dir = 'left' | 'right' | 'up' | 'down';

export type ShellAction =
	| { type: 'save' | 'undo' | 'redo' | 'zoomIn' | 'zoomOut' | 'fit' }
	| { type: 'toggleCode' | 'search' | 'help' | 'selectAll' }
	| { type: 'toggleGrid' | 'toggleSnap' | 'connectStart' }
	| { type: 'cycle'; dir: 1 | -1 }
	/** Schritt in Rastereinheiten (10-fach). */
	| { type: 'nudge'; dx: number; dy: number }
	| { type: 'connectNeighbor'; dir: Dir };

export interface KeyLike {
	key: string;
	ctrlKey: boolean;
	metaKey: boolean;
	shiftKey: boolean;
	altKey: boolean;
}

export interface KeyContext {
	/** Fokus liegt innerhalb der App. */
	inApp: boolean;
	/** Fokus liegt im Canvas. */
	canvasFocused: boolean;
	/** Eingabefeld, Code-Editor oder Inline-Editor aktiv. */
	editing: boolean;
	/** Ein Dialog der Shell oder die Hilfe ist offen (eigene Tastaturbehandlung). */
	dialogOpen: boolean;
	/** Layout-Klasse Graph (Graph-Canvas aktiv). */
	graph: boolean;
	/** Zoombarer Canvas angezeigt (Graph oder Sequenz, T126 C3). */
	zoomable: boolean;
}

const ARROWS: Record<string, Dir> = {
	ArrowLeft: 'left',
	ArrowRight: 'right',
	ArrowUp: 'up',
	ArrowDown: 'down'
};
const DELTA: Record<Dir, [number, number]> = {
	left: [-1, 0],
	right: [1, 0],
	up: [0, -1],
	down: [0, 1]
};
const SHIFT_STEP = 10;

function modKey(e: KeyLike, ctx: KeyContext): ShellAction | null {
	const k = e.key.toLowerCase();
	if (k === 's') return { type: 'save' };
	if (k === 'e') return { type: 'toggleCode' };
	if (k === 'f') return { type: 'search' };
	if (ctx.editing) return null;
	// Zoom nicht im Code-Editor/Eingabefeld (dort Browser); Numpad liefert dieselben `key`-Werte.
	if (ctx.zoomable && (k === '+' || k === '=')) return { type: 'zoomIn' };
	if (ctx.zoomable && k === '-') return { type: 'zoomOut' };
	if (ctx.zoomable && k === '0') return { type: 'fit' };
	if (k === 'z') return { type: e.shiftKey ? 'redo' : 'undo' };
	if (k === 'y') return { type: 'redo' };
	if (k === 'a' && ctx.canvasFocused && ctx.graph) return { type: 'selectAll' };
	return null;
}

function singleKey(e: KeyLike): ShellAction | null {
	const dir = ARROWS[e.key];
	if (dir) {
		if (e.altKey && !e.shiftKey) return { type: 'connectNeighbor', dir };
		if (e.shiftKey && !e.altKey) {
			const [dx, dy] = DELTA[dir];
			return { type: 'nudge', dx: dx * SHIFT_STEP, dy: dy * SHIFT_STEP };
		}
		return null;
	}
	if (e.altKey) return null;
	if (e.key === 'Tab') return { type: 'cycle', dir: e.shiftKey ? -1 : 1 };
	const k = e.key.toLowerCase();
	if (k === 'g') return { type: e.shiftKey ? 'toggleSnap' : 'toggleGrid' };
	if (k === 'c' && !e.shiftKey) return { type: 'connectStart' };
	return null;
}

export function resolveKey(e: KeyLike, ctx: KeyContext): ShellAction | null {
	if (!ctx.inApp || ctx.dialogOpen) return null;
	const mod = e.ctrlKey || e.metaKey;
	if (e.key === 'F1' && !mod && !e.altKey) return { type: 'help' };
	if (mod) return e.altKey ? null : modKey(e, ctx);
	if (!ctx.canvasFocused || ctx.editing || !ctx.graph) return null;
	return singleKey(e);
}

export type ConnectStep = { type: 'target'; dir: Dir } | { type: 'confirm' } | { type: 'cancel' };

/** Tasten im Verbinden-Modus: Pfeile wählen das Ziel, Enter bestätigt, Esc bricht ab. */
export function connectKey(e: KeyLike): ConnectStep | null {
	if (e.ctrlKey || e.metaKey || e.altKey) return null;
	if (e.key === 'Enter') return { type: 'confirm' };
	if (e.key === 'Escape') return { type: 'cancel' };
	const dir = ARROWS[e.key];
	return dir ? { type: 'target', dir } : null;
}

const center = (r: Rect) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2 });

/** Nächster Knoten aus `ids`, dessen Mitte überwiegend in Richtung `dir` liegt. */
export function neighbor(
	geometry: Readonly<Record<string, Rect>>,
	ids: readonly string[],
	from: string,
	dir: Dir
): string | null {
	const start = geometry[from];
	if (!start) return null;
	const a = center(start);
	const [ux, uy] = DELTA[dir];
	let best: string | null = null;
	let bestDist = Infinity;
	for (const id of ids) {
		const r = geometry[id];
		if (id === from || !r) continue;
		const b = center(r);
		const dx = b.x - a.x;
		const dy = b.y - a.y;
		const along = dx * ux + dy * uy;
		const across = Math.abs(dx * uy) + Math.abs(dy * ux);
		if (along <= 0 || across > along) continue;
		const dist = Math.hypot(dx, dy);
		if (dist < bestDist) {
			best = id;
			bestDist = dist;
		}
	}
	return best;
}

/** Nächstes/vorheriges Element in Dokument-Reihenfolge; am Rand `null` (keine Tastaturfalle). */
export function cycleTarget(
	order: readonly string[],
	current: string | null,
	dir: 1 | -1
): string | null {
	const index = current === null ? -1 : order.indexOf(current);
	if (index === -1) return (dir === 1 ? order[0] : order.at(-1)) ?? null;
	return order[index + dir] ?? null;
}

/** Ausführung je Aktionstyp: `false` lässt die Taste an Browser bzw. Canvas weiter. */
export type ActionHandlers = {
	[K in ShellAction['type']]: (action: Extract<ShellAction, { type: K }>) => boolean | void;
};

/** Führt ein Kürzel aus (T123 C3); `false` = nicht behandelt. */
export function perform(action: ShellAction, handlers: ActionHandlers): boolean {
	const handler = handlers[action.type] as (action: ShellAction) => boolean | void;
	return handler(action) !== false;
}

/** Canvas-Fokus: Wrapper, Knoten oder Kante, nicht Controls/Raster-Buttons im Canvas. */
const CANVAS = '.graph-canvas, .sequence-canvas';
const CANVAS_ITEM =
	'.graph-canvas .svelte-flow__node, .graph-canvas .svelte-flow__edge, .sequence-canvas [data-id]';
const EDITING =
	'input, textarea, select, [contenteditable="true"], [contenteditable=""], .cm-editor, .inline-editor, .context-menu';

export const onCanvas = (el: Element | null) =>
	el !== null && (el.matches(CANVAS) || el.closest(CANVAS_ITEM) !== null);

export interface KeyDeps {
	root(): HTMLElement | undefined;
	/** Dialog der Shell oder Hilfe offen. */
	dialogOpen(): boolean;
	graph(): boolean;
	/** Zoombarer Canvas (Graph oder Sequenz) angezeigt. */
	zoomable(): boolean;
	/** Graph-Canvas angezeigt (Verbinden-Modus braucht ihn). */
	canvasReady(): boolean;
	connect: { readonly active: boolean; step(step: ConnectStep): void; reset(): void };
	actions: ActionHandlers;
}

/** Globale Kürzel (Capture-Phase vor den Canvas-Handlern). */
export function keyHandler(deps: KeyDeps): (e: KeyboardEvent) => void {
	return (e) => {
		const root = deps.root();
		if (!root) return;
		const focus = document.activeElement;
		const dialogOpen = deps.dialogOpen();
		const canvasFocused = onCanvas(focus);
		const editing =
			focus?.closest(EDITING) != null || root.querySelector('.inline-editor') !== null;
		if (deps.connect.active && !dialogOpen) {
			const step = deps.canvasReady() && canvasFocused && !editing ? connectKey(e) : null;
			if (step) {
				e.preventDefault();
				e.stopPropagation();
				deps.connect.step(step);
				return;
			}
			deps.connect.reset();
		}
		const action = resolveKey(e, {
			inApp: focus === null || focus === document.body || root.contains(focus),
			canvasFocused,
			editing,
			dialogOpen,
			graph: deps.graph(),
			zoomable: deps.zoomable()
		});
		if (!action || !perform(action, deps.actions)) return;
		e.preventDefault();
		e.stopPropagation();
	};
}
