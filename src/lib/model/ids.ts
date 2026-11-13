/**
 * ID-Zähler für Editor-IDs (`n1`, `e1`, `c1`) nach D-03 (DECISION W00, D2, Variante A).
 *
 * Der Zähler-Zustand liegt bewusst außerhalb von `DiagramDocument`: Ein Undo stellt nur
 * Dokument-Snapshots wieder her, der Zähler bleibt monoton (Auflage b). Persistenz in der
 * Metadaten-Zeile ist Sache von T12; hier nur Lesen (`initCounters`) und Fortschreiben.
 */
import type { DiagramDocument } from './types';

export type IdPrefix = 'n' | 'e' | 'c';

/** Je Präfix die nächste zu vergebende Zahl. */
export type IdCounters = Readonly<Record<IdPrefix, number>>;

const PREFIXES: readonly IdPrefix[] = ['n', 'e', 'c'];
const EDITOR_ID = /^([nec])([1-9]\d*)$/;

function storedValue(value: unknown): number {
	return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : 0;
}

/**
 * Startwert je Präfix = `max(Zähler aus Zeile, max(Suffix aller IDs im Editor-Muster) + 1)`.
 * Fehlendes oder ungültiges Zählerfeld zählt als 0. Gescannt werden alle Element-IDs
 * (auch Nutzer-IDs im Editor-Muster), da Mermaid einen gemeinsamen ID-Raum hat.
 */
export function initCounters(
	doc: DiagramDocument,
	stored: Partial<Record<IdPrefix, unknown>> = {}
): IdCounters {
	const max: Record<IdPrefix, number> = { n: 0, e: 0, c: 0 };
	const ids = [doc.nodes, doc.edges, doc.containers, doc.rawBlocks, doc.comments].flatMap((list) =>
		list.map((el) => el.id)
	);
	for (const id of ids) {
		const match = EDITOR_ID.exec(id);
		if (match) {
			const prefix = match[1] as IdPrefix;
			max[prefix] = Math.max(max[prefix], Number(match[2]));
		}
	}
	const result = {} as Record<IdPrefix, number>;
	for (const prefix of PREFIXES) {
		result[prefix] = Math.max(storedValue(stored[prefix]), max[prefix] + 1);
	}
	return result;
}

/** Liefert die nächste ID und den fortgeschriebenen Zähler; Eingabe bleibt unverändert. */
export function nextId(
	counters: IdCounters,
	prefix: IdPrefix
): { id: string; counters: IdCounters } {
	const value = counters[prefix];
	return { id: `${prefix}${value}`, counters: { ...counters, [prefix]: value + 1 } };
}
