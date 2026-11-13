/** Canvas-Suche (Strg-F): Teilstring in Label oder ID, ohne Groß/Klein, Dokument-Reihenfolge. */
import type { DiagramDocument } from '../../model/types';

export function searchMatches(doc: DiagramDocument, query: string): string[] {
	const q = query.trim().toLowerCase();
	if (q === '') return [];
	const hit = (el: { id: string; label: string }) =>
		el.label.toLowerCase().includes(q) || el.id.toLowerCase().includes(q);
	return [...doc.containers, ...doc.nodes, ...doc.edges].filter(hit).map((el) => el.id);
}
