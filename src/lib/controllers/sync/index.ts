/**
 * Sync-Orchestrator (T13, KONZEPT §6.1). Einzige Komponente, die Parser und Serializer der
 * Adapter aufruft. Grafik -> Code: nach jeder Command-Transaktion serialisieren, Metadaten-Zeile
 * über `writeMeta`/`joinMeta` (O-45, D-02 Originalbytes). Code -> Grafik: debounced 500 ms,
 * `splitMeta` -> Adapter `parse` (synchron) + `validate` (asynchron, O-15) -> `codeApply` als
 * eine Undo-Transaktion. Vor jedem Grafik-Command und vor Undo/Redo wird ein ausstehender
 * Code-Edit geflusht, damit der Serializer nie ungeparsten Nutzertext überschreibt.
 * Ändert sich während eines Laufs Code oder Modell, wird der Lauf verworfen und neu geplant.
 *
 * Metadaten-Zeile (O-45, löst O-16 ab): `@mermuid`-Zeilen dürfen überall stehen, die letzte
 * gilt; mehrere ergeben eine Warnung. Nicht-letzte Zeilen sind im Modell Kommentar-Elemente.
 * Bleibt der Meta-Inhalt gleich, bleiben sie an ihrer Stelle; ändert er sich (oder weichen
 * Code-Text und Modell ab, `metaPlan`), entfernt ein Grafik-Command sie im selben Undo-Schritt
 * aus dem Modell (`dropMeta`), und genau eine Zeile kommt ans Ende. Der Adapter
 * kennt keine `@mermuid`-Logik.
 * Ausnahme RawBlock (z. B. sequence `box` ... `end`): dessen Originalbytes sind unantastbar,
 * eine `@mermuid`-Zeile darin bleibt stehen. Bei geändertem Inhalt steht die neue Zeile als
 * letzte (wirksame) am Ende, ohne Positionen eine neutrale (`neutralMeta`); die Warnung zu
 * mehreren Zeilen bleibt dann bestehen. Unveränderter Inhalt bleibt byte-gleich (D-02).
 *
 * Fehlerfall (ungültiger Code, O-44): das letzte gültige Modell bleibt aktiv, `errors` ist
 * gesetzt, `conflict` nicht; wird der Code wieder gültig, übernimmt `codeApply` ihn ohne Wahl.
 * Konfliktfall: erst ein Grafik-Command bei ungültigem Code setzt `conflict` (nur in
 * `applyGraphic`). Grafik-Commands wirken, der Code-Text wird nicht überschrieben. Der Konflikt
 * bleibt bis zur Wahl "Grafik behalten" / "Code behalten" bestehen, auch wenn der Code wieder
 * gültig oder zu "nur Code" wird. Kein automatischer Drei-Wege-Merge. Syntaxfehler blockieren
 * nur Code -> Grafik.
 * `mode` ist der Modus des Modells (Serializer, Richtung, Diff); der Modus des Code-Texts
 * wird im Konflikt nur als `candidateMode` vermerkt und erst mit "Code behalten" übernommen.
 *
 * Jeder Undo-Eintrag trägt als Payload den Sync-Zustand davor und danach (Code-Text,
 * Fehler, Konflikt); Undo/Redo stellen damit auch den Code-Text exakt wieder her (D-09: eine
 * Historie). Code-Einträge halten kein Modell (T142, Rückfall E): `codeApply` erhält den
 * geparsten Text als Quelltext, Undo/Redo parsen ihn neu (`rebuild`, ohne Validierung, der Text
 * war gültig); schlägt das fehl, gilt der Fehlerpfad (letztes gültiges Modell, `errors`).
 * Snapshots halten `validDoc` nur im Konflikt (sonst ist es der Store-Stand) und statt
 * `candidate` nur den Marker `hasCandidate`: `restore` parst den Kandidaten aus `code` neu
 * (`parseDoc`, Fehlerpfad wie `rebuild`); `code` bleibt Volltext, `after.code` eines
 * Eintrags und `before.code` des folgenden sind derselbe String.
 * `modelVersion` zählt hier monoton jede Modell-Änderung, da das Feld im Modell
 * bei Undo und `codeApply` zurückspringt.
 */
import { msg } from '../../services/i18n';
import { get, writable, type Readable } from 'svelte/store';
import { createCommandStore, type CommandState } from '../commands/store';
import { transaction as bundle, sameDocument, type Command } from '../commands/history';
import { initCounters, type IdCounters, type IdPrefix } from '../../model/ids';
import type { DiagramDocument, LayoutMeta, ParseError } from '../../model/types';
import {
	appendMeta,
	joinMeta,
	neutralMeta,
	readMeta,
	splitMeta,
	stripMetaLines,
	writeMeta,
	type LoadedMeta
} from '../../services/meta';
import { detectType, type SyncMode } from './detect';
import { describeError, localize } from './errors';
import { defaultAdapters, type AdapterRegistry } from './registry';

export { detectType, type SyncMode } from './detect';
export {
	defaultAdapters,
	sequenceGrammar,
	type AdapterEntry,
	type AdapterRegistry,
	type RawDeclaration,
	type RawEvents,
	type RawStep
} from './registry';

export interface SyncState {
	/** Aktueller Code-Text (Editor-Inhalt). */
	readonly code: string;
	/** Zählt jede Änderung des Code-Texts (Nutzer-Edit oder Serializer). */
	readonly codeVersion: number;
	/** Zählt jede Änderung des Modells (Command, `codeApply`, Undo/Redo). */
	readonly modelVersion: number;
	readonly mode: SyncMode;
	/** Richtung aus `DiagramAdapter.getDirection` für das Layout (O-19), sonst leer. */
	readonly direction: string;
	/** Code-Edit wartet auf Parse (Debounce-Fenster oder laufende Validierung). */
	readonly pending: boolean;
	/** Syntaxfehler des Code-Texts; blockieren nur Code -> Grafik. */
	readonly errors: readonly ParseError[];
	/** Konflikt aktiv (Grafik-Command bei ungültigem Code, Wahl ausstehend). */
	readonly conflict: boolean;
	/** Hinweise zur Metadaten-Zeile (defekt, ersetzt); kein Abbruch. */
	readonly warnings: readonly string[];
}

/** Zeitgeber für den Debounce; injizierbar für Tests. */
export interface SyncTimer {
	set(fn: () => void, ms: number): unknown;
	clear(handle: unknown): void;
}

export const DEBOUNCE_MS = 500;

const realTimer: SyncTimer = {
	set: (fn, ms) => setTimeout(fn, ms),
	clear: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>)
};

export interface SyncOptions {
	adapters?: AdapterRegistry;
	timer?: SyncTimer;
	/** Schalter "Layout einbetten" (KONZEPT §6.2), Default an. */
	embed?: boolean;
}

export interface SyncController extends Readable<SyncState> {
	/** Modell und Undo-Zustand (nur lesend). */
	readonly commands: Readable<CommandState>;
	/** Neuer Code-Text aus dem Editor; Parse folgt nach `DEBOUNCE_MS`. */
	editCode(text: string): void;
	/** Führt einen ausstehenden Parse sofort aus und wartet auf laufende Läufe. */
	flush(): Promise<void>;
	execute(command: Command): Promise<void>;
	transaction(label: string, commands: readonly Command[]): Promise<void>;
	undo(): Promise<void>;
	redo(): Promise<void>;
	/** Konflikt: Code aus dem Modell neu erzeugen; der ungültige Text bleibt als Undo-Schritt. */
	keepGraphic(): Promise<void>;
	/** Konflikt: Grafik-Änderungen seit dem letzten gültigen Stand verwerfen; Code bleibt. */
	keepCode(): Promise<void>;
	/** Beide Texte für die Diff-Ansicht; `null` im Modus "nur Code". */
	diff(): Promise<{ code: string; model: string } | null>;
	/** Bricht einen geplanten Parse ab. */
	dispose(): void;
}

/** Sync-Zustand je Undo-Eintrag. */
interface Snapshot {
	code: string;
	mode: SyncMode;
	/** Modus des Code-Texts während eines Konflikts (gehört zu `candidate`). */
	candidateMode: SyncMode;
	errors: readonly ParseError[];
	warnings: readonly string[];
	conflict: boolean;
	/** Modell des letzten gültigen Code-Stands; `null` außerhalb eines Konflikts (= Store-Stand). */
	validDoc: DiagramDocument | null;
	/**
	 * Gab es während eines Konflikts ein geparstes Modell des wieder gültigen Codes? Das Modell
	 * selbst ist der Parse von `code` und wird bei `restore` neu gebaut (T142 E).
	 */
	hasCandidate: boolean;
}

interface SyncPayload {
	readonly sync: true;
	before: Snapshot;
	after: Snapshot;
}

export type Analysis =
	| { mode: 'code' }
	| { mode: Exclude<SyncMode, 'code'>; errors: ParseError[] }
	| {
			mode: Exclude<SyncMode, 'code'>;
			errors: [];
			doc: DiagramDocument;
			loaded: LoadedMeta | null;
			warnings: string[];
	  };

const PREFIXES: readonly IdPrefix[] = ['n', 'e', 'c'];

function maxCounters(a: IdCounters, b: IdCounters): IdCounters {
	return Object.fromEntries(PREFIXES.map((p) => [p, Math.max(a[p], b[p])])) as IdCounters;
}

function emptyDocument(mode: SyncMode): DiagramDocument {
	return {
		id: 'doc',
		diagramType: mode === 'code' ? '' : mode,
		title: '',
		header: { frontmatter: '', directives: [] },
		order: [],
		nodes: [],
		edges: [],
		containers: [],
		classDefs: [],
		rawBlocks: [],
		comments: [],
		layout: { mode: 'auto', engine: '', positions: {}, gridSize: 8, snap: false },
		modelVersion: 0
	};
}

/** Übernimmt Modus und Positionen der Metadaten-Zeile ins Modell. */
function withLayout(doc: DiagramDocument, loaded: LoadedMeta | null): DiagramDocument {
	if (!loaded?.ok) return doc;
	const layout: LayoutMeta = { ...doc.layout, mode: loaded.mode, positions: loaded.positions };
	return { ...doc, layout };
}

/**
 * Raster (`snap`, `gridSize`) steht nicht in der Metadaten-Zeile: ein Re-Parse übernimmt es
 * aus dem bisherigen Modell statt des Parser-Defaults.
 */
function keepGrid(doc: DiagramDocument, previous: LayoutMeta): DiagramDocument {
	const layout: LayoutMeta = { ...doc.layout, snap: previous.snap, gridSize: previous.gridSize };
	return { ...doc, layout };
}

/** Warnung bei mehr als einer `@mermuid`-Zeile (O-45); nie ein Fehler. */
function duplicateWarnings(text: string): string[] {
	return splitMeta(text).found.length > 1 ? [msg('sync.metaDuplicate')] : [];
}

/**
 * Entfernt `@mermuid`-Zeilen aus dem Modell (O-45 (2)): Kommentar-Elemente samt Verweisen in
 * `order` und Container-Abschnitten, Zeilen in Header-Direktiven. Trägt ein Kommentar außer
 * der Zeile noch Leerzeilen (sequence: Trivia davor), wird er zum RawBlock mit diesem Rest
 * (gleiche ID und Stelle), damit die Leerzeilen erhalten bleiben; der Serializer gibt nur
 * Kommentartext mit `%%` wörtlich aus. `dirIndex` (Lage der `direction`-Zeile unter den
 * Mitgliedern) rückt um die davor entfernten Elemente nach.
 */
function dropMeta(doc: DiagramDocument): DiagramDocument {
	const hits = doc.comments.filter((c) => stripMetaLines(c.text) !== c.text);
	const blocks = hits
		.map((c) => ({ id: c.id, rawText: stripMetaLines(c.text) }))
		.filter((b) => b.rawText !== '');
	const kept = new Set(blocks.map((b) => b.id));
	const ids = new Set(hits.map((c) => c.id).filter((id) => !kept.has(id)));
	const directives = doc.header.directives.map(stripMetaLines).filter((d) => d !== '');
	const sameHeader =
		directives.length === doc.header.directives.length &&
		directives.every((d, i) => d === doc.header.directives[i]);
	if (hits.length === 0 && sameHeader) return doc;
	const keep = (list: readonly string[]) => list.filter((id) => !ids.has(id));
	const containers = doc.containers.map((c) => {
		const members = c.sections.flatMap((s) => s.memberIds);
		if (!members.some((id) => ids.has(id))) return c;
		const index = c.props.dirIndex;
		const props =
			typeof index === 'number'
				? {
						...c.props,
						dirIndex: index - members.slice(0, index).filter((id) => ids.has(id)).length
					}
				: c.props;
		return {
			...c,
			props,
			sections: c.sections.map((s) => ({ ...s, memberIds: keep(s.memberIds) }))
		};
	});
	return {
		...doc,
		header: sameHeader ? doc.header : { ...doc.header, directives },
		order: keep(doc.order),
		comments: doc.comments.filter((c) => !hits.includes(c)),
		rawBlocks: blocks.length > 0 ? [...doc.rawBlocks, ...blocks] : doc.rawBlocks,
		containers
	};
}

/** Ausnahme eines Adapters oder der Validierung als Fehler ohne Ort (V-13). */
function failure(e: unknown): ParseError {
	return { line: 1, column: 1, message: describeError(e) };
}

/** Gleiche Serializer-Eingabe: alle Felder außer `layout` und `modelVersion` identisch. */
function sameBodyInput(a: DiagramDocument, b: DiagramDocument): boolean {
	const keys = Object.keys(a) as (keyof DiagramDocument)[];
	return (
		keys.length === Object.keys(b).length &&
		keys.every((k) => k === 'layout' || k === 'modelVersion' || a[k] === b[k])
	);
}

/** Ausnahme von `serialize`; nur sie wird in `applyGraphic`/`resolve` abgefangen. */
class SerializeFailure extends Error {
	constructor(readonly error: ParseError) {
		super(error.message);
	}
}

/** Prüfpfad Code -> Modell (Datei-Öffnen, Code-Edit, Fragment-Lesen T133): Meta, parse, validate. */
export async function analyze(text: string, adapters: AdapterRegistry): Promise<Analysis> {
	const split = splitMeta(text);
	const mode = detectType(split.body);
	if (mode === 'code') return { mode };
	const entry = adapters[mode];
	let parsed: ReturnType<typeof entry.adapter.parse>;
	try {
		parsed = entry.adapter.parse(split.body);
	} catch (e) {
		return { mode, errors: [failure(e)] };
	}
	if (!parsed.ok) return { mode, errors: parsed.errors };
	let errors: ParseError[];
	try {
		errors = await entry.validate(split.body);
	} catch (e) {
		errors = [failure(e)];
	}
	if (errors.length > 0) return { mode, errors };
	const { loaded, warnings } = readMeta(split.metaLine);
	// `split.body` ist ein Präfix des Editor-Texts: Zeilen der Adapter-Warnungen gelten dort (O-83).
	warnings.push(...(entry.adapter.warnings?.(parsed.doc) ?? []), ...duplicateWarnings(text));
	return { mode, errors: [], doc: withLayout(parsed.doc, loaded), loaded, warnings };
}

const IDENTITY = (label: string): Command => ({ label, do: (doc) => doc });

/** Grafik-Command ohne Wirkung auf Modell und Code-Text: kein Undo-Schritt (T107, O-71). */
class NoChange extends Error {}

export async function createSync(text: string, options: SyncOptions = {}): Promise<SyncController> {
	const adapters = options.adapters ?? defaultAdapters;
	const embed = options.embed ?? true;
	const timer = options.timer ?? realTimer;
	const initial = await analyze(text, adapters);
	const start = 'doc' in initial ? initial.doc : emptyDocument(initial.mode);
	let counters = initCounters(start, 'loaded' in initial ? initial.loaded?.storedIds : {});
	const store = createCommandStore(start, counters, 'doc' in initial ? text : undefined);

	let code = text;
	let codeVersion = 0;
	let modelVersion = 0;
	let mode: SyncMode = initial.mode;
	let errors: readonly ParseError[] = 'errors' in initial ? initial.errors : [];
	let warnings: readonly string[] = 'warnings' in initial ? initial.warnings : [];
	let conflict = false;
	let validDoc = get(store).doc;
	let candidate: DiagramDocument | null = null;
	let candidateMode: SyncMode = mode;
	/** Code-Text, der dem aktuellen Undo-Zustand entspricht. */
	let syncedCode = code;
	let scheduled: unknown = null;
	let inflight: Promise<void> | null = null;
	/** Geplante Validierung der letzten Grafik -> Code-Ausgabe (D4/O-47). */
	let checking: unknown = null;
	/** Warnungstexte der Validierung; ein neues Ergebnis ersetzt sie (auch nach Undo/Redo). */
	const checkWarnings = new Set<string>();
	/** `serialize`-Fehler: zeigen den Fehlerzustand, blockieren aber keine Grafik-Commands. */
	const writeErrors = new WeakSet<ParseError>();
	/**
	 * Body-Wiederverwendung (V-29): der Serializer liest `layout` nicht, also ergibt eine reine
	 * Layout-Änderung denselben Body. Schlüssel ist das `nodes`-Array (bleibt bei Positions-
	 * Commands und Undo/Redo erhalten), geprüft werden alle übrigen Felder auf Identität.
	 */
	const bodies = new WeakMap<
		readonly unknown[],
		{ doc: DiagramDocument; mode: Exclude<SyncMode, 'code'>; body: string }
	>();

	const current = () => get(store).doc;
	const state = writable<SyncState>(toState());

	function toState(): SyncState {
		const doc = get(store).doc;
		const getDirection = mode === 'code' ? undefined : adapters[mode].adapter.getDirection;
		return Object.freeze({
			code,
			codeVersion,
			modelVersion,
			mode,
			pending: code !== syncedCode || scheduled !== null || inflight !== null,
			direction: getDirection?.(doc) ?? '',
			errors,
			conflict,
			warnings
		});
	}

	const publish = () => state.set(toState());

	function setCode(next: string) {
		if (next === code) return;
		code = next;
		codeVersion++;
	}

	const snap = (): Snapshot => ({
		code,
		mode,
		candidateMode,
		errors,
		warnings,
		conflict,
		validDoc: conflict ? validDoc : null,
		hasCandidate: candidate !== null
	});

	/** `failed`: Fehler beim Neubau des Kandidaten (Fehlerpfad, Kandidat entfällt). */
	function restore(s: Snapshot, failed: ParseError[]) {
		setCode(s.code);
		mode = s.mode;
		candidateMode = s.candidateMode;
		errors = s.errors;
		warnings = s.warnings;
		conflict = s.conflict;
		validDoc = s.validDoc ?? current();
		candidate = s.hasCandidate ? parseDoc(s.code, failed) : null;
		syncedCode = code;
	}

	function schedule() {
		if (scheduled !== null) timer.clear(scheduled);
		scheduled = timer.set(() => {
			scheduled = null;
			startRun();
		}, DEBOUNCE_MS);
	}

	function startRun() {
		const run: Promise<void> = parseRun().finally(() => {
			if (inflight === run) inflight = null;
			publish();
		});
		inflight = run;
	}

	async function flush() {
		while (scheduled !== null || inflight !== null) {
			if (scheduled !== null) {
				timer.clear(scheduled);
				scheduled = null;
				startRun();
			}
			await inflight;
		}
	}

	/**
	 * Wie `flush`, prüft aber nach dem Fortsetzen erneut: ein im selben Tick folgender
	 * `editCode` darf vom anschließenden Schritt nicht überschrieben werden.
	 */
	async function settle() {
		do await flush();
		while (scheduled !== null || inflight !== null);
	}

	/** Adapter-Modus eines Modells beim Fehlerbeginn aus dem Modus "nur Code". */
	function modelMode(fallback: Exclude<SyncMode, 'code'>): Exclude<SyncMode, 'code'> {
		if (mode !== 'code') return mode;
		const type = current().diagramType;
		return Object.hasOwn(adapters, type) ? (type as Exclude<SyncMode, 'code'>) : fallback;
	}

	/** Ein Code -> Grafik-Lauf; veraltete Ergebnisse werden verworfen. */
	async function parseRun() {
		const text = code;
		const versions = [codeVersion, modelVersion];
		if (text === syncedCode) return;
		const result = await analyze(text, adapters);
		if (versions[0] !== codeVersion) return;
		if (versions[1] !== modelVersion) {
			schedule();
			return;
		}
		const payload: SyncPayload = {
			sync: true,
			before: { ...snap(), code: syncedCode },
			after: snap()
		};
		candidate = null;
		let applied = false;
		if ('doc' in result) {
			result.doc = keepGrid(result.doc, current().layout);
			warnings = result.warnings;
			counters = maxCounters(counters, initCounters(result.doc, result.loaded?.storedIds));
		}
		if (conflict) {
			// Banner bleibt bis zur Wahl; Modell und Modell-Modus bleiben unverändert.
			candidateMode = result.mode;
			errors = 'errors' in result ? result.errors : [];
			if ('doc' in result) candidate = result.doc;
		} else if (!('errors' in result)) {
			mode = result.mode;
			errors = [];
		} else if (!('doc' in result)) {
			mode = modelMode(result.mode);
			candidateMode = result.mode;
			errors = result.errors;
		} else {
			mode = result.mode;
			errors = [];
			store.codeApply(result.doc, payload, counters, text);
			modelVersion++;
			validDoc = current();
			applied = true;
		}
		if (!applied) store.execute(IDENTITY('codeEdit'), payload);
		syncedCode = code;
		payload.after = snap();
	}

	function serialize(doc: DiagramDocument, adapterMode: Exclude<SyncMode, 'code'>): string {
		const hit = bodies.get(doc.nodes);
		if (hit && hit.mode === adapterMode && sameBodyInput(hit.doc, doc)) return hit.body;
		try {
			const body = adapters[adapterMode].adapter.serialize(doc);
			bodies.set(doc.nodes, { doc, mode: adapterMode, body });
			return body;
		} catch (e) {
			const error = failure(e);
			writeErrors.add(error);
			throw new SerializeFailure(error);
		}
	}

	/**
	 * Prüft die geschriebene Ausgabe debounced mit mermaid (D4/O-47). Das Ergebnis geht nur nach
	 * `warnings`, nie nach `errors` (sonst würde der nächste Grafik-Command einen Konflikt
	 * setzen). `codeVersion` und Modus gelten ab dem Planen: ändert sich der Code-Text vorher
	 * (Nutzer-Edit, Undo), entfällt die Prüfung; ein veraltetes Ergebnis wird verworfen.
	 */
	function scheduleCheck(adapterMode: Exclude<SyncMode, 'code'>) {
		if (checking !== null) timer.clear(checking);
		const version = codeVersion;
		const text = code;
		const stale = () => version !== codeVersion || mode !== adapterMode;
		checking = timer.set(() => {
			checking = null;
			if (stale()) return;
			const done = (found: readonly ParseError[]) => {
				if (stale()) return;
				const rest = warnings.filter((w) => !checkWarnings.has(w));
				if (found.length === 0) {
					warnings = rest;
				} else {
					const warning = msg('sync.generatedInvalid', { msg: found[0].message });
					checkWarnings.add(warning);
					warnings = [...rest, warning];
				}
				publish();
			};
			adapters[adapterMode]
				.validate(splitMeta(text).body)
				.then(done, (e: unknown) => done([failure(e)]));
		}, DEBOUNCE_MS);
	}

	/**
	 * Neue Metadaten-Zeile für `doc`, das zu serialisierende Modell und ob die Zeilen an ihrer
	 * Stelle bleiben (O-45). An der Stelle bleiben sie nur bei unverändertem Meta-Inhalt und
	 * wenn die `@mermuid`-Zeilen des serialisierten Modells genau die des Code-Texts sind (ohne
	 * eine Zeile am Ende, die nie im Modell steht). Sonst (Inhalt geändert (3), oder Code-Text
	 * und Modell weichen ab, z. B. Konflikt mit ungültigem Code) entfallen die Kommentare, und
	 * genau eine Zeile kommt ans Ende (2). Ein neuer Knoten ohne Position ändert den Inhalt nicht
	 * und verschiebt die Zeile daher nicht: der Zähler ist aus dem Modell ableitbar (D-03),
	 * Modus `auto` schreibt keine Position (D5/O-48). Die Zeilen des serialisierten Modells
	 * zählen auch ohne entfernbare Kommentare, sobald der Code-Text Zeilen im Body hat (RawBlock).
	 */
	function metaPlan(doc: DiagramDocument, ids: IdCounters, adapterMode: Exclude<SyncMode, 'code'>) {
		const split = splitMeta(code);
		const { loaded } = readMeta(split.metaLine);
		const meta = writeMeta({ loaded, doc, counters: ids, embed });
		const stripped = dropMeta(doc);
		const expected = (split.inBody ? split.found : split.found.slice(0, -1)).map((h) => h.text);
		const own =
			stripped === doc && expected.length === 0
				? []
				: splitMeta(serialize(doc, adapterMode)).found.map((h) => h.text);
		const inPlace =
			meta.metaLine === split.metaLine &&
			own.length === expected.length &&
			own.every((t, i) => t === expected[i]);
		if (inPlace || stripped === doc) return { split, meta, inPlace, model: doc };
		// Meta-Inhalt des tatsächlich geschriebenen Modells (diff und keepGraphic gleich).
		const next = writeMeta({ loaded, doc: stripped, counters: ids, embed });
		return { split, meta: next, inPlace, model: stripped };
	}

	/**
	 * Serialisiert `doc` samt Metadaten-Zeile. Bleiben die Zeilen an ihrer Stelle, gelten die
	 * Fundstellen des Code-Texts (Originalbytes, D-02); sonst enthält der serialisierte Body
	 * keine entfernbare `@mermuid`-Zeile (RawBlock-Zeilen bleiben unverändert stehen), und die
	 * neue steht am Ende, mit dem Zeilenende-Rest einer Zeile,
	 * die im Code-Text am Ende stand (O-45).
	 */
	function render(
		doc: DiagramDocument,
		adapterMode: Exclude<SyncMode, 'code'>,
		ids: IdCounters = counters
	) {
		const { split, meta, inPlace, model } = metaPlan(doc, ids, adapterMode);
		const body = serialize(model, adapterMode);
		const atEnd = split.metaLine !== null && !split.inBody;
		const rest = atEnd ? split.rest : (/\r?\n$/.exec(body)?.[0] ?? '');
		// Bleibt eine `@mermuid`-Zeile im Body (RawBlock), überdeckt eine neutrale Zeile sie.
		const line =
			inPlace || meta.metaLine !== null || splitMeta(body).found.length === 0
				? meta.metaLine
				: neutralMeta(model, ids);
		const text = inPlace
			? joinMeta({ ...split, body, metaLine: line })
			: appendMeta(body, line, rest);
		return { text, warnings: [...meta.warnings, ...duplicateWarnings(text)] };
	}

	/** Entfernt bei Bedarf (`metaPlan`) die `@mermuid`-Kommentare im selben Undo-Schritt. */
	const metaCleanup = (label: string): Command => ({
		label,
		do: (doc) => metaPlan(doc, initCounters(doc, counters), mode as Exclude<SyncMode, 'code'>).model
	});

	/**
	 * Schritt am Ende eines Commands, der den Code-Text erzeugt: wirft `serialize`, schlägt der
	 * ganze Command fehl, und Modell und Undo-Stapel bleiben unverändert (V-13).
	 */
	function writeStep(adapterMode: Exclude<SyncMode, 'code'>) {
		const step = {
			out: null as ReturnType<typeof render> | null,
			command: {
				label: '',
				do: (doc: DiagramDocument) => {
					step.out = render(doc, adapterMode, initCounters(doc, counters));
					return doc;
				}
			}
		};
		return step;
	}

	/**
	 * Fehlerzustand nach einer Ausnahme von `serialize`; andere Ausnahmen gehen weiter, Model-Fehler
	 * übersetzt (T128 C3). Ersetzt nur frühere Schreibfehler, Parse-Fehler des Code-Texts bleiben.
	 */
	function writeFailed(e: unknown) {
		if (!(e instanceof SerializeFailure)) throw localize(e);
		errors = [...errors.filter((x) => !writeErrors.has(x)), e.error];
		publish();
	}

	function applyGraphic(command: Command) {
		if (mode === 'code') throw new Error(msg('services.sync.codeOnly'));
		const adapterMode = mode;
		const before = current();
		const payload: SyncPayload = { sync: true, before: snap(), after: snap() };
		const blocked = conflict || errors.some((e) => !writeErrors.has(e));
		const write = writeStep(adapterMode);
		// Letzter Schritt: verwirft den Command ohne Eintrag, wenn Modell und Code gleich bleiben.
		const unchanged: Command = {
			label: '',
			do: (doc) => {
				const sameCode = write.out === null || write.out.text === code;
				if (sameCode && sameDocument(before, doc)) throw new NoChange();
				return doc;
			}
		};
		try {
			store.execute(
				bundle(
					command.label,
					blocked ? [command, unchanged] : [command, metaCleanup(''), write.command, unchanged]
				),
				payload
			);
		} catch (e) {
			if (e instanceof NoChange) return;
			writeFailed(e);
			return;
		}
		modelVersion++;
		const doc = current();
		counters = initCounters(doc, counters);
		if (blocked) conflict = true;
		else if (write.out) {
			setCode(write.out.text);
			errors = [];
			warnings = write.out.warnings;
			validDoc = doc;
			scheduleCheck(adapterMode);
		}
		syncedCode = code;
		payload.after = snap();
		publish();
	}

	/** Auflösung des Konflikts als ein Undo-Schritt. */
	function resolve(keep: 'graphic' | 'code') {
		if (!conflict) return;
		const payload: SyncPayload = { sync: true, before: snap(), after: snap() };
		if (keep === 'graphic') {
			const adapterMode = mode as Exclude<SyncMode, 'code'>;
			const write = writeStep(adapterMode);
			try {
				store.execute(bundle('keepGraphic', [metaCleanup(''), write.command]), payload);
			} catch (e) {
				writeFailed(e);
				return;
			}
			conflict = false;
			errors = [];
			if (write.out) {
				setCode(write.out.text);
				warnings = write.out.warnings;
				scheduleCheck(adapterMode);
			}
		} else {
			conflict = false;
			store.codeApply(keepGrid(candidate ?? validDoc, current().layout), payload, counters);
			modelVersion++;
			if (candidate !== null || candidateMode === 'code') mode = candidateMode;
		}
		validDoc = errors.length === 0 ? current() : validDoc;
		candidate = null;
		candidateMode = mode;
		syncedCode = code;
		payload.after = snap();
		publish();
	}

	/**
	 * Modell eines Code-Texts neu (T142 E): wie `analyze`, aber synchron und ohne Validierung
	 * (der Text war gültig). Raster aus dem aktuellen Stand. Bei Fehler `null`, der Fehler landet
	 * in `failed`.
	 */
	function parseDoc(text: string, failed: ParseError[]): DiagramDocument | null {
		const split = splitMeta(text);
		const type = detectType(split.body);
		try {
			// Kann nicht entstehen: Code-Einträge und Kandidaten gibt es nur für Diagrammtext.
			if (type === 'code') return null;
			const parsed = adapters[type].adapter.parse(split.body);
			if (!parsed.ok) {
				failed.push(...parsed.errors);
				return null;
			}
			const doc = withLayout(parsed.doc, readMeta(split.metaLine).loaded);
			return keepGrid(doc, current().layout);
		} catch (e) {
			failed.push(failure(e));
			return null;
		}
	}

	/** Modell eines Code-Eintrags (`parseDoc`); bei Fehler bleibt der aktuelle Stand. */
	const rebuild = (text: string, failed: ParseError[]) => parseDoc(text, failed) ?? current();

	function step(direction: 'undo' | 'redo') {
		const failed: ParseError[] = [];
		const reparse = (text: string) => rebuild(text, failed);
		const entry = direction === 'undo' ? store.undo(reparse) : store.redo(reparse);
		if (!entry) return;
		modelVersion++;
		counters = initCounters(current(), counters);
		const payload = entry.payload as SyncPayload;
		restore(direction === 'undo' ? payload.before : payload.after, failed);
		// Re-Parse fehlgeschlagen: Fehlerpfad wie ein ungültiger Code-Edit (O-44).
		if (failed.length > 0) errors = failed;
		// Die Validierungswarnung steht nicht im Snapshot: wiederhergestellte Ausgabe neu prüfen.
		if (mode !== 'code' && errors.length === 0 && !conflict) scheduleCheck(mode);
		publish();
	}

	return {
		subscribe: state.subscribe,
		commands: { subscribe: store.subscribe },
		editCode(next) {
			setCode(next);
			schedule();
			publish();
		},
		flush,
		async execute(command) {
			await settle();
			applyGraphic(command);
		},
		async transaction(label, commands) {
			await settle();
			applyGraphic(bundle(label, commands));
		},
		async undo() {
			await settle();
			step('undo');
		},
		async redo() {
			await settle();
			step('redo');
		},
		async keepGraphic() {
			await settle();
			resolve('graphic');
		},
		async keepCode() {
			await settle();
			resolve('code');
		},
		async diff() {
			await settle();
			if (mode === 'code') return null;
			try {
				return { code, model: render(current(), mode).text };
			} catch (e) {
				// Nicht serialisierbares Modell (Konflikt): Grafik-Seite zeigt die Fehlermeldung.
				if (!(e instanceof SerializeFailure)) throw e;
				return { code, model: e.error.message };
			}
		},
		dispose() {
			if (scheduled !== null) timer.clear(scheduled);
			if (checking !== null) timer.clear(checking);
			scheduled = null;
			checking = null;
		}
	};
}
