/**
 * Code-Panel (T19 C2): reine Logik ohne DOM. Zeilen-Diff nach Myers (O(N·D), gemeinsamer
 * Anfang und Ende vorab abgeschnitten, Obergrenze für D), Änderungen für Fremd-Updates mit
 * Cursor-Erhalt, Fehler-Diagnosen, Mermaid-Stream-Parser und Undo-Keymap (D-09: der
 * Command-Stack des Sync-Controllers ersetzt die Editor-Historie).
 */
import type { StreamParser } from '@codemirror/language';
import type { Diagnostic } from '@codemirror/lint';
import type { Extension } from '@codemirror/state';
import { EditorView, type KeyBinding } from '@codemirror/view';
import type { ParseError } from '../../model/types';
import { t } from '../shell/i18n.svelte';

export type Op = 'same' | 'del' | 'add';

export interface DiffRow {
	readonly type: Op;
	readonly text: string;
}

export interface TextChange {
	readonly from: number;
	readonly to: number;
	readonly insert: string;
}

/** Oberhalb dieser Editier-Distanz wird der Mittelteil komplett ersetzt. */
export const MAX_D = 2000;

/**
 * Myers-Diff über Zeilen-Kennungen. Liefert die Operationen in Reihenfolge; innerhalb eines
 * Blocks stehen Löschungen vor Einfügungen.
 */
export function diffOps(a: readonly string[], b: readonly string[], maxD = MAX_D): Op[] {
	const ids = new Map<string, number>();
	const key = (s: string) => {
		let id = ids.get(s);
		if (id === undefined) ids.set(s, (id = ids.size));
		return id;
	};
	const A = Int32Array.from(a, key);
	const B = Int32Array.from(b, key);
	let pre = 0;
	while (pre < A.length && pre < B.length && A[pre] === B[pre]) pre++;
	let suf = 0;
	while (
		suf < A.length - pre &&
		suf < B.length - pre &&
		A[A.length - 1 - suf] === B[B.length - 1 - suf]
	) {
		suf++;
	}
	const middle = myers(A.subarray(pre, A.length - suf), B.subarray(pre, B.length - suf), maxD);
	const ops: Op[] = [...Array<Op>(pre).fill('same'), ...middle, ...Array<Op>(suf).fill('same')];
	return delsFirst(ops);
}

function myers(A: Int32Array, B: Int32Array, maxD: number): Op[] {
	const n = A.length;
	const m = B.length;
	const replace = (): Op[] => [...Array<Op>(n).fill('del'), ...Array<Op>(m).fill('add')];
	if (n === 0 || m === 0) return replace();
	const limit = Math.min(n + m, maxD);
	const off = limit + 1;
	const v = new Int32Array(2 * limit + 3);
	const trace: Int32Array[] = [];
	for (let d = 0; d <= limit; d++) {
		trace.push(v.slice(off - d, off + d + 1));
		for (let k = -d; k <= d; k += 2) {
			let x =
				k === -d || (k !== d && v[off + k - 1] < v[off + k + 1])
					? v[off + k + 1]
					: v[off + k - 1] + 1;
			let y = x - k;
			while (x < n && y < m && A[x] === B[y]) {
				x++;
				y++;
			}
			v[off + k] = x;
			if (x >= n && y >= m) return backtrack(trace, n, m, d);
		}
	}
	return replace();
}

function backtrack(trace: Int32Array[], n: number, m: number, D: number): Op[] {
	const out: Op[] = [];
	let x = n;
	let y = m;
	for (let d = D; d > 0; d--) {
		const prev = trace[d];
		const at = (k: number) => prev[k + d];
		const k = x - y;
		const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
		const pk = down ? k + 1 : k - 1;
		const px = at(pk);
		const py = px - pk;
		while (x > px && y > py) {
			out.push('same');
			x--;
			y--;
		}
		out.push(down ? 'add' : 'del');
		x = px;
		y = py;
	}
	for (; x > 0; x--) out.push('same');
	return out.reverse();
}

function delsFirst(ops: Op[]): Op[] {
	const out: Op[] = [];
	let dels = 0;
	let adds = 0;
	const flush = () => {
		for (; dels > 0; dels--) out.push('del');
		for (; adds > 0; adds--) out.push('add');
	};
	for (const op of ops) {
		if (op === 'del') dels++;
		else if (op === 'add') adds++;
		else {
			flush();
			out.push(op);
		}
	}
	flush();
	return out;
}

/** Zeilen-Diff für die Konflikt-Ansicht (Zeilenenden normalisiert). */
export function lineDiff(before: string, after: string, maxD = MAX_D): DiffRow[] {
	const a = before.split(/\r?\n/);
	const b = after.split(/\r?\n/);
	let i = 0;
	let j = 0;
	return diffOps(a, b, maxD).map((type) => {
		if (type === 'add') return { type, text: b[j++] };
		if (type === 'same') j++;
		return { type, text: a[i++] };
	});
}

/** Zeilen samt Zeilenende; die Verkettung ergibt exakt den Text. */
const units = (text: string): string[] => text.match(/[^\n]*\n|[^\n]+$/g) ?? [];

interface Hunk {
	oldFrom: number;
	newFrom: number;
	dels: string[];
	adds: string[];
	same: boolean;
}

function hunks(before: string, after: string): Hunk[] {
	const a = units(before);
	const b = units(after);
	const out: Hunk[] = [];
	let i = 0;
	let j = 0;
	let o = 0;
	let p = 0;
	let open: Hunk | null = null;
	for (const op of diffOps(a, b)) {
		if (op === 'same') {
			open = null;
			out.push({ oldFrom: o, newFrom: p, dels: [a[i]], adds: [b[j]], same: true });
			o += a[i++].length;
			p += b[j++].length;
			continue;
		}
		if (!open) out.push((open = { oldFrom: o, newFrom: p, dels: [], adds: [], same: false }));
		if (op === 'del') o += (open.dels[open.dels.length] = a[i++]).length;
		else p += (open.adds[open.adds.length] = b[j++]).length;
	}
	return out;
}

const size = (list: readonly string[]) => list.reduce((s, t) => s + t.length, 0);

/** Minimale Zeilen-Änderungen von `before` nach `after` (Offsets in `before`, aufsteigend). */
export function changesFor(before: string, after: string): TextChange[] {
	return hunks(before, after)
		.filter((h) => !h.same)
		.map((h) => ({ from: h.oldFrom, to: h.oldFrom + size(h.dels), insert: h.adds.join('') }));
}

/**
 * Cursor-Position nach einem Fremd-Update: unveränderte Zeilen behalten Spalte, geänderte
 * Zeilen bleiben an gleicher Zeile im Block und gleicher Spalte (begrenzt).
 */
export function mapCursor(before: string, after: string, pos: number): number {
	const at = Math.max(0, Math.min(pos, before.length));
	for (const h of hunks(before, after)) {
		let o = h.oldFrom;
		for (let r = 0; r < h.dels.length; r++) {
			const len = h.dels[r].length;
			if (at < o + len) {
				if (h.same) return h.newFrom + (at - o);
				if (h.adds.length === 0) return h.newFrom;
				const row = Math.min(r, h.adds.length - 1);
				const line = h.adds[row].replace(/\r?\n$/, '');
				return h.newFrom + size(h.adds.slice(0, row)) + Math.min(at - o, line.length);
			}
			o += len;
		}
	}
	return after.length;
}

/** Bereich einer Zeile (1-basiert, begrenzt) ohne Zeilenende. */
export function lineRange(text: string, line: number): { from: number; to: number } {
	const list = text.split('\n');
	const index = Math.max(0, Math.min(Math.trunc(line) - 1, list.length - 1));
	let from = 0;
	for (let i = 0; i < index; i++) from += list[i].length + 1;
	return { from, to: from + list[index].replace(/\r$/, '').length };
}

/** Parser-Fehler als Lint-Diagnosen (Spalte 1-basiert, auf die Zeile begrenzt). */
export function toDiagnostics(text: string, errors: readonly ParseError[]): Diagnostic[] {
	return errors.map((e) => {
		const { from, to } = lineRange(text, e.line);
		const start = Math.min(from + Math.max(0, Math.trunc(e.column) - 1), to);
		return {
			from: start,
			to,
			severity: 'error',
			message: t('panels.code.diagnostic', { line: e.line, message: e.message })
		};
	});
}

interface MermaidState {
	/** Schließende Zeichen eines offenen Labels. */
	close: string | null;
	/** Rest der Zeile ist Text (nach `:`). */
	rest: boolean;
}

const KEYWORDS = new Set(
	(
		'flowchart flowchart-elk graph subgraph end direction click href call style classDef class ' +
		'linkStyle sequenceDiagram participant actor Note note over of left right as loop alt else ' +
		'opt par and critical option break rect activate deactivate autonumber box title create ' +
		'destroy link links accTitle accDescr'
	).split(' ')
);
const ATOMS = new Set(['TB', 'TD', 'BT', 'RL', 'LR']);
const ARROW = /^<{0,2}[-=.~](?:[-=.~>)]|\|(?=[\\/])|[\\/])*/;

/** Mermaid-Hervorhebung für `StreamLanguage.define` (kein Grammatik-Paket nötig). */
export const mermaidStream: StreamParser<MermaidState> = {
	name: 'mermaid',
	startState: () => ({ close: null, rest: false }),
	token(stream, state) {
		if (stream.sol()) state.rest = false;
		if (state.close) {
			const close = state.close;
			if (close.includes(stream.peek() ?? '')) {
				while (!stream.eol() && close.includes(stream.peek() ?? '')) stream.next();
				state.close = null;
				return 'bracket';
			}
			while (!stream.eol() && !close.includes(stream.peek() ?? '')) stream.next();
			return 'string';
		}
		if (stream.eatSpace()) return null;
		if (stream.match('%%')) {
			stream.skipToEnd();
			return 'comment';
		}
		if (state.rest) {
			stream.skipToEnd();
			return 'string';
		}
		const ch = stream.peek() ?? '';
		if (ch === '"') {
			stream.next();
			while (!stream.eol() && stream.next() !== '"');
			return 'string';
		}
		if (ch === '|' || /[[({]/.test(ch)) {
			if (ch === '|') stream.next();
			else stream.match(/^[[({]+/);
			state.close = ch === '|' ? '|' : '])}';
			return 'bracket';
		}
		if (stream.match(ARROW)) {
			if (/[-=.]$/.test(stream.current())) stream.match(/^[xo](?![a-z0-9_])/);
			stream.match(/^[+-]/);
			return 'operator';
		}
		const word = stream.match(/^[\w$]+(?:-elk)?/) as RegExpMatchArray | null;
		if (word) {
			if (KEYWORDS.has(word[0])) return 'keyword';
			return ATOMS.has(word[0]) ? 'atom' : 'variableName';
		}
		stream.next();
		if (ch === ':') state.rest = true;
		return 'punctuation';
	}
};

/** Undo/Redo-Tasten rufen den Command-Stack (D-09), nicht die Editor-Historie. */
export function undoKeymap(sync: { undo(): Promise<void>; redo(): Promise<void> }): KeyBinding[] {
	const run = (fn: () => Promise<void>) => () => {
		void fn();
		return true;
	};
	return [
		{ key: 'Mod-z', run: run(() => sync.undo()), preventDefault: true },
		{ key: 'Mod-y', run: run(() => sync.redo()), preventDefault: true },
		{ key: 'Mod-Shift-z', run: run(() => sync.redo()), preventDefault: true }
	];
}

/** Name des Eingabefelds (V-32) über `contentAttributes`; bei Sprachwechsel neu konfigurieren. */
export function editorLabel(): Extension {
	return EditorView.contentAttributes.of({ 'aria-label': t('panels.code.editor') });
}
