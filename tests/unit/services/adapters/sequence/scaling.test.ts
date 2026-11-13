import { describe, expect, it } from 'vitest';
import { parse, serialize } from '../../../../../src/lib/services/adapters/sequence';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function ok(text: string): DiagramDocument {
	const result = parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

/** Dokument mit `n` Nachrichten; jede achte in einem Block, dazu Kommentare, Notizen, RawBlocks. */
function generated(n: number, eol = '\n'): string {
	const lines = ['sequenceDiagram', '    participant A', '    participant B'];
	for (let i = 0; i < n; i++) {
		if (i % 8 === 0) lines.push(`    loop Runde ${i}`);
		lines.push(`    ${i % 2 ? 'A->>B' : 'B-->>A'}: Nachricht ${i} #${i};`);
		if (i % 8 === 3) lines.push(`    %% Kommentar ${i}`);
		if (i % 8 === 5) lines.push(`    Note over A,B: Notiz ${i}`);
		if (i % 8 === 6) lines.push(`    A->>B: a; B->>A: b ${i}`);
		if (i % 8 === 7) lines.push('    end');
	}
	if (n % 8) lines.push('    end');
	return lines.join(eol) + eol;
}

/** Kopie ohne Rohtext an Knoten, Kanten und Blöcken: Serializer schreibt sie kanonisch. */
function canonical(doc: DiagramDocument): DiagramDocument {
	const copy = structuredClone(doc);
	for (const el of [...copy.nodes, ...copy.edges, ...copy.containers]) el.sourceText = '';
	for (const c of copy.containers) {
		c.props.sourceSections = [];
		c.props.sourceEnd = '';
	}
	return copy;
}

/**
 * CPU-Zeit des Testprozesses (user + system) in ms: Wartezeit auf den Scheduler unter Last zählt
 * nicht mit, anders als bei `performance.now()`.
 */
function timed(run: () => void): number {
	const t0 = process.cpuUsage();
	run();
	const { user, system } = process.cpuUsage(t0);
	return (user + system) / 1000;
}

/**
 * Minimum je Größe aus `rounds` abwechselnden Läufen nach Warmlauf: Last-Spitzen und GC-Pausen
 * treffen beide Größen gleich, das Minimum filtert sie.
 */
function minima(small: () => void, large: () => void, rounds = 10): [number, number] {
	small();
	large();
	let tSmall = Infinity;
	let tLarge = Infinity;
	for (let i = 0; i < rounds; i++) {
		tSmall = Math.min(tSmall, timed(small));
		tLarge = Math.min(tLarge, timed(large));
	}
	return [tSmall, tLarge];
}

/**
 * Vierfache Größe: linear Faktor 4, quadratisch 16 (vor V-29 Faktor 40 bis 56). Unter hoher
 * Rechnerlast bleibt eine Restverzerrung, daher `retry` in den Skalierungs-Tests.
 */
function expectLinear([tSmall, tLarge]: [number, number]) {
	expect(tLarge, `klein: ${tSmall.toFixed(2)} ms, groß: ${tLarge.toFixed(2)} ms`).toBeLessThan(
		10 * tSmall + 5
	);
}

describe('V-29: Serializer skaliert linear', () => {
	it.each([
		['Rohtext', (doc: DiagramDocument) => doc],
		['kanonisch', canonical]
	])(
		'%s: 5000 Nachrichten < 10 x Zeit für 1250 plus 5 ms',
		{ timeout: 60000, retry: 2 },
		(_, prepare) => {
			const small = prepare(ok(generated(1250)));
			const large = prepare(ok(generated(5000)));
			expectLinear(
				minima(
					() => serialize(small),
					() => serialize(large)
				)
			);
		}
	);
});

describe('V-29: Parser skaliert linear', () => {
	// Suche nach dem Blockende lief je Direktive/`accDescr {` ab Zeile 0 (quadratisch). Dokument fast
	// nur aus solchen Zeilen, damit die Suche die Laufzeit bestimmt.
	it.each([
		// Je Direktive kostet die Suche ab 0 die Zeilenzahl davor; 20000 Zeilen genügen dafür.
		['Direktiven', '    %%{init: {}}%%\n', 5000],
		['accDescr-Blöcke', '    accDescr {\n    }\n', 10000]
	])(
		'%s: vierfache Zeilenzahl < 10 x Zeit plus 5 ms',
		{ timeout: 60000, retry: 2 },
		(_, extra, n) => {
			const text = (count: number) => 'sequenceDiagram\n    A->>B: m\n' + extra.repeat(count);
			const small = text(n);
			const large = text(4 * n);
			const doc = parse(large);
			expect(doc.ok && doc.doc.rawBlocks.length).toBe(4 * n);
			expectLinear(
				minima(
					() => parse(small),
					() => parse(large)
				)
			);
		}
	);
});

describe('erzeugte Dokumente', () => {
	it.each(['\n', '\r\n'])('Roundtrip mit Zeilenende %j ist byte-gleich', (eol) => {
		const text = generated(203, eol);
		const doc = ok(text);
		expect(doc.rawBlocks.length).toBeGreaterThan(0);
		expect(doc.comments.length).toBeGreaterThan(0);
		expect(doc.nodes.some((n) => n.kind === 'note')).toBe(true);
		expect(doc.containers.length).toBeGreaterThan(0);
		expect(serialize(doc)).toBe(text);
	});
});
