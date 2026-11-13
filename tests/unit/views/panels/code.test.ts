import { StringStream } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
	changesFor,
	editorLabel,
	lineDiff,
	lineRange,
	mapCursor,
	mermaidStream,
	toDiagnostics,
	undoKeymap
} from '../../../../src/lib/views/panels/code';
import { applyLocale } from '../../../../src/lib/views/shell/i18n.svelte';

/** Wendet Änderungen (Offsets im alten Text, aufsteigend) an. */
function applyChanges(text: string, changes: { from: number; to: number; insert: string }[]) {
	let out = '';
	let pos = 0;
	for (const c of changes) {
		out += text.slice(pos, c.from) + c.insert;
		pos = c.to;
	}
	return out + text.slice(pos);
}

describe('lineDiff', () => {
	it('gleiche, gelöschte und neue Zeilen', () => {
		const rows = lineDiff('a\nb\nc\nd', 'a\nx\nc\nd\ne');
		expect(rows).toEqual([
			{ type: 'same', text: 'a' },
			{ type: 'del', text: 'b' },
			{ type: 'add', text: 'x' },
			{ type: 'same', text: 'c' },
			{ type: 'same', text: 'd' },
			{ type: 'add', text: 'e' }
		]);
	});

	it('Randfälle', () => {
		expect(lineDiff('', '')).toEqual([{ type: 'same', text: '' }]);
		expect(lineDiff('a', 'a')).toEqual([{ type: 'same', text: 'a' }]);
		expect(lineDiff('a\nb', 'b')).toEqual([
			{ type: 'del', text: 'a' },
			{ type: 'same', text: 'b' }
		]);
		expect(lineDiff('a\r\nb', 'a\nb').every((r) => r.type === 'same')).toBe(true);
	});

	it('Ergebnis ist minimal und rekonstruiert beide Texte', () => {
		const a = 'x\ny\nz\nx\ny\nq\n';
		const b = 'y\nz\nq\nx\nx\ny\n';
		const rows = lineDiff(a, b);
		const pick = (t: string) =>
			rows
				.filter((r) => r.type === 'same' || r.type === t)
				.map((r) => r.text)
				.join('\n');
		expect(pick('del')).toBe(a);
		expect(pick('add')).toBe(b);
		expect(rows.filter((r) => r.type !== 'same')).toHaveLength(4);
	});

	it('Obergrenze D fällt auf Ersetzen zurück', () => {
		const a = Array.from({ length: 50 }, (_, i) => `a${i}`).join('\n');
		const b = Array.from({ length: 50 }, (_, i) => `b${i}`).join('\n');
		const rows = lineDiff(a, b, 10);
		expect(rows.filter((r) => r.type === 'del')).toHaveLength(50);
		expect(rows.filter((r) => r.type === 'add')).toHaveLength(50);
		expect(rows[0].type).toBe('del');
	});
});

describe('changesFor und mapCursor', () => {
	const before = 'flowchart TD\n  A --> B\n  B --> C\n  C --> D\n';
	const after = 'flowchart TD\n  A --> B\n    B --> X\n  C --> D\n  D --> E\n';

	it('Änderungen überführen alt in neu', () => {
		const changes = changesFor(before, after);
		expect(applyChanges(before, changes)).toBe(after);
		expect(changes[0].from).toBe(before.indexOf('  B --> C'));
		expect(changesFor(before, before)).toEqual([]);
		expect(applyChanges('', changesFor('', 'a\nb'))).toBe('a\nb');
		expect(applyChanges('a\nb\n', changesFor('a\nb\n', ''))).toBe('');
		expect(applyChanges('a\r\nb', changesFor('a\r\nb', 'a\r\nc'))).toBe('a\r\nc');
	});

	it('Cursor bleibt in Zeile und Spalte', () => {
		const inA = before.indexOf('A -->') + 2;
		expect(mapCursor(before, after, inA)).toBe(after.indexOf('A -->') + 2);
		const inC = before.indexOf('C --> D') + 3;
		expect(mapCursor(before, after, inC)).toBe(after.indexOf('C --> D') + 3);
		const inChanged = before.indexOf('  B --> C') + 4;
		expect(mapCursor(before, after, inChanged)).toBe(after.indexOf('    B --> X') + 4);
		expect(mapCursor(before, after, before.length)).toBe(after.length);
		expect(mapCursor('a\nlang\n', 'a\nx\n', 6)).toBe(3);
		expect(mapCursor('a\nb\nc', 'c', 2)).toBe(0);
		expect(mapCursor('abc', 'abc', 99)).toBe(3);
	});
});

describe('Diagnosen', () => {
	const text = 'flowchart TD\n  A --> \n  B';
	it('Zeile/Spalte zu Bereich', () => {
		expect(lineRange(text, 2)).toEqual({ from: 13, to: 21 });
		expect(lineRange(text, 99)).toEqual({ from: 22, to: 25 });
		expect(lineRange(text, 0)).toEqual({ from: 0, to: 12 });
		const [d] = toDiagnostics(text, [{ line: 2, column: 3, message: 'kaputt' }]);
		expect(d).toEqual({ from: 15, to: 21, severity: 'error', message: 'Zeile 2: kaputt' });
		const [e] = toDiagnostics(text, [{ line: 3, column: 50, message: 'x' }]);
		expect(e.from).toBe(e.to);
		expect(e.from).toBe(25);
	});
});

describe('mermaidStream', () => {
	function tokens(line: string) {
		const state = mermaidStream.startState!(2);
		const stream = new StringStream(line, 2, 2);
		const out: [string, string | null][] = [];
		while (!stream.eol()) {
			const style = mermaidStream.token(stream, state);
			out.push([stream.current(), style]);
			stream.start = stream.pos;
		}
		return out.filter(([t]) => t.trim());
	}

	it('Schlüsselwörter, Pfeile, Texte, Kommentare', () => {
		expect(tokens('flowchart TD')).toEqual([
			['flowchart', 'keyword'],
			['TD', 'atom']
		]);
		expect(tokens('A[Start] -->|ja| B')).toEqual([
			['A', 'variableName'],
			['[', 'bracket'],
			['Start', 'string'],
			[']', 'bracket'],
			['-->', 'operator'],
			['|', 'bracket'],
			['ja', 'string'],
			['|', 'bracket'],
			['B', 'variableName']
		]);
		expect(tokens('%% Kommentar')).toEqual([['%% Kommentar', 'comment']]);
		expect(tokens('A->>+B: Hallo')).toEqual([
			['A', 'variableName'],
			['->>+', 'operator'],
			['B', 'variableName'],
			[':', 'punctuation'],
			['Hallo', 'string']
		]);
		expect(tokens('click A "https://x"')).toEqual([
			['click', 'keyword'],
			['A', 'variableName'],
			['"https://x"', 'string']
		]);
		expect(tokens('style A fill:#f00')[2]).toEqual(['fill', 'variableName']);
		expect(tokens('"offen')).toEqual([['"offen', 'string']]);
		expect(tokens('A ; B')[1]).toEqual([';', 'punctuation']);
	});

	it('Label über mehrere Zeilen bleibt Text', () => {
		const state = mermaidStream.startState!(2);
		const s1 = new StringStream('A[Anfang', 2, 2);
		mermaidStream.token(s1, state);
		s1.start = s1.pos;
		mermaidStream.token(s1, state);
		s1.start = s1.pos;
		expect(mermaidStream.token(s1, state)).toBe('string');
		const s2 = new StringStream('Ende] --> B', 2, 2);
		expect(mermaidStream.token(s2, state)).toBe('string');
		expect(s2.current()).toBe('Ende');
	});
});

describe('undoKeymap', () => {
	it('ruft undo/redo des Sync-Controllers', () => {
		const sync = { undo: vi.fn(() => Promise.resolve()), redo: vi.fn(() => Promise.resolve()) };
		const map = undoKeymap(sync);
		expect(map.map((k) => k.key)).toEqual(['Mod-z', 'Mod-y', 'Mod-Shift-z']);
		for (const k of map) expect(k.run!({} as never)).toBe(true);
		expect(sync.undo).toHaveBeenCalledTimes(1);
		expect(sync.redo).toHaveBeenCalledTimes(2);
	});
});

describe('editorLabel (V-32, T125)', () => {
	afterEach(() => applyLocale('de'));

	const attrs = (state: EditorState) =>
		Object.assign({}, ...state.facet(EditorView.contentAttributes).map((a) => a));

	it('setzt aria-label über contentAttributes, je Sprache', () => {
		expect(attrs(EditorState.create({ extensions: editorLabel() }))['aria-label']).toBe(
			'Mermaid-Quelltext'
		);
		applyLocale('en');
		expect(attrs(EditorState.create({ extensions: editorLabel() }))['aria-label']).toBe(
			'Mermaid source code'
		);
	});
});
