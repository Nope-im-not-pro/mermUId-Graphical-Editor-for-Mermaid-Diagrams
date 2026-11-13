// @vitest-environment node
/**
 * Heap-Test der Undo-Historie (T120, V-27, D-09): 200 Undo-Schritte bei einem Dokument mit
 * 200000 Zeichen müssen unter 100 MB Heap bleiben. Gemessen über die echte API
 * (`createSync` -> Command-Store -> History), also inklusive Snapshot-Code und
 * `structuredClone` je `codeApply`. Jeder Schritt verändert das Dokument, damit kein Eintrag
 * als "keine Änderung" verworfen wird (V-13/T107).
 *
 * Ergebnis W26 (Node 22, 1000 Knoten, 200000 Zeichen): Code-Schritte ~342 MB (gerissen),
 * Grafik-Schritte ~81 MB. Ursache: der Parse teilte nichts mit dem Vormodell (M-11).
 *
 * Ergebnis W27/T142 C2 (strukturelles Teilen per `shareUnchanged` im Store, O-121): Label
 * ~44 MB, oben eingefügte Kantenzeile ~94 MB; Sonde 7000 kurze Knoten: Einfügung hochgerechnet
 * ~386 MB -> Rückfall E (D1 Auflage 10).
 *
 * Ergebnis W27/T142 C3, Rückfall E (Code-Einträge halten statt des Modells nur den Volltext,
 * Undo/Redo parsen neu): Code-Schritte (Label) ~40 MB, Code-Schritte mit oben eingefügter
 * Kantenzeile ~41 MB (fast nur Volltext-Snapshots), Grafik-Schritte ~81 MB (unverändert).
 * Undo-Latenz (Ausgabe): Code-Schritt ~40-52 ms (= Parse), Grafik-Schritt < 1 ms.
 * `shareUnchanged` kostet ~19 % der Parse-Zeit (CPU-Ausgabe).
 * Sonde außerhalb der Suite (7000 kurze Knoten, ~172000 Zeichen, 60 Schritte, auf 200
 * hochgerechnet): Label ~38 MB (C2: ~60 MB, W26: ~1,5 GB), Kanten-Einfügung oben ~45 MB
 * (C2: ~386 MB); Undo je Code-Schritt ~190-280 ms.
 * Konfliktpfad (C3 I2, Sonde außerhalb der Suite: 7000 kurze Knoten, Konflikt, 60 Code-Schritte,
 * auf 200 hochgerechnet): Snapshots halten statt des Kandidaten-Modells nur `hasCandidate`,
 * Undo/Redo parsen ihn aus `code` neu. Kanten-Einfügung oben ~47 MB (I1: ~269 MB), Label
 * ~44 MB (I1: ~51 MB).
 *
 * Aufbau je Pfad: Szenario in `beforeAll` (Fehler dort macht die Suite rot), Vorbedingungen in
 * einem eigenen `it`, die Heap-Assertion separat.
 * Zeitbudget 90 s statt 30 s: unter Parallel-Last dauerte der Code-Pfad bis 34 s.
 */
import { setFlagsFromString } from 'node:v8';
import { runInNewContext } from 'node:vm';
import { get } from 'svelte/store';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
	createSync,
	type SyncController,
	type SyncTimer
} from '../../../../src/lib/controllers/sync';
import { shareUnchanged } from '../../../../src/lib/model/share';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import { flowchartAdapter } from '../../../../src/lib/services/adapters/flowchart';
import { fakeAdapters, rename } from '../sync/helpers';

const DOC_CHARS = 200_000;
const STEPS = 200;
const LIMIT_MB = 100;
const MB = 1024 * 1024;
const TIMEOUT_MS = 90_000;

/** Kein echter Timer: Parse läuft ausschließlich über `flush()`. */
const manualTimer: SyncTimer = { set: () => 0, clear: () => {} };

/**
 * Echte V8-Garbage-Collection. `--expose-gc` lässt sich zur Laufzeit setzen; die Funktion
 * `gc` existiert danach nur in einem neu erzeugten Kontext.
 */
function obtainGc(): (() => void) | null {
	const existing = (globalThis as { gc?: () => void }).gc;
	if (typeof existing === 'function') return existing;
	setFlagsFromString('--expose-gc');
	const gc = runInNewContext('typeof gc === "function" ? gc : null') as (() => void) | null;
	return gc;
}

const gc = obtainGc();

function heapUsed(): number {
	if (gc) {
		gc();
		gc();
	}
	return process.memoryUsage().heapUsed;
}

/**
 * Knotenzahl des Testdokuments. 200000 Zeichen mit kurzen Labels ergäben ~7000 Knoten; ein
 * Parse-Schritt dauert dann > 0,5 s und 200 Schritte sprengen das Test-Zeitbudget. Lange
 * Labels (~200 Zeichen je Zeile) halten den Volltext bei 200000 Zeichen.
 */
const NODES = 1000;

/** Flowchart mit mindestens `DOC_CHARS` Zeichen: `NODES` verkettete Knoten mit langem Label. */
function bigFlowchart(): string {
	const head = 'flowchart TD\n';
	const pad = 'x'.repeat(Math.ceil((DOC_CHARS - head.length) / NODES) - 25);
	const lines = Array.from(
		{ length: NODES },
		(_, i) => `  n${i}[Knoten ${i} ${pad}] --> n${i + 1}`
	);
	return head + lines.join('\n') + '\n';
}

/** Messergebnis eines Szenarios; Undo-Zählung erst nach der Heap-Messung. */
interface Outcome {
	deltaMb: number;
	label: string;
	edges: number;
	codeLength: number;
	undoSteps: number;
}

/**
 * Misst den Heap-Zuwachs über `run` und zählt danach die verfügbaren Undo-Schritte
 * (`canUndo`-Schleife, Grenze `UNDO_DEPTH` in history.ts). Die Baseline enthält den Testtext
 * (~0,2 MB) und liegt vor `createSync`: das Startmodell (~1-2 MB) zählt zum Zuwachs, der
 * Messwert ist also konservativ.
 */
async function measure(
	name: string,
	run: (sync: SyncController) => Promise<void>,
	track: (sync: SyncController) => void
): Promise<Outcome> {
	const text = bigFlowchart();
	const before = heapUsed();
	const sync = await createSync(text, { adapters: fakeAdapters, timer: manualTimer });
	track(sync);
	await run(sync);
	const deltaMb = (heapUsed() - before) / MB;
	console.info(`T120 ${name}: Heap-Zuwachs ${deltaMb.toFixed(1)} MB`);
	const { nodes, edges } = get(sync.commands).doc;
	const label = nodes[STEPS - 1].label;
	const codeLength = get(sync).code.length;
	let undoSteps = 0;
	const t = performance.now();
	while (get(sync.commands).canUndo && undoSteps <= STEPS) {
		await sync.undo();
		undoSteps++;
	}
	// Latenz je Undo (Rückfall E: Code-Schritt = Re-Parse); nur Ausgabe, keine Zeit-Assertion.
	const undoMs = (performance.now() - t) / Math.max(undoSteps, 1);
	console.info(`T142 ${name}: Undo ${undoMs.toFixed(1)} ms je Schritt (${NODES} Knoten)`);
	return { deltaMb, label, edges: edges.length, codeLength, undoSteps };
}

describe('Heap der Undo-Historie (D-09)', () => {
	it('gc ist verfügbar (sonst wäre die Messung unzuverlässig)', () => {
		expect(gc).toBeTypeOf('function');
	});

	describe(`${STEPS} Code-Schritte bei ${DOC_CHARS} Zeichen`, () => {
		let sync: SyncController | undefined;
		let outcome: Outcome;

		beforeAll(async () => {
			outcome = await measure(
				'Code-Schritte',
				async (s) => {
					let code = get(s).code;
					for (let step = 0; step < STEPS; step++) {
						// Ein Label je Schritt ändern: neuer Volltext, neues Modell.
						code = code.replace(`[Knoten ${step} `, `[Knoten ${step} v `);
						s.editCode(code);
						await s.flush();
					}
				},
				(s) => (sync = s)
			);
		}, TIMEOUT_MS);

		afterAll(() => sync?.dispose());

		it('Vorbedingungen: alle Schritte angewandt, Volltext, Undo-Tiefe', () => {
			expect(outcome.label).toMatch(/^Knoten 199 v /);
			expect(outcome.codeLength).toBeGreaterThanOrEqual(DOC_CHARS);
			expect(outcome.undoSteps).toBe(STEPS);
		});

		it(`Heap bleibt unter ${LIMIT_MB} MB`, () => {
			const { deltaMb } = outcome;
			expect(Number.isFinite(deltaMb)).toBe(true);
			expect(deltaMb, `delta=${deltaMb.toFixed(1)} MB`).toBeLessThan(LIMIT_MB);
		});
	});

	describe(`${STEPS} Code-Schritte mit oben eingefügter Kantenzeile bei ${DOC_CHARS} Zeichen`, () => {
		let sync: SyncController | undefined;
		let outcome: Outcome;

		beforeAll(async () => {
			outcome = await measure(
				'Code-Schritte Einfügung',
				async (s) => {
					let code = get(s).code;
					for (let step = 0; step < STEPS; step++) {
						// Neue Kante direkt nach der Kopfzeile: alle Folgekanten verschieben sich.
						code = code.replace('flowchart TD\n', `flowchart TD\n  n${step} --> n${step + 2}\n`);
						s.editCode(code);
						await s.flush();
					}
				},
				(s) => (sync = s)
			);
		}, TIMEOUT_MS);

		afterAll(() => sync?.dispose());

		it('Vorbedingungen: alle Schritte angewandt, Volltext, Undo-Tiefe', () => {
			expect(outcome.edges).toBe(NODES + STEPS);
			expect(outcome.codeLength).toBeGreaterThanOrEqual(DOC_CHARS);
			expect(outcome.undoSteps).toBe(STEPS);
		});

		it(`Heap bleibt unter ${LIMIT_MB} MB`, () => {
			const { deltaMb } = outcome;
			expect(Number.isFinite(deltaMb)).toBe(true);
			expect(deltaMb, `delta=${deltaMb.toFixed(1)} MB`).toBeLessThan(LIMIT_MB);
		});
	});

	it('CPU: shareUnchanged gegenüber Parse-Zeit (nur Ausgabe, keine Zeit-Assertion)', () => {
		const parse = (text: string): DiagramDocument => {
			const result = flowchartAdapter.parse(text);
			if (!result.ok) throw new Error('Parse fehlgeschlagen');
			return result.doc;
		};
		const text = bigFlowchart();
		const prev = parse(text);
		const variants = {
			Label: text.replace('[Knoten 7 ', '[Knoten 7 v '),
			Einfügung: text.replace('flowchart TD\n', 'flowchart TD\n  n0 --> n2\n')
		};
		for (const [name, variant] of Object.entries(variants)) {
			let t = performance.now();
			const next = parse(variant);
			const parseMs = performance.now() - t;
			t = performance.now();
			const shared = shareUnchanged(prev, next);
			const shareMs = performance.now() - t;
			console.info(
				`T142 CPU ${name} (${NODES} Knoten): Parse ${parseMs.toFixed(1)} ms, shareUnchanged ${shareMs.toFixed(1)} ms (${((100 * shareMs) / parseMs).toFixed(0)} %)`
			);
			expect(shared).toStrictEqual(next);
		}
	});

	describe(`${STEPS} Grafik-Schritte bei ${DOC_CHARS} Zeichen`, () => {
		let sync: SyncController | undefined;
		let outcome: Outcome;

		beforeAll(async () => {
			outcome = await measure(
				'Grafik-Schritte',
				async (s) => {
					const { nodes } = get(s.commands).doc;
					const ids = nodes.map((n) => n.id);
					const labels = nodes.map((n) => n.label);
					for (let step = 0; step < STEPS; step++) {
						// Label verlängern statt ersetzen, damit der serialisierte Code nicht schrumpft.
						await s.execute(rename(ids[step], `${labels[step]} v`));
					}
				},
				(s) => (sync = s)
			);
		}, TIMEOUT_MS);

		afterAll(() => sync?.dispose());

		it('Vorbedingungen: alle Schritte angewandt, Volltext, Undo-Tiefe', () => {
			expect(outcome.label).toMatch(/^Knoten 199 x+ v$/);
			expect(outcome.codeLength).toBeGreaterThanOrEqual(DOC_CHARS);
			expect(outcome.undoSteps).toBe(STEPS);
		});

		it(`Heap bleibt unter ${LIMIT_MB} MB`, () => {
			const { deltaMb } = outcome;
			expect(deltaMb, `delta=${deltaMb.toFixed(1)} MB`).toBeLessThan(LIMIT_MB);
		});
	});
});
