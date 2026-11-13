/**
 * Asynchrone Validierung über `mermaid.parse` (O-15, N-01: nur Paket-Einstieg). mermaid entfernt
 * vor dem Parsen Frontmatter, Direktiven und Kommentarzeilen; die gemeldete Zeile bezieht sich auf
 * diesen bereinigten Text und wird auf die Originalzeile zurückgerechnet.
 */
import { msg } from '../../i18n';
import type { ParseError } from '../../../model/types';
import { diagnose, reportedColumn, reportedLine } from '../diagnostics';
import { parse } from './parser';

/** Text mit Originalzeile je Zeichen. */
interface Mapped {
	text: string;
	lines: number[];
}

/** mermaid preprocess: `directiveRegex` und `cleanupComments` (mermaid.core). */
const DIRECTIVE = /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi;
const COMMENT = /^\s*%%(?!{)[^\n]+\n?/gm;
const WS = /\s/;

function normalize(text: string): Mapped {
	let out = '';
	const lines: number[] = [];
	let line = 1;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '\r' && text[i + 1] === '\n') continue;
		out += ch === '\r' ? '\n' : ch;
		lines.push(line);
		if (ch === '\n' || ch === '\r') line++;
	}
	return { text: out, lines };
}

function cut(src: Mapped, from: number, to: number): Mapped {
	return {
		text: src.text.slice(0, from) + src.text.slice(to),
		lines: src.lines.slice(0, from).concat(src.lines.slice(to))
	};
}

function strip(src: Mapped, re: RegExp): Mapped {
	let text = '';
	const lines: number[] = [];
	let last = 0;
	for (const m of src.text.matchAll(re)) {
		text += src.text.slice(last, m.index);
		for (let i = last; i < m.index; i++) lines.push(src.lines[i]);
		last = m.index + m[0].length;
	}
	for (let i = last; i < src.lines.length; i++) lines.push(src.lines[i]);
	return { text: text + src.text.slice(last), lines };
}

/** Länge des Frontmatter-Präfixes, das mermaid entfernt (Port von `matchFrontMatter`). */
function frontmatterLength(text: string): number {
	let cursor = 0;
	while (cursor < text.length && WS.test(text[cursor]) && text[cursor] !== '\n') cursor++;
	if (!text.startsWith('---', cursor)) return 0;
	const lastBreak = (from: number) => {
		let index = -1;
		for (let i = from; i < text.length && WS.test(text[i]); i++) if (text[i] === '\n') index = i;
		return index;
	};
	const opening = text.indexOf('\n', cursor + 3);
	if (opening < 0 || lastBreak(cursor + 3) < 0) return 0;
	const fence = `${text.slice(0, cursor)}---`;
	for (let i = opening + 1; i < text.length; i++) {
		if (text[i] !== '\n' || !text.startsWith(fence, i + 1)) continue;
		const end = lastBreak(i + 1 + fence.length);
		if (end >= 0) return end + 1;
	}
	return 0;
}

/** Originalzeile zu Zeile `n` des von mermaid bereinigten Texts. */
function originLine(text: string, n: number): number {
	let src = normalize(text);
	src = cut(src, 0, frontmatterLength(src.text));
	src = strip(strip(src, DIRECTIVE), COMMENT);
	src = cut(src, 0, src.text.length - src.text.trimStart().length);
	let line = 1;
	for (let i = 0; i < src.text.length; i++) {
		if (line === n) return src.lines[i];
		if (src.text[i] === '\n') line++;
	}
	return (src.lines.at(-1) ?? 1) + n - line + (src.text.endsWith('\n') ? 1 : 0);
}

export async function validate(text: string): Promise<ParseError[]> {
	const { default: mermaid } = await import('mermaid');
	try {
		const result = await mermaid.parse(text);
		if (result && !result.diagramType.startsWith('flowchart')) {
			return [
				{
					line: 1,
					column: 1,
					message: msg('services.validate.notFlowchart', { type: result.diagramType })
				}
			];
		}
		return [];
	} catch (e) {
		const reported = reportedLine(e);
		const own = Number.isInteger(reported) ? undefined : parse(text);
		const line = !own ? originLine(text, reported) : own.ok ? 1 : own.errors[0].line;
		return [diagnose(e, line, reportedColumn(e))];
	}
}
