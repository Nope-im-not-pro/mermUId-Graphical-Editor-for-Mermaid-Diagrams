/**
 * Command-Stack mit Undo/Redo (D-09). Reiner Zustand ohne Svelte; Store-Anbindung in `store.ts`.
 *
 * Snapshot-Ansatz statt Inverser Operationen: Die T05-Operationen sind rein und teilen
 * unveränderte Teile strukturell. Ein Eintrag hält daher nur die Referenzen auf Vor- und
 * Nachzustand (kein Deep-Copy, D-09 c). Code-Einträge (T142, Rückfall E): ist ein Zustand der
 * Parse eines bekannten Code-Texts (`History.source`), hält der Eintrag statt des Modells nur
 * diesen Volltext (`beforeSource`/`afterSource`, dasselbe String-Objekt wie im Sync-Snapshot);
 * Undo/Redo bauen das Modell über die übergebene `Rebuild`-Funktion neu (Re-Parse im Sync).
 * Das gilt für `codeApply` mit Quelltext und für Einträge ohne Modelländerung; Grafik-Einträge
 * bleiben Referenz-Wiederherstellung.
 * Tiefe `UNDO_DEPTH` = 200 (D-09). Inverse Operationen müssten `order`, `memberIds`,
 * `sourceText` und Positionen nach Löschungen exakt rekonstruieren; der Snapshot liefert das
 * ohne Sonderfälle (FA-06). `do` eines Commands läuft über die T05-Operationen, `undo`
 * stellt den Vorzustand wieder her, `redo` den Nachzustand.
 *
 * Der ID-Zähler (D-03) liegt in `History`, wird aber von undo/redo nie verändert.
 */
import { initCounters, nextId, type IdCounters, type IdPrefix } from '../../model/ids';
import { sameValue } from '../../model/operations';
import type { DiagramDocument } from '../../model/types';

export const UNDO_DEPTH = 200;

export interface CommandContext {
	/** Vergibt eine neue Editor-ID; der Zähler läuft monoton weiter. */
	newId(prefix: IdPrefix): string;
}

export interface Command {
	readonly label: string;
	do(doc: DiagramDocument, ctx: CommandContext): DiagramDocument;
}

/**
 * Je Seite genau eines: Modell-Referenz oder Code-Text, dessen Parse das Modell ist (T142 E).
 */
export interface HistoryEntry {
	readonly label: string;
	readonly before?: DiagramDocument;
	readonly after?: DiagramDocument;
	readonly beforeSource?: string;
	readonly afterSource?: string;
	/** Beliebige Zusatzdaten, z. B. ein Text-ChangeSet (T19). */
	readonly payload?: unknown;
}

export interface History {
	readonly doc: DiagramDocument;
	readonly past: readonly HistoryEntry[];
	readonly future: readonly HistoryEntry[];
	/** Nicht Teil des Undo-Zustands (D-03). */
	readonly counters: IdCounters;
	/** Code-Text, dessen Parse `doc` ist; `null`, wenn unbekannt (z. B. nach Grafik-Command). */
	readonly source: string | null;
}

/** Baut das Modell eines Code-Texts neu (Re-Parse); liefert im Fehlerfall den aktuellen Stand. */
export type Rebuild = (source: string) => DiagramDocument;

export function createHistory(
	doc: DiagramDocument,
	counters: IdCounters = initCounters(doc),
	source: string | null = null
): History {
	return { doc, past: [], future: [], counters, source };
}

/**
 * Wendet `command` an; bei Fehler bleibt `h` unverändert (inklusive Zähler). Ohne Payload und
 * ohne strukturelle Änderung (`sameDocument`) entsteht kein Undo-Schritt; nur ein verbrauchter
 * ID-Zähler wird übernommen (D-03, monoton) (V-13). Ein Payload kann eine Änderung außerhalb
 * des Modells tragen (z. B. Code-Edit) und wird daher immer abgelegt.
 */
export function execute(h: History, command: Command, payload?: unknown): History {
	let counters = h.counters;
	const ctx: CommandContext = {
		newId(prefix) {
			const next = nextId(counters, prefix);
			counters = next.counters;
			return next.id;
		}
	};
	const after = command.do(h.doc, ctx);
	if (payload === undefined && sameDocument(h.doc, after)) {
		return counters === h.counters ? h : { ...h, counters };
	}
	if (after === h.doc && h.source !== null) {
		const source = h.source;
		return push(
			{ ...h, counters },
			{ label: command.label, beforeSource: source, afterSource: source, payload },
			after
		);
	}
	const source = after === h.doc ? h.source : null;
	return push({ ...h, counters, source }, { label: command.label, before: h.doc, after, payload });
}

/** Strukturell gleich bis auf `modelVersion`. */
export function sameDocument(a: DiagramDocument, b: DiagramDocument): boolean {
	return a === b || sameValue({ ...a, modelVersion: 0 }, { ...b, modelVersion: 0 });
}

/**
 * Legt einen Eintrag ab, verwirft den ältesten über `UNDO_DEPTH` und leert den Redo-Stack.
 * `doc`: neuer Stand, Pflicht bei Einträgen ohne `after`-Modell.
 */
export function push(h: History, entry: HistoryEntry, doc = entry.after): History {
	if (!doc) throw new Error('push: Stand fehlt');
	return {
		...h,
		doc,
		past: [...h.past, entry].slice(-UNDO_DEPTH),
		future: []
	};
}

/**
 * Stand einer Eintragsseite: Modell-Referenz, sonst der aktuelle Stand bei gleichem Code-Text,
 * sonst `rebuild`. Liefert `rebuild` den aktuellen Stand, bleibt dessen Quelltext: bei Fehler,
 * und ebenso bei erfolgreichem Re-Parse wertgleich zum aktuellen Stand (der Store teilt dann
 * per `shareUnchanged` und gibt `h.doc` selbst zurück); `h.doc` ist auch der Parse von
 * `h.source`, beide Texte bleiben gültig.
 */
function restoreSide(
	h: History,
	model: DiagramDocument | undefined,
	source: string | undefined,
	rebuild?: Rebuild
): Pick<History, 'doc' | 'source'> {
	if (model) return { doc: model, source: null };
	if (source === undefined) throw new Error('Undo-Eintrag ohne Stand');
	if (source === h.source) return { doc: h.doc, source };
	if (!rebuild) throw new Error('Undo-Eintrag braucht Re-Parse');
	const doc = rebuild(source);
	return { doc, source: doc === h.doc ? h.source : source };
}

export function undo(h: History, rebuild?: Rebuild): History {
	const entry = h.past.at(-1);
	if (!entry) return h;
	return {
		...h,
		...restoreSide(h, entry.before, entry.beforeSource, rebuild),
		past: h.past.slice(0, -1),
		future: [entry, ...h.future]
	};
}

export function redo(h: History, rebuild?: Rebuild): History {
	const entry = h.future[0];
	if (!entry) return h;
	return {
		...h,
		...restoreSide(h, entry.after, entry.afterSource, rebuild),
		past: [...h.past, entry],
		future: h.future.slice(1)
	};
}

/**
 * Ersetzt das Modell atomar durch `next` (geparster Code) als ein Undo-Schritt. Der Zähler
 * wird nach D-03 auf `max(Zähler, floor, max(Suffix)+1)` angehoben, nie gesenkt; `floor` ist
 * z. B. der Zählerstand der Metadaten-Zeile des Codes (O-22). `source`: Code-Text, dessen Parse
 * `next` ist; dann hält der Eintrag statt der Modelle die Texte (T142 E), soweit bekannt.
 */
export function codeApply(
	h: History,
	next: DiagramDocument,
	payload?: unknown,
	floor?: IdCounters,
	source?: string
): History {
	const stored = floor ? atLeast(h.counters, floor) : h.counters;
	const entry: HistoryEntry = {
		label: 'codeApply',
		...(h.source !== null ? { beforeSource: h.source } : { before: h.doc }),
		...(source !== undefined ? { afterSource: source } : { after: next }),
		payload
	};
	return push({ ...h, counters: initCounters(next, stored), source: source ?? null }, entry, next);
}

const PREFIXES: readonly IdPrefix[] = ['n', 'e', 'c'];

function atLeast(a: IdCounters, b: IdCounters): IdCounters {
	return Object.fromEntries(PREFIXES.map((p) => [p, Math.max(a[p], b[p])])) as IdCounters;
}

/** Bündelt Commands zu einem Undo-Schritt (Gruppen-Drag, Gruppen-Löschen); atomar. */
export function transaction(label: string, commands: readonly Command[]): Command {
	return {
		label,
		do: (doc, ctx) => commands.reduce((current, c) => c.do(current, ctx), doc)
	};
}
