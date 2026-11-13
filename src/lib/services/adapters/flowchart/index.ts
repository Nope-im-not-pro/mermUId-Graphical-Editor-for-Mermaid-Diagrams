/**
 * Flowchart-Adapter (T10): Parser, Serializer, Validierung (O-15).
 * Unterstützte Untermenge und RawBlock-Verhalten: SUBSET.md.
 */
import type { DiagramAdapter, DiagramDocument } from '../../../model/types';
import { msg } from '../../i18n';
import { parse } from './parser';
import { serialize } from './serializer';
import { classify, contentOf, unclosedString } from './syntax';
import { validate } from './validate';

export { parse, serialize, validate };

export const flowchartAdapter: DiagramAdapter = {
	type: 'flowchart',
	parse,
	serialize,
	getDirection,
	warnings
};

/**
 * Hinweise zum geparsten Dokument (O-46): je RawBlock mit bis zum Dateiende offenem String
 * eine Meldung `services.flowchart.unclosedString` mit Startzeile (1-basiert im Quelltext,
 * den der Serializer byte-gleich wiederherstellt) und Text der ersten Zeile.
 */
export function warnings(doc: DiagramDocument): string[] {
	const open = doc.rawBlocks.filter((block) => unclosedString(block.rawText));
	if (open.length === 0) return [];
	const text = serialize(doc);
	return open.map((block) => {
		const line = text.slice(0, text.lastIndexOf(block.rawText)).split('\n').length;
		const first = block.rawText.split(/\r?\n/)[0].trim();
		return msg('services.flowchart.unclosedString', { line, text: first });
	});
}

/** Pfeil-Kurzformen der Deklaration auf Buchstaben-Richtungen (mermaid-Lexer). */
const ARROWS: Record<string, string> = { '>': 'LR', '<': 'RL', '^': 'BT', v: 'TB' };

/** Richtung der Deklarationszeile (`TD`, `LR`, ...); leer, wenn keine angegeben ist. */
export function getDirection(doc: DiagramDocument): string {
	for (const block of doc.rawBlocks) {
		const st = classify(contentOf(block.rawText));
		if (st.kind === 'decl') return ARROWS[st.direction] ?? st.direction;
	}
	return '';
}
