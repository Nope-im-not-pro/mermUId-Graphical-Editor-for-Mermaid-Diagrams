/**
 * Metadaten-Zeile `%% @mermuid: {"v":1,...}` (KONZEPT §6.2, D-02, D-03, O-02, O-45).
 * Reine Funktionen, kein DOM, kein Svelte.
 *
 * Schreibregel D-02: Originalbytes der gelesenen Zeile bleiben erhalten, solange sich der
 * Inhalt nicht ändert. Inhalt = Modus, wirksamer Zähler (D-03), Positionen ohne verwaiste
 * IDs, unbekannte Schlüssel. Verglichen wird `canon(geparst)` mit
 * `canon(bereinigt(aktuell))`; damit gilt eine beim Laden verwaiste ID als Änderung (§6.2),
 * eine nur handformatierte Zeile nicht. Positionen stammen ausschließlich aus manuellen
 * Aktionen; dagre-Ergebnisse gelangen nie in `LayoutMeta.positions`.
 */
import { msg } from '../i18n';
import { initCounters, type IdCounters, type IdPrefix } from '../../model/ids';
import type { DiagramDocument, LayoutMeta, Position } from '../../model/types';

const META_LINE = /^[ \t]*%%[ \t]*@mermuid:(.*)$/;
const LINE_PREFIX = '%% @mermuid: ';
const PREFIXES: readonly IdPrefix[] = ['n', 'e', 'c'];
const KNOWN_KEYS = new Set(['v', 'layout', 'ids', 'pos']);

/** Gelesene Zeile: Originalbytes plus geparster Inhalt. */
export interface LoadedMeta {
	raw: string;
	/** `false` bei defektem JSON; dann gilt Auto-Layout ohne Positionen. */
	ok: boolean;
	mode: LayoutMeta['mode'];
	/** Rohwerte des Zählerfelds `ids`; Prüfung und Startwert über `initCounters` (D-03). */
	storedIds: Partial<Record<IdPrefix, unknown>>;
	positions: Record<string, Position>;
	/** Unbekannte Top-Level-Schlüssel in Lese-Reihenfolge. */
	extra: [string, unknown][];
}

export interface WriteMetaInput {
	loaded: LoadedMeta | null;
	/** Aktuelles Modell; `doc.layout` ist das aktuelle `LayoutMeta`. */
	doc: DiagramDocument;
	counters: IdCounters;
	/** Schalter "Layout einbetten". */
	embed: boolean;
}

interface Content {
	mode: LayoutMeta['mode'];
	counters: IdCounters;
	positions: Record<string, Position>;
	extra: [string, unknown][];
}

/** Fundstelle einer `@mermuid`-Zeile: Zeilennummer (1-basiert) und Zeilentext ohne Zeilenende. */
export interface MetaHit {
	line: number;
	text: string;
}

/**
 * Ergebnis von `splitMeta` (O-45, löst O-16 ab). `@mermuid`-Zeilen dürfen an beliebiger Stelle
 * stehen; gültig ist die letzte (`metaLine`), `found` listet alle in Lese-Reihenfolge.
 * Ist die gültige Zeile die letzte Diagrammzeile (`inBody === false`), gilt
 * `text === body + metaLine + rest`: `body` = alles vor der Zeile inkl. trennendem Zeilenende
 * (frühere `@mermuid`-Zeilen eingeschlossen), `rest` = Zeilenumbrüche und
 * Leerzeichen-/Tab-Zeilen danach.
 * Steht sie mitten im Text (`inBody === true`) oder fehlt sie, ist `body === text` und `rest`
 * das letzte Zeilenende des Texts (oder `''`), mit dem eine neu angehängte Zeile endet.
 */
export interface MetaSplit {
	body: string;
	metaLine: string | null;
	rest: string;
	inBody: boolean;
	found: readonly MetaHit[];
}

/**
 * Ab dem ersten Zeilenumbruch, nach dem nur noch Leerraum folgt. Schleife statt Regex:
 * `/(?:[\r\n][ \t\r\n]*)?$/` ist bei langen Leerraum-Strecken quadratisch (E1-P2).
 */
function tailOf(text: string): string {
	let i = text.length;
	while (i > 0 && ' \t\r\n'.includes(text[i - 1])) i--;
	for (; i < text.length; i++) if (text[i] === '\r' || text[i] === '\n') return text.slice(i);
	return '';
}

const lineText = (line: string) => (line.endsWith('\r') ? line.slice(0, -1) : line);

function findMeta(text: string): MetaHit[] {
	const hits: MetaHit[] = [];
	text.split('\n').forEach((raw, i) => {
		const line = lineText(raw);
		if (META_LINE.test(line)) hits.push({ line: i + 1, text: line });
	});
	return hits;
}

/** Entfernt alle `@mermuid`-Zeilen samt ihrem Zeilenende; übrige Bytes bleiben. */
export function stripMetaLines(text: string): string {
	return text
		.split(/(?<=\n)/)
		.filter((line) => !META_LINE.test(lineText(line.endsWith('\n') ? line.slice(0, -1) : line)))
		.join('');
}

/** Trennt die gültige (letzte) Metadaten-Zeile ab, wenn sie die letzte Diagrammzeile ist. */
export function splitMeta(text: string): MetaSplit {
	const found = findMeta(text);
	const metaLine = found.at(-1)?.text ?? null;
	const eol = /\r?\n$/.exec(text)?.[0] ?? '';
	if (metaLine === null) return { body: text, metaLine, rest: eol, inBody: false, found };
	const tail = tailOf(text);
	const content = text.slice(0, text.length - tail.length);
	const start = content.lastIndexOf('\n') + 1;
	if (!META_LINE.test(content.slice(start))) {
		return { body: text, metaLine, rest: eol, inBody: true, found };
	}
	return { body: content.slice(0, start), metaLine, rest: tail, inBody: false, found };
}

/**
 * Umkehrung von `splitMeta`: `joinMeta(splitMeta(t)) === t`. Ist `metaLine` die gelesene
 * Zeile (`found`), bleibt alles an seiner Stelle (D-02, O-45 (1)). Sonst (geänderter Inhalt,
 * `null` = keine Zeile) entfallen alle `@mermuid`-Zeilen des Body, und die neue Zeile steht
 * allein am Ende (O-45 (2)); endet der Body nicht mit Zeilenende, wird das des Dokuments
 * eingefügt.
 */
export function joinMeta({
	body,
	metaLine,
	rest,
	inBody = false,
	found = []
}: Pick<MetaSplit, 'body' | 'metaLine' | 'rest'> & Partial<MetaSplit>): string {
	const kept = metaLine !== null && metaLine === found.at(-1)?.text;
	if (kept && inBody) return body;
	return appendMeta(kept ? body : stripMetaLines(body), metaLine, rest);
}

/**
 * Hängt `metaLine` (falls gesetzt) ans Ende von `base`, ohne `base` zu verändern; endet `base`
 * nicht mit Zeilenende, wird das des Dokuments eingefügt.
 */
export function appendMeta(base: string, metaLine: string | null, rest: string): string {
	if (metaLine === null) return base;
	if (base === '' || base.endsWith('\n')) return base + metaLine + rest;
	return base + (base.includes('\r\n') ? '\r\n' : '\n') + metaLine + rest;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function toPosition(value: unknown): Position | null {
	if (!Array.isArray(value) || (value.length !== 2 && value.length !== 4)) return null;
	if (!value.every((n) => typeof n === 'number' && Number.isFinite(n))) return null;
	const [x, y, w = 0, h = 0] = value as number[];
	return w >= 0 && h >= 0 ? [x, y, w, h] : null;
}

/** Positionen ohne Prototyp: IDs wie `toString` treffen keine geerbten Eigenschaften. */
function positionMap(): Record<string, Position> {
	return Object.create(null) as Record<string, Position>;
}

function readPositions(value: unknown, warnings: string[]): Record<string, Position> {
	const positions = positionMap();
	if (value === undefined) return positions;
	if (!isPlainObject(value)) {
		warnings.push(msg('services.meta.posNotObject'));
		return positions;
	}
	for (const [id, raw] of Object.entries(value)) {
		const pos = toPosition(raw);
		if (pos) positions[id] = pos;
		else warnings.push(msg('services.meta.invalidPos', { id }));
	}
	return positions;
}

function readIds(value: unknown, warnings: string[]): Partial<Record<IdPrefix, unknown>> {
	if (value === undefined) return {};
	if (!isPlainObject(value)) {
		warnings.push(msg('services.meta.idsNotObject'));
		return {};
	}
	return Object.fromEntries(PREFIXES.filter((p) => p in value).map((p) => [p, value[p]]));
}

/** Liest die Zeile tolerant: unbekannte Felder bleiben erhalten, defektes JSON warnt. */
export function readMeta(metaLine: string | null): {
	loaded: LoadedMeta | null;
	warnings: string[];
} {
	if (metaLine === null) return { loaded: null, warnings: [] };
	let data: unknown;
	try {
		data = JSON.parse(META_LINE.exec(metaLine)?.[1] ?? '');
	} catch {
		data = undefined;
	}
	if (!isPlainObject(data)) {
		return {
			loaded: {
				raw: metaLine,
				ok: false,
				mode: 'auto',
				storedIds: {},
				positions: positionMap(),
				extra: []
			},
			warnings: [msg('services.meta.broken')]
		};
	}
	const warnings: string[] = [];
	if (data.v !== 1) warnings.push(msg('services.meta.unknownVersion'));
	const loaded: LoadedMeta = {
		raw: metaLine,
		ok: true,
		mode: data.layout === 'auto' ? 'auto' : 'manual',
		storedIds: readIds(data.ids, warnings),
		positions: readPositions(data.pos, warnings),
		extra: Object.entries(data).filter(([key]) => !KNOWN_KEYS.has(key))
	};
	return { loaded, warnings };
}

/** Kanonische Form: feste Schlüsselreihenfolge, `pos` sortiert, keine Leerzeichen. */
function canon({ mode, counters, positions, extra }: Content): string {
	const parts = ['"v":1', `"layout":${JSON.stringify(mode)}`];
	const ids = PREFIXES.filter((p) => counters[p] > 1).map((p) => `"${p}":${counters[p]}`);
	if (ids.length > 0) parts.push(`"ids":{${ids.join(',')}}`);
	const pos = Object.keys(positions)
		.sort()
		.map((id) => `${JSON.stringify(id)}:${JSON.stringify(positions[id])}`);
	parts.push(`"pos":{${pos.join(',')}}`);
	for (const [key, value] of extra) parts.push(`${JSON.stringify(key)}:${JSON.stringify(value)}`);
	return `{${parts.join(',')}}`;
}

function liveIds(doc: DiagramDocument): Set<string> {
	return new Set([...doc.nodes, ...doc.edges, ...doc.containers].map((el) => el.id));
}

/**
 * Liefert die zu schreibende Zeile (`null` = keine Zeile). Verwaiste IDs entfallen,
 * ohne Positionen entfällt die Zeile, unveränderter Inhalt ergibt die Originalbytes.
 */
export function writeMeta({ loaded, doc, counters, embed }: WriteMetaInput): {
	metaLine: string | null;
	warnings: string[];
} {
	if (!embed) return { metaLine: null, warnings: [] };
	const ids = liveIds(doc);
	const positions = positionMap();
	for (const [id, raw] of Object.entries(doc.layout.positions)) {
		const pos = toPosition(raw);
		if (ids.has(id) && pos) positions[id] = pos;
	}
	const empty = Object.keys(positions).length === 0;
	if (loaded && !loaded.ok) {
		if (empty) {
			return {
				metaLine: loaded.raw,
				warnings: [msg('services.meta.brokenKept')]
			};
		}
		const line = LINE_PREFIX + canon({ mode: doc.layout.mode, counters, positions, extra: [] });
		return { metaLine: line, warnings: [msg('services.meta.brokenReplaced')] };
	}
	if (empty) return { metaLine: null, warnings: [] };
	const extra = loaded?.extra ?? [];
	const next = canon({ mode: doc.layout.mode, counters, positions, extra });
	if (loaded) {
		const before = canon({
			mode: loaded.mode,
			counters: initCounters(doc, loaded.storedIds),
			positions: loaded.positions,
			extra
		});
		if (before === next) return { metaLine: loaded.raw, warnings: [] };
	}
	return { metaLine: LINE_PREFIX + next, warnings: [] };
}

/**
 * Zeile ohne Positionen (Modus und Zähler von `doc`). Dient als gültige letzte Zeile, wenn eine
 * nicht entfernbare `@mermuid`-Zeile (in einem RawBlock) sonst wieder wirksam würde (O-45).
 */
export function neutralMeta(doc: DiagramDocument, counters: IdCounters): string {
	return (
		LINE_PREFIX + canon({ mode: doc.layout.mode, counters, positions: positionMap(), extra: [] })
	);
}

/** Kommando "Layout-Metadaten entfernen": Positionen weg, Auto-Layout, gelesene Zeile verworfen. */
export function removeLayoutMeta(state: { layout: LayoutMeta; loaded: LoadedMeta | null }): {
	layout: LayoutMeta;
	loaded: null;
} {
	return { layout: { ...state.layout, mode: 'auto', positions: {} }, loaded: null };
}
