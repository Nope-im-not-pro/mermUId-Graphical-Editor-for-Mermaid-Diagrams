/**
 * Verständliche Parser-Fehler (V-18): bildet die Rohmeldung von `mermaid.parse` (jison-Fehler mit
 * `hash.token`/`hash.expected`) auf einen übersetzten Kurztext ohne interne Token-Namen ab. Der
 * Rohtext bleibt in `raw` für die Anzeige hinter "Details" erhalten.
 */
import { msg, type MessageKey, type Params } from '../i18n';
import type { ParseError } from '../../model/types';

/** Validierungsfehler mit Kurztext-Schlüssel; `message` ist `msg(key, params)`. */
export interface Diagnostic extends ParseError {
	readonly key: MessageKey;
	readonly params: Params;
	/** Unveränderte mermaid-Meldung. */
	readonly raw: string;
}

interface JisonHash {
	token?: unknown;
	text?: unknown;
	expected?: unknown;
	loc?: { first_line?: number; first_column?: number };
}

/** Schließende Klammer-Token der flowchart-Grammatik (mermaid 12). */
const CLOSERS = new Set([
	'SQE',
	'PE',
	'DIAMOND_STOP',
	'STADIUMEND',
	'SUBROUTINEEND',
	'CYLINDEREND',
	'DOUBLECIRCLEEND',
	'TRAPEND',
	'INVTRAPEND',
	'-)'
]);
/** Längster Nutzertext, der im Kurztext zitiert wird. */
const QUOTE_MAX = 20;

function hashOf(e: unknown): JisonHash | undefined {
	const hash = (e as { hash?: unknown } | null | undefined)?.hash;
	return hash && typeof hash === 'object' ? (hash as JisonHash) : undefined;
}

function rawOf(e: unknown): string {
	const message = (e as { message?: unknown } | null | undefined)?.message;
	return typeof message === 'string' ? message : String(e);
}

/** Von mermaid gemeldete Zeile (1-basiert, im bereinigten Text); `NaN`, wenn keine vorliegt. */
export function reportedLine(e: unknown): number {
	const line = hashOf(e)?.loc?.first_line;
	if (typeof line === 'number') return line;
	return Number(/on line (\d+)/.exec(rawOf(e))?.[1] ?? NaN);
}

/** Von mermaid gemeldete Spalte (1-basiert); 1, wenn keine vorliegt. */
export function reportedColumn(e: unknown): number {
	return (hashOf(e)?.loc?.first_column ?? 0) + 1;
}

function classify(e: unknown, raw: string): { key: MessageKey; params?: Params } {
	if (raw.startsWith('Lexical error')) return { key: 'services.validate.unrecognized' };
	const hash = hashOf(e);
	if (!hash || !Array.isArray(hash.expected)) return { key: 'services.validate.generic' };
	const expected = new Set(hash.expected.map((x) => String(x).replace(/^'|'$/g, '')));
	const token = hash.token;
	const eof = token === 1 || token === 'EOF';
	if (typeof token === 'string' && CLOSERS.has(token))
		return { key: 'services.validate.bracketMismatch' };
	if ([...expected].some((x) => CLOSERS.has(x)))
		return { key: 'services.validate.unclosedBracket' };
	if (eof && expected.has('end')) return { key: 'services.syntax.blockOpen' };
	if (token === 'end' && !expected.has('end')) return { key: 'services.syntax.endWithoutBlock' };
	if (expected.has('TXT') && expected.size === 1) return { key: 'services.validate.missingText' };
	if (eof) return { key: 'services.validate.unexpectedEof' };
	if (token === 'NEWLINE') return { key: 'services.validate.unexpectedLineEnd' };
	const text = typeof hash.text === 'string' ? hash.text.trim() : '';
	if (text && text.length <= QUOTE_MAX && !text.includes('\n'))
		return { key: 'services.validate.unexpectedToken', params: { text } };
	return { key: 'services.validate.generic' };
}

function position(n: number): number {
	return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

/** Fehlerobjekt von `mermaid.parse` als Diagnose an Zeile/Spalte des Originaltexts. */
export function diagnose(e: unknown, line: number, column: number): Diagnostic {
	const raw = rawOf(e);
	const { key, params = {} } = classify(e, raw);
	return {
		line: position(line),
		column: position(column),
		message: msg(key, params),
		key,
		params,
		raw
	};
}
