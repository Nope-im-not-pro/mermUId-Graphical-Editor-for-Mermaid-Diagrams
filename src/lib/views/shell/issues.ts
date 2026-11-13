/**
 * Modell-Befunde der Fehlerliste je Modellstand genau einmal (T123 C3, V-24). Befundtexte kommen
 * aus msg(): ein Sprachwechsel gilt als neuer Stand.
 */
import type { DiagramDocument } from '../../model/types';
import { validateModel, type ModelIssue } from '../../services/validator';

export function createIssues(validate = validateModel) {
	let last: { doc: DiagramDocument; locale: string; issues: ModelIssue[] } | null = null;
	return (doc: DiagramDocument, locale: string): ModelIssue[] => {
		if (last?.doc !== doc || last.locale !== locale) last = { doc, locale, issues: validate(doc) };
		return last.issues;
	};
}
