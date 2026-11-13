/**
 * Fragment für Kopieren/Einfügen (T133 C1, F-01). Teil des Sync-Orchestrators, da nur er
 * `parse`/`serialize` der Adapter aufruft (KONZEPT §6.1).
 *
 * Fragment = ausgewählte Knoten, Kanten zwischen ihnen und die von den Knoten genutzten
 * `classDef`s (plus `default`, wirkt auf jeden Knoten), dazu Positionen der Knoten.
 * Container, Kommentare, RawBlocks, Frontmatter und Direktiven gehören nicht dazu; Elemente
 * stehen auf oberster Ebene und sind kanonisch (`sourceText` leer, keine Anweisungs-Verweise).
 * IDs bleiben die des Quelltexts; neue IDs (D-03) vergibt erst das Einfügen (C2).
 */
import { initCounters } from '../../model/ids';
import type {
	ClassDef,
	DiagramDocument,
	DiagramEdge,
	DiagramNode,
	ParseError,
	Position,
	PropsMap
} from '../../model/types';
import { classify, contentOf } from '../../services/adapters/flowchart/syntax';
import { MAX_FILE_BYTES, readText } from '../../services/file';
import { appendMeta, writeMeta } from '../../services/meta';
import { analyze } from './index';
import { defaultAdapters, type AdapterRegistry } from './registry';

export interface Fragment {
	nodes: DiagramNode[];
	edges: DiagramEdge[];
	classDefs: ClassDef[];
	/** Positionen der Knoten aus der Metadaten-Zeile; leer ohne Zeile. */
	positions: Record<string, Position>;
}

/**
 * Grund eines Fehlerergebnisses: `too-large` (Grenze wie Datei-Öffnen), `not-flowchart`
 * (Prosa, anderer Diagrammtyp, leer), `invalid` (Parser/Validierung, `errors` gesetzt),
 * `empty` (gültig, ohne Knoten und ohne Verworfenes), `unsupported` (gültig, aber nur
 * Verworfenes, siehe `dropped`).
 */
export type FragmentFailure = 'too-large' | 'not-flowchart' | 'invalid' | 'empty' | 'unsupported';

export type FragmentRead =
	/** `dropped`: Anzahl verworfener Container, RawBlocks und Container-ID-Knoten samt Kanten. */
	| { ok: true; fragment: Fragment; dropped: number }
	| { ok: false; reason: FragmentFailure; errors: readonly ParseError[] };

/** `props` ohne die Schlüssel `keys`. */
function without(props: PropsMap, keys: readonly string[]): PropsMap {
	return Object.fromEntries(Object.entries(props).filter(([key]) => !keys.includes(key)));
}

/** Ohne Bezug auf Anweisungen und Container des Quelltexts (Serializer schreibt kanonisch). */
function looseNode(n: DiagramNode): DiagramNode {
	const props = without(n.props, ['stmtText', 'stmtParent']);
	return { ...n, props, parentId: null, sourceText: '' };
}

function looseEdge(e: DiagramEdge): DiagramEdge {
	return { ...e, props: without(e.props, ['stmt']), parentId: null, sourceText: '' };
}

/**
 * Teilmenge von `doc` zu den Knoten-IDs `selected`; Kanten nur zwischen ausgewählten Knoten.
 * Knoten mit der ID eines Containers (`S --> C` bei `subgraph S`) meinen in mermaid den
 * Container und entfallen ohne ihn samt ihren Kanten.
 */
function extract(doc: DiagramDocument, selected: ReadonlySet<string>): Fragment {
	const boxes = new Set(doc.containers.map((c) => c.id));
	const nodes = doc.nodes.filter((n) => selected.has(n.id) && !boxes.has(n.id)).map(looseNode);
	const inside = new Set(nodes.map((n) => n.id));
	const edges = doc.edges
		.filter((e) => inside.has(e.sourceId) && inside.has(e.targetId))
		.map(looseEdge);
	const used = new Set(['default', ...nodes.flatMap((n) => n.cssClasses)]);
	const classDefs = doc.classDefs
		.filter((c) => used.has(c.name))
		.map((c) => ({ ...c, sourceText: '' }));
	const positions = Object.fromEntries(
		Object.entries(doc.layout.positions).filter(([id]) => inside.has(id))
	);
	return { nodes, edges, classDefs, positions };
}

/**
 * Fragment der Auswahl als gültiger flowchart-Text: Kopfzeile mit der Richtung von `doc`,
 * kanonischer Body, Positionen als `@mermuid`-Zeile. `null`, wenn `doc` kein flowchart ist
 * oder die Auswahl keinen Knoten enthält.
 */
export function fragmentText(
	doc: DiagramDocument,
	nodeIds: Iterable<string>,
	adapters: AdapterRegistry = defaultAdapters
): string | null {
	if (doc.diagramType !== 'flowchart') return null;
	const { adapter } = adapters.flowchart;
	const fragment = extract(doc, new Set(nodeIds));
	if (fragment.nodes.length === 0) return null;
	const sub: DiagramDocument = {
		...doc,
		header: { frontmatter: '', directives: [] },
		order: [],
		nodes: fragment.nodes,
		edges: fragment.edges,
		containers: [],
		classDefs: fragment.classDefs,
		rawBlocks: [],
		comments: [],
		layout: { ...doc.layout, positions: fragment.positions }
	};
	const head = `flowchart ${adapter.getDirection?.(doc) ?? ''}`.trimEnd() + '\n';
	const body = adapter.serialize(sub);
	const base = head + body + (body === '' || body.endsWith('\n') ? '' : '\n');
	const { metaLine } = writeMeta({
		loaded: null,
		doc: sub,
		counters: initCounters(sub),
		embed: true
	});
	return appendMeta(base, metaLine, '\n');
}

/** RawBlock-Arten ohne Verlust: Kopfzeile, Leerzeilen, Kommentare, Wirkung im Modell (class, style, ...). */
const KEPT = new Set([
	'blank',
	'decl',
	'directive',
	'comment',
	'graph',
	'class',
	'style',
	'click',
	'linkStyle'
]);

/** Verworfene Elemente beim Lesen: Container, RawBlocks ohne Modellwirkung, Container-ID-Knoten. */
function droppedCount(doc: DiagramDocument, fragment: Fragment): number {
	const raws = doc.rawBlocks.filter((r) => !KEPT.has(classify(contentOf(r.rawText)).kind));
	const lost = doc.nodes.length - fragment.nodes.length + doc.edges.length - fragment.edges.length;
	return doc.containers.length + raws.length + lost;
}

/**
 * Liest Fremd-Text (Zwischenablage) über den Prüfpfad des Datei-Öffnens: BOM entfernen,
 * Größengrenze `MAX_FILE_BYTES`, Typ-Erkennung, Adapter-`parse` und `validate` (`analyze`).
 * Konfiguration aus Frontmatter/Direktiven wird nicht übernommen. Ungültiger Text ergibt ein
 * Fehlerergebnis; ein Einfügen darf dann nichts ändern.
 */
export async function readFragment(
	text: string,
	adapters: AdapterRegistry = defaultAdapters
): Promise<FragmentRead> {
	const { text: body } = readText(text);
	// UTF-16-Länge <= UTF-8-Bytes: Kurzschluss vor dem Kodieren großer Texte.
	if (body.length > MAX_FILE_BYTES || new TextEncoder().encode(body).length > MAX_FILE_BYTES)
		return { ok: false, reason: 'too-large', errors: [] };
	const analysis = await analyze(body, adapters);
	if (analysis.mode !== 'flowchart') return { ok: false, reason: 'not-flowchart', errors: [] };
	if (!('doc' in analysis)) return { ok: false, reason: 'invalid', errors: analysis.errors };
	const { doc } = analysis;
	const fragment = extract(doc, new Set(doc.nodes.map((n) => n.id)));
	const dropped = droppedCount(doc, fragment);
	if (fragment.nodes.length === 0)
		return { ok: false, reason: dropped > 0 ? 'unsupported' : 'empty', errors: [] };
	return { ok: true, fragment, dropped };
}
