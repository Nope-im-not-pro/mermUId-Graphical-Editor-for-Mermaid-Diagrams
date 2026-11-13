import { describe, expect, it } from 'vitest';
import { initCounters, nextId } from '../../../../src/lib/model/ids';
import { removeNode } from '../../../../src/lib/model/operations';
import type { DiagramDocument, LayoutMeta, Position } from '../../../../src/lib/model/types';
import {
	joinMeta,
	readMeta,
	removeLayoutMeta,
	splitMeta,
	stripMetaLines,
	writeMeta,
	type LoadedMeta,
	type MetaSplit
} from '../../../../src/lib/services/meta';
import { edge, emptyDoc, node } from '../../model/fixtures';

const ABC = [node('A'), node('B'), node('C')];

function docWith(layout: Partial<LayoutMeta>, nodes = ABC): DiagramDocument {
	const base = emptyDoc({ nodes });
	return { ...base, layout: { ...base.layout, ...layout } };
}

/** Simuliert Laden: Zeile lesen, Modus/Positionen ins Modell, Zähler nach D-03. */
function load(text: string, nodes = ABC) {
	const split = splitMeta(text);
	const { loaded, warnings } = readMeta(split.metaLine);
	const doc = docWith(
		{ mode: loaded?.mode ?? 'auto', positions: loaded?.ok ? { ...loaded.positions } : {} },
		nodes
	);
	const counters = initCounters(doc, loaded?.storedIds);
	return { split, loaded, warnings, doc, counters };
}

function save(
	split: MetaSplit,
	loaded: LoadedMeta | null,
	doc: DiagramDocument,
	counters = initCounters(doc, loaded?.storedIds),
	embed = true
) {
	const { metaLine, warnings } = writeMeta({ loaded, doc, counters, embed });
	return { text: joinMeta({ ...split, metaLine }), metaLine, warnings };
}

describe('splitMeta / joinMeta (O-16)', () => {
	const M = '%% @mermuid: {"v":1}';
	const variants = [
		'flowchart LR\n  A --> B\n' + M + '\n',
		'flowchart LR\n  A --> B\n' + M,
		'flowchart LR\r\n  A --> B\r\n' + M + '\r\n',
		'flowchart LR\r\n  A --> B\r\n' + M,
		'flowchart LR\n\n' + M + '\n',
		'flowchart LR\r\n\r\n' + M + '\r\n',
		'flowchart LR\n' + M + '\n\n\n',
		'flowchart LR\r\n' + M + '\r\n\r\n',
		'flowchart LR\n\n\n' + M + '\n\n',
		'\n\n' + M + '\n',
		'\r\n' + M,
		'a\r\n' + M,
		'  %%  @mermuid: {"v":1}\n',
		M,
		M + '\n',
		'',
		'\n',
		'\r\n\r\n',
		'flowchart LR\n  A --> B\n',
		'flowchart LR\r\n  A --> B',
		'flowchart LR\n' + M + '\n  A --> B\n',
		'a\n' + M + '\n  \n',
		'a\n' + M + '\n\t\n',
		'a\n' + M + '\n \t',
		'a\r\n' + M + '\r\n  \r\n',
		'a\r\n' + M + '\r\n\t',
		'a\n' + M + '\n  \n\n\t\n',
		'a\n  \n'
	];

	it.each(variants)('joinMeta(splitMeta(t)) === t: %j', (text) => {
		const split = splitMeta(text);
		expect(joinMeta(split)).toBe(text);
		if (split.metaLine === null || split.inBody) {
			expect(split.body).toBe(text);
		} else {
			expect(split.metaLine).toContain('@mermuid');
			expect(split.body).not.toContain('@mermuid');
		}
	});

	it('Leerzeile vor der Meta-Zeile bleibt erhalten (R1-P1)', () => {
		const split = splitMeta('flowchart\n\n%% @mermuid: {}\n');
		expect(split).toEqual({
			body: 'flowchart\n\n',
			metaLine: '%% @mermuid: {}',
			rest: '\n',
			inBody: false,
			found: [{ line: 3, text: '%% @mermuid: {}' }]
		});
		expect(joinMeta(split)).toBe('flowchart\n\n%% @mermuid: {}\n');
		expect(joinMeta(splitMeta('flowchart\r\n\r\n%% @mermuid: {}\r\n'))).toBe(
			'flowchart\r\n\r\n%% @mermuid: {}\r\n'
		);
	});

	it('CRLF ohne End-Zeilenumbruch bleibt CRLF, auch mit neuer Zeile (R1-P2)', () => {
		const split = splitMeta('a\r\n%% @mermuid: {}');
		expect(joinMeta(split)).toBe('a\r\n%% @mermuid: {}');
		expect(joinMeta({ ...split, metaLine: '%% @mermuid: {"v":1}' })).toBe(
			'a\r\n%% @mermuid: {"v":1}'
		);
	});

	it('Body ohne Zeile, Zeilenende bleibt erhalten', () => {
		expect(splitMeta('flowchart LR\n  A\n%% @mermuid: {}\n')).toEqual({
			body: 'flowchart LR\n  A\n',
			metaLine: '%% @mermuid: {}',
			rest: '\n',
			inBody: false,
			found: [{ line: 3, text: '%% @mermuid: {}' }]
		});
	});

	it('Zeile mitten im Text wird gelesen und bleibt im Body (O-45 löst O-16 ab)', () => {
		const text = 'flowchart LR\n%% @mermuid: {"v":1}\n  A --> B\n';
		expect(splitMeta(text)).toEqual({
			body: text,
			metaLine: '%% @mermuid: {"v":1}',
			rest: '\n',
			inBody: true,
			found: [{ line: 2, text: '%% @mermuid: {"v":1}' }]
		});
		expect(splitMeta('')).toMatchObject({ body: '', metaLine: null, found: [] });
		expect(splitMeta('%% Kommentar\n')).toMatchObject({ body: '%% Kommentar\n', metaLine: null });
	});

	it('mehrere Zeilen: die letzte gilt, alle Fundstellen werden geliefert (O-45)', () => {
		const a = '%% @mermuid: {"v":1,"pos":{"A":[1,1]}}';
		const b = '  %% @mermuid: {"v":1,"pos":{"A":[2,2]}}';
		const mid = splitMeta(`flowchart LR\n${a}\n  A\n${b}\n  B\n`);
		expect(mid).toMatchObject({ metaLine: b, inBody: true });
		expect(mid.found).toEqual([
			{ line: 2, text: a },
			{ line: 4, text: b }
		]);
		const end = splitMeta(`flowchart LR\r\n${a}\r\n  A\r\n${b}\r\n`);
		expect(end).toMatchObject({
			body: `flowchart LR\r\n${a}\r\n  A\r\n`,
			metaLine: b,
			rest: '\r\n',
			inBody: false
		});
		expect(end.found.map((f) => f.line)).toEqual([2, 4]);
	});

	it('joinMeta: unveränderte Zeile bleibt an ihrer Stelle, geänderte steht allein am Ende (O-45)', () => {
		const a = '%% @mermuid: {"v":1}';
		const n = '%% @mermuid: {"v":1,"pos":{}}';
		const mid = splitMeta(`flowchart LR\n${a}\n  A\n`);
		expect(joinMeta(mid)).toBe(`flowchart LR\n${a}\n  A\n`);
		expect(joinMeta({ ...mid, metaLine: n })).toBe(`flowchart LR\n  A\n${n}\n`);
		expect(joinMeta({ ...mid, metaLine: null })).toBe('flowchart LR\n  A\n');
		const two = splitMeta(`flowchart LR\n  ${a}\n  A\n${a}\n`);
		expect(joinMeta(two)).toBe(`flowchart LR\n  ${a}\n  A\n${a}\n`);
		expect(joinMeta({ ...two, metaLine: n })).toBe(`flowchart LR\n  A\n${n}\n`);
		const crlf = splitMeta(`flowchart LR\r\n${a}\r\n  A`);
		expect(joinMeta({ ...crlf, metaLine: n })).toBe(`flowchart LR\r\n  A\r\n${n}`);
	});

	it('stripMetaLines entfernt nur @mermuid-Zeilen samt Zeilenende', () => {
		expect(stripMetaLines('a\n  %% @mermuid: {}\nb\n')).toBe('a\nb\n');
		expect(stripMetaLines('a\r\n%% @mermuid: {}\r\nb')).toBe('a\r\nb');
		expect(stripMetaLines('a\n%% @mermuid: {}')).toBe('a\n');
		expect(stripMetaLines('%% Kommentar\n%%{init: {}}%%\n')).toBe('%% Kommentar\n%%{init: {}}%%\n');
	});

	it('Leerzeichen-/Tab-Zeilen nach der Meta-Zeile gehören zu rest (R2-P3)', () => {
		expect(splitMeta('a\n%% @mermuid: {}\n  \n')).toEqual({
			body: 'a\n',
			metaLine: '%% @mermuid: {}',
			rest: '\n  \n',
			inBody: false,
			found: [{ line: 2, text: '%% @mermuid: {}' }]
		});
		expect(splitMeta('a\r\n%% @mermuid: {}\r\n\t')).toEqual({
			body: 'a\r\n',
			metaLine: '%% @mermuid: {}',
			rest: '\r\n\t',
			inBody: false,
			found: [{ line: 2, text: '%% @mermuid: {}' }]
		});
		expect(splitMeta('a\n%% @mermuid: {}\n  x\n')).toMatchObject({
			metaLine: '%% @mermuid: {}',
			inBody: true
		});
	});

	it('Zeile entfernen: Body bleibt, Rest entfällt', () => {
		const split = splitMeta('x\n  A\n%% @mermuid: {}\n');
		expect(joinMeta({ ...split, metaLine: null })).toBe('x\n  A\n');
		expect(joinMeta({ ...splitMeta('%% @mermuid: {}\n'), metaLine: null })).toBe('');
	});

	it('neue Zeile (vorher keine) mit dem Zeilenende des Dokuments angehängt', () => {
		const add = (text: string) => joinMeta({ ...splitMeta(text), metaLine: '%% @mermuid: {}' });
		expect(add('flowchart LR\n  A\n')).toBe('flowchart LR\n  A\n%% @mermuid: {}\n');
		expect(add('flowchart LR\r\n  A\r\n')).toBe('flowchart LR\r\n  A\r\n%% @mermuid: {}\r\n');
		expect(add('flowchart LR')).toBe('flowchart LR\n%% @mermuid: {}');
		expect(add('a\r\nb')).toBe('a\r\nb\r\n%% @mermuid: {}');
		expect(add('')).toBe('%% @mermuid: {}');
	});
});

/** Laufzeit von `run` in ms. */
function timed(run: () => void): number {
	const t0 = performance.now();
	run();
	return performance.now() - t0;
}

/**
 * Zeitfaktor groß/klein (Vorlage fix-e2): Warmlauf je Größe, 5 Runden im Wechsel (je 4x klein,
 * 1x groß), je Größe das Minimum (filtert Last-Spitzen und GC-Pausen).
 */
function growth(small: () => void, large: () => void): number {
	small();
	large();
	const tSmall: number[] = [];
	const tLarge: number[] = [];
	for (let i = 0; i < 5; i++) {
		for (let k = 0; k < 4; k++) tSmall.push(timed(small));
		tLarge.push(timed(large));
	}
	return Math.min(...tLarge) / Math.min(...tSmall);
}

describe('splitMeta: Laufzeit bei langen Leerraum-Strecken (E1-P2)', () => {
	const M = '%% @mermuid: {"v":1}';
	// Verhältnis statt absoluter Zeit: Die Grenze 50 ms schlug unter Gesamtlast sporadisch fehl
	// (einmal 164 ms gemessen), beide Größen werden aber ähnlich gebremst. 16-fache Länge ergibt
	// linear 16 bis 21, quadratisch etwa 256. Grenze 128 = Exponent 1,75. Eine großzügige
	// Absolutgrenze fände den rein quadratischen Fall über 100k Zeichen (Sekunden) auch, das
	// Verhältnis erkennt zusätzlich Mischformen. `make(n)` baut den Text mit Strecke der Länge n.
	const linear = (make: (n: number) => string, n: number) => {
		const small = make(n / 16);
		const large = make(n);
		const split = splitMeta(large);
		expect(joinMeta(split)).toBe(large);
		expect(
			growth(
				() => splitMeta(small),
				() => splitMeta(large)
			)
		).toBeLessThan(128);
		return split;
	};

	it.each([
		['100k Leerzeilen + Inhalt', '\n', 100000],
		['\\r\\n x50000 + Inhalt', '\r\n', 50000],
		['\\n \\t x33334 + Inhalt', '\n \t', 33334]
	])('%s: 16-fache Länge < 128-fache Zeit', (_name, unit, count) => {
		const ws = (n: number) => unit.repeat(n);
		expect(linear((n) => 'a' + ws(n) + 'x', count).metaLine).toBeNull();
		expect(linear((n) => 'a\n' + M + ws(n), count).metaLine).toBe(M);
		expect(linear((n) => ws(n) + M + ws(n), count).metaLine).toContain(M);
	});

	it('lange Leerzeichen-Strecken in der letzten Zeile: 16-fache Länge < 128-fache Zeit', () => {
		const sp = (n: number) => ' '.repeat(n);
		const n = 100000;
		expect(linear((k) => 'a\n' + sp(k) + 'x', n).metaLine).toBeNull();
		expect(linear((k) => 'a\n%%' + sp(k) + 'x', n).metaLine).toBeNull();
		expect(linear((k) => 'a\n' + sp(k) + '%%' + sp(k) + '@mermuid: {}', n).metaLine).not.toBeNull();
		expect(linear((k) => 'a\n' + M + sp(k), n).metaLine).toBe(M + sp(n));
	});
});

describe('readMeta (tolerant)', () => {
	it('ohne Zeile: kein LoadedMeta, keine Warnung', () => {
		expect(readMeta(null)).toEqual({ loaded: null, warnings: [] });
	});

	it('liest Modus, Positionen, Zähler und hält unbekannte Schlüssel in Lese-Reihenfolge', () => {
		const line =
			'%% @mermuid: {"x":{"b":1,"a":2},"v":1,"layout":"auto","ids":{"n":5,"c":2},"pos":{"A":[1,2,3,4],"B":[5,6]},"y":true}';
		const { loaded, warnings } = readMeta(line);
		expect(warnings).toEqual([]);
		expect(loaded).toEqual({
			raw: line,
			ok: true,
			mode: 'auto',
			storedIds: { n: 5, c: 2 },
			positions: { A: [1, 2, 3, 4], B: [5, 6, 0, 0] },
			extra: [
				['x', { b: 1, a: 2 }],
				['y', true]
			]
		});
	});

	it('fehlender Modus gilt als manual, ungültige Einträge entfallen mit Warnung', () => {
		const { loaded, warnings } = readMeta(
			'%% @mermuid: {"v":1,"ids":7,"pos":{"A":[1,2,3],"B":"x","C":[1,2,3,null],"D":[0,0]}}'
		);
		expect(loaded?.ok).toBe(true);
		expect(loaded?.mode).toBe('manual');
		expect(loaded?.positions).toEqual({ D: [0, 0, 0, 0] });
		expect(loaded?.storedIds).toEqual({});
		expect(warnings.length).toBe(4);
	});

	it('pos kein Objekt -> Warnung, keine Positionen; unbekannte Version -> Warnung', () => {
		const { loaded, warnings } = readMeta('%% @mermuid: {"v":2,"pos":[1]}');
		expect(loaded?.positions).toEqual({});
		expect(warnings).toHaveLength(2);
	});

	it.each(['%% @mermuid: {"v":1,', '%% @mermuid: [1,2]', '%% @mermuid: null', '%% @mermuid:'])(
		'defektes JSON -> Warnung + Auto-Fallback: %j',
		(line) => {
			const { loaded, warnings } = readMeta(line);
			expect(warnings).toHaveLength(1);
			expect(loaded).toMatchObject({ raw: line, ok: false, mode: 'auto', positions: {} });
		}
	);

	it('negative Breite/Höhe ungültig (R1-P3)', () => {
		const { loaded, warnings } = readMeta(
			'%% @mermuid: {"v":1,"pos":{"A":[1,2,-3,4],"B":[1,2,3,-4],"C":[1,2,0,0]}}'
		);
		expect(loaded?.positions).toEqual({ C: [1, 2, 0, 0] });
		expect(warnings).toHaveLength(2);
	});

	it('positions ohne Prototyp: toString/constructor nur als eigene ID (R1-P3)', () => {
		const { loaded } = readMeta('%% @mermuid: {"v":1,"pos":{"constructor":[1,2,3,4]}}');
		expect(loaded?.positions['toString']).toBeUndefined();
		expect(loaded?.positions['constructor']).toEqual([1, 2, 3, 4]);
		expect(readMeta('%% @mermuid: {').loaded?.positions['toString']).toBeUndefined();
	});

	it('Element-ID __proto__ bleibt eigene Eigenschaft', () => {
		const { loaded } = readMeta('%% @mermuid: {"v":1,"pos":{"__proto__":[1,2,3,4]}}');
		expect(Object.keys(loaded?.positions ?? {})).toEqual(['__proto__']);
	});
});

describe('writeMeta: Verify D1 (D-02)', () => {
	it('(1) handformatierte Zeile, öffnen + speichern -> byte-gleich', () => {
		const text =
			'flowchart LR\n  A --> B\n  B --> C\n%%   @mermuid:  { "pos" : { "B":[220,60, 80,40], "A":[40,60,80,40] } ,"layout":"manual", "v":1 , "ids":{"n":1}}\n';
		const { split, loaded, doc } = load(text);
		expect(save(split, loaded, doc).text).toBe(text);
	});

	it('(1b) Zeile mit Zähler und unbekanntem Schlüssel unverändert -> byte-gleich', () => {
		const text =
			'flowchart LR\n%% @mermuid: {"zz":[1, 2],"v":1,"ids":{"n":9},"pos":{"A":[1,2,3,4]}}';
		const { split, loaded, doc } = load(text, [node('A'), node('n3')]);
		expect(save(split, loaded, doc).text).toBe(text);
	});

	it('(2) beim Laden verwaiste ID -> Zeile kanonisch ohne diese ID', () => {
		const text =
			'flowchart LR\n%% @mermuid: {"v":1, "layout":"manual","pos":{"X":[0,0,1,1],"A":[1,2,3,4]}}\n';
		const { split, loaded, doc } = load(text);
		expect(save(split, loaded, doc).text).toBe(
			'flowchart LR\n%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[1,2,3,4]}}\n'
		);
	});

	it('(3) unbekannter Schlüssel bleibt nach Positionsänderung unverändert enthalten', () => {
		const text =
			'flowchart LR\n%% @mermuid: {"x":{"k":[1,{"b":2,"a":1}]},"v":1,"layout":"manual","pos":{"A":[1,2,3,4]},"w":"s"}';
		const { split, loaded, doc } = load(text);
		const moved = { ...doc, layout: { ...doc.layout, positions: { A: [9, 9, 3, 4] as Position } } };
		expect(save(split, loaded, moved as DiagramDocument).metaLine).toBe(
			'%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[9,9,3,4]},"x":{"k":[1,{"b":2,"a":1}]},"w":"s"}'
		);
	});

	it('(4) Datei ohne Zeile, Auto-Layout, speichern -> keine Zeile', () => {
		const text = 'flowchart LR\n  A --> B\n';
		const { split, loaded, doc } = load(text);
		expect(loaded).toBeNull();
		expect(save(split, loaded, doc).text).toBe(text);
	});

	it('(5) defekte Zeile ohne Sitzungs-Positionen -> byte-gleich, Warnung gesetzt', () => {
		const text = 'flowchart LR\n  A\n%% @mermuid: {"v":1,"pos":{\n';
		const { split, loaded, warnings, doc } = load(text);
		expect(warnings).toHaveLength(1);
		expect(doc.layout.mode).toBe('auto');
		const saved = save(split, loaded, doc);
		expect(saved.text).toBe(text);
		expect(saved.warnings).toHaveLength(1);
	});

	it('(5b) defekte Zeile mit Sitzungs-Positionen -> ersetzt + Warnung', () => {
		const text = 'flowchart LR\n  A\n%% @mermuid: {"v":1,"pos":{\n';
		const { split, loaded, doc } = load(text);
		const moved = { ...doc, layout: { ...doc.layout, positions: { A: [1, 2, 3, 4] as Position } } };
		const saved = save(split, loaded, moved as DiagramDocument);
		expect(saved.text).toBe(
			'flowchart LR\n  A\n%% @mermuid: {"v":1,"layout":"auto","pos":{"A":[1,2,3,4]}}\n'
		);
		expect(saved.warnings).toEqual(['Defekte Metadaten-Zeile ersetzt.']);
	});

	it('(6) nur Zähler geändert -> Diff ausschließlich in der Metadaten-Zeile', () => {
		const nodes = [node('A'), node('n1'), node('n2')];
		const text =
			'flowchart LR\n  A\n  n1\n  n2\n%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[1,2,3,4]}}\n';
		const { split, loaded, doc, counters } = load(text, nodes);
		// n3 anlegen und wieder löschen: Text gleich, Zähler weiter
		const created = nextId(counters, 'n');
		expect(created.id).toBe('n3');
		const saved = save(split, loaded, doc, created.counters);
		expect(saved.text).toBe(
			'flowchart LR\n  A\n  n1\n  n2\n%% @mermuid: {"v":1,"layout":"manual","ids":{"n":4},"pos":{"A":[1,2,3,4]}}\n'
		);
		const reloaded = load(saved.text, nodes);
		expect(nextId(reloaded.counters, 'n').id).toBe('n4');
	});
});

describe('writeMeta: Regeln D-02 Auflage e und Schalter', () => {
	it('keine Zeile ohne Positionen; neue Positionen -> kanonische Zeile', () => {
		const doc = docWith({ mode: 'manual', positions: {} });
		expect(save(splitMeta('flowchart LR\n'), null, doc).metaLine).toBeNull();
		const placed = docWith({ mode: 'manual', positions: { B: [1, 2, 3, 4], A: [0, 0, 1, 1] } });
		expect(save(splitMeta('flowchart LR\n'), null, placed).text).toBe(
			'flowchart LR\n%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[0,0,1,1],"B":[1,2,3,4]}}\n'
		);
	});

	it('Zeile auch im Auto-Modus, sobald Positionen existieren', () => {
		const doc = docWith({ mode: 'auto', positions: { A: [1, 2, 3, 4] } });
		expect(save(splitMeta('x'), null, doc).metaLine).toBe(
			'%% @mermuid: {"v":1,"layout":"auto","pos":{"A":[1,2,3,4]}}'
		);
	});

	it('Moduswechsel ist Inhaltsänderung', () => {
		const text = 'x\n%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[1,2,3,4]}}';
		const { split, loaded, doc } = load(text);
		const auto = { ...doc, layout: { ...doc.layout, mode: 'auto' as const } };
		expect(save(split, loaded, auto).metaLine).toBe(
			'%% @mermuid: {"v":1,"layout":"auto","pos":{"A":[1,2,3,4]}}'
		);
	});

	it('Whitespace-Zeilen nach der Zeile: Laden behält Positionen, Speichern ersetzt (R2-P3)', () => {
		for (const tail of ['\n  \n', '\n\t', '\r\n \t\r\n', '\r\n  ']) {
			const text = 'x\n%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[1,2,3,4]}}' + tail;
			const { split, loaded, doc } = load(text);
			expect(doc.layout.positions).toEqual({ A: [1, 2, 3, 4] });
			expect(save(split, loaded, doc).text).toBe(text);
			const moved = {
				...doc,
				layout: { ...doc.layout, positions: { A: [9, 9, 3, 4] as Position } }
			};
			const saved = save(split, loaded, moved as DiagramDocument).text;
			expect(saved).toBe('x\n%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[9,9,3,4]}}' + tail);
			expect(saved.match(/@mermuid/g)).toHaveLength(1);
		}
	});

	it('alle Positionen durch Löschen entfernt -> Zeile entfällt', () => {
		const text = 'x\n  A\n%% @mermuid: {"v":1,"pos":{"A":[1,2,3,4]}}\n';
		const { split, loaded, doc } = load(text, [node('A')]);
		const removed = removeNode(doc, 'A', 'cascade');
		expect(save(split, loaded, removed).text).toBe('x\n  A\n');
	});

	it('Positionen von Kanten und Containern zählen als Element-IDs', () => {
		const doc = {
			...emptyDoc({ nodes: [node('A'), node('B')], edges: [edge('e1', 'A', 'B')] }),
			layout: { ...emptyDoc().layout, positions: { e1: [1, 1, 1, 1] } }
		} as DiagramDocument;
		expect(save(splitMeta('x'), null, doc).metaLine).toContain('"e1"');
	});

	it('Schalter "Layout einbetten" aus -> keine Zeile, auch bei vorhandener Zeile', () => {
		const text = 'x\n%% @mermuid: {"v":1,"pos":{"A":[1,2,3,4]}}\n';
		const { split, loaded, doc, counters } = load(text);
		expect(save(split, loaded, doc, counters, false).text).toBe('x\n');
	});

	it('"Layout-Metadaten entfernen" -> keine Zeile, auch bei defekter Zeile', () => {
		for (const text of ['x\n%% @mermuid: {"v":1,"pos":{"A":[1,2,3,4]}}\n', 'x\n%% @mermuid: {\n']) {
			const { split, loaded, doc } = load(text);
			const cleared = removeLayoutMeta({ layout: doc.layout, loaded });
			expect(cleared.loaded).toBeNull();
			expect(cleared.layout).toEqual({ ...doc.layout, mode: 'auto', positions: {} });
			const next = { ...doc, layout: cleared.layout };
			expect(save(split, cleared.loaded, next).text).toBe('x\n');
		}
	});
});

describe('writeMeta: ungültige Positionen (R1-P3)', () => {
	it('NaN, Infinity und negative w/h werden nicht geschrieben', () => {
		const doc = docWith({
			mode: 'manual',
			positions: {
				A: [NaN, 0, 1, 1],
				B: [0, Infinity, 1, 1],
				C: [0, 0, -1, 1]
			}
		});
		expect(save(splitMeta('x'), null, doc).metaLine).toBeNull();
		const mixed = docWith({
			mode: 'manual',
			positions: { A: [1, 2, 3, 4], B: [0, 0, 1, -Infinity] }
		});
		expect(save(splitMeta('x'), null, mixed).metaLine).toBe(
			'%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[1,2,3,4]}}'
		);
	});
});

describe('Zähler D-03 über die Zeile (Verify D2)', () => {
	it('(1) Zeile mit Zähler 5, IDs n1..n3 -> nächste ID n5', () => {
		const nodes = [node('n1'), node('n2'), node('n3')];
		const { counters } = load(
			'x\n%% @mermuid: {"v":1,"ids":{"n":5},"pos":{"n1":[0,0,1,1]}}',
			nodes
		);
		expect(nextId(counters, 'n').id).toBe('n5');
	});

	it('(2) Zeile mit Zähler 2, Nutzer-ID n9 im Code -> nächste ID n10', () => {
		const nodes = [node('n1'), node('n9')];
		const { counters } = load(
			'x\n%% @mermuid: {"v":1,"ids":{"n":2},"pos":{"n1":[0,0,1,1]}}',
			nodes
		);
		expect(nextId(counters, 'n').id).toBe('n10');
	});

	it('Zähler wird nur geschrieben, wenn die Zeile ohnehin existiert', () => {
		const doc = docWith({ positions: {} }, [node('n1')]);
		const counters = { n: 7, e: 3, c: 1 };
		expect(writeMeta({ loaded: null, doc, counters, embed: true }).metaLine).toBeNull();
		const placed = docWith({ mode: 'manual', positions: { n1: [0, 0, 1, 1] } }, [node('n1')]);
		expect(writeMeta({ loaded: null, doc: placed, counters, embed: true }).metaLine).toBe(
			'%% @mermuid: {"v":1,"layout":"manual","ids":{"n":7,"e":3},"pos":{"n1":[0,0,1,1]}}'
		);
	});

	it('(4) ohne Zeile: n3 löschen, neu laden -> neues n3 ohne frühere Position', () => {
		const nodes = [node('n1'), node('n2'), node('n3')];
		const { split, loaded, doc } = load('flowchart LR\n  n1\n  n2\n  n3\n', nodes);
		const removed = removeNode(doc, 'n3', 'cascade');
		const saved = save(split, loaded, removed);
		expect(saved.metaLine).toBeNull();
		const reloaded = load(saved.text, [node('n1'), node('n2')]);
		const created = nextId(reloaded.counters, 'n');
		expect(created.id).toBe('n3');
		expect(reloaded.doc.layout.positions[created.id]).toBeUndefined();
	});
});
