/**
 * Fehlerliste (T19 C3): reine Logik ohne DOM. Parser- und Validierungsfehler des Codes
 * (`SyncState.errors`) springen zur Code-Zeile, Modell-Befunde zum Element.
 */
import type { DiagramDocument, ParseError } from '../../model/types';
import type { ModelIssue } from '../../services/validator';
import type { MessageKey, Params } from '../../services/i18n';
import { t } from '../shell/i18n.svelte';

export type JumpTarget =
	| { readonly type: 'line'; readonly line: number; readonly column: number }
	| { readonly type: 'element'; readonly id: string };

export interface ErrorEntry {
	readonly key: string;
	readonly source: 'code' | 'model';
	readonly severity: 'error' | 'hint';
	readonly text: string;
	/** Unveränderte Parser-Meldung für "Details"; fehlt bei einfachen Fehlern. */
	readonly raw?: string;
	/** `null`: kein Sprungziel (z. B. unbekannte Klasse ohne Element). */
	readonly target: JumpTarget | null;
}

/** Struktur der Validate-Diagnose (O-116 a); Adapter-Import bleibt dem Sync vorbehalten. */
interface Diagnostic extends ParseError {
	readonly key: MessageKey;
	readonly params: Params;
	readonly raw: string;
}

function isDiagnostic(e: ParseError): e is Diagnostic {
	const d = e as Partial<Diagnostic>;
	return typeof d.key === 'string' && typeof d.raw === 'string';
}

/** Kurztext in der aktuellen Sprache (Diagnose), sonst die fertige Meldung. */
function shortText(e: ParseError): string {
	return isDiagnostic(e) ? t(e.key, e.params) : e.message;
}

function exists(doc: DiagramDocument, id: string): boolean {
	return [doc.nodes, doc.edges, doc.containers].some((list) => list.some((e) => e.id === id));
}

/**
 * Einträge in Anzeige-Reihenfolge: Code-Fehler nach Zeile/Spalte, danach Modell-Fehler,
 * zuletzt Hinweise. Ohne `doc` gilt jede Element-ID als Sprungziel.
 */
export function errorEntries(
	errors: readonly ParseError[],
	issues: readonly ModelIssue[] = [],
	doc?: DiagramDocument
): ErrorEntry[] {
	const code = [...errors]
		.sort((a, b) => a.line - b.line || a.column - b.column)
		.map((e, i): ErrorEntry => ({
			key: `code:${i}`,
			source: 'code',
			severity: 'error',
			text: t('panels.errors.position', { line: e.line, column: e.column, message: shortText(e) }),
			...(isDiagnostic(e) && e.raw ? { raw: e.raw } : {}),
			target: { type: 'line', line: e.line, column: e.column }
		}));
	const model = [...issues]
		.sort((a, b) => Number(a.severity === 'hint') - Number(b.severity === 'hint'))
		.map((m, i): ErrorEntry => ({
			key: `model:${i}`,
			source: 'model',
			severity: m.severity,
			text: `${m.elementId}: ${m.message}`,
			target: !doc || exists(doc, m.elementId) ? { type: 'element', id: m.elementId } : null
		}));
	return [...code, ...model];
}
