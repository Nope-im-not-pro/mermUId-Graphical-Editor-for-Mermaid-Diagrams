/**
 * Tastatur-Zuordnung des Canvas (reine Logik). Einzeltasten greifen nur bei Canvas-Fokus und
 * ohne aktiven Inline-Editor.
 */
export interface KeyLike {
	key: string;
	shiftKey: boolean;
	ctrlKey: boolean;
	metaKey: boolean;
	altKey: boolean;
}

export interface ShortcutContext {
	canvasFocused: boolean;
	editing: boolean;
	/** Schrittweite der Pfeiltasten in Flow-Pixeln. */
	step: number;
}

export type CanvasAction =
	| { type: 'edit' }
	| { type: 'delete' }
	| { type: 'duplicate' }
	| { type: 'move'; dx: number; dy: number };

const ARROWS: Record<string, [number, number]> = {
	ArrowLeft: [-1, 0],
	ArrowRight: [1, 0],
	ArrowUp: [0, -1],
	ArrowDown: [0, 1]
};

export function resolveShortcut(e: KeyLike, ctx: ShortcutContext): CanvasAction | null {
	if (!ctx.canvasFocused || ctx.editing) return null;
	const mod = e.ctrlKey || e.metaKey;
	if (mod && !e.altKey && e.key.toLowerCase() === 'd') return { type: 'duplicate' };
	if (mod || e.altKey) return null;
	if (e.key === 'F2') return { type: 'edit' };
	if (e.key === 'Delete' || e.key === 'Backspace') return { type: 'delete' };
	const dir = ARROWS[e.key];
	if (dir) return { type: 'move', dx: dir[0] * ctx.step, dy: dir[1] * ctx.step };
	return null;
}

export type ClipboardAction = 'copy' | 'cut' | 'paste';

const CLIPBOARD_KEYS: Record<string, ClipboardAction> = { c: 'copy', x: 'cut', v: 'paste' };

/**
 * Strg/Cmd-C/X/V des Graph-Canvas (T133), getrennt von `resolveShortcut`, damit der Sequenz-Canvas
 * sie nicht erhält (no-op). Fokus-Regeln wie dort; Umschalt egal, Alt nie.
 */
export function clipboardShortcut(e: KeyLike, ctx: ShortcutContext): ClipboardAction | null {
	if (!ctx.canvasFocused || ctx.editing || e.altKey || !(e.ctrlKey || e.metaKey)) return null;
	const k = e.key.toLowerCase();
	return Object.hasOwn(CLIPBOARD_KEYS, k) ? CLIPBOARD_KEYS[k] : null;
}

/** Tasten im Inline-Editor: Enter übernimmt, Umschalt+Enter bricht um, Escape verwirft. */
export function editorKey(e: KeyLike): 'commit' | 'cancel' | null {
	if (e.key === 'Enter' && !e.shiftKey) return 'commit';
	if (e.key === 'Escape') return 'cancel';
	return null;
}
