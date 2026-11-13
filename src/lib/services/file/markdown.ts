// Datei-Service, Kern `.md` (KONZEPT §9, D-17 a): reine Funktionen ohne DOM (O-18).
//
// Fence-Erkennung nach CommonMark 0.31 (Abschnitt 4.5), Grenzen:
// - Erkannt: Fences aus mindestens 3 Backticks oder Tilden, eingerückt mit 0 bis 3
//   Leerzeichen; Info-String mit Zusatz (`mermaid title="x"`), erstes Wort genau `mermaid`
//   (Groß-/Kleinschreibung zählt). Backtick-Fences mit Backtick im Info-String sind keine
//   Fence. Schließ-Fence: gleiches Zeichen, mindestens gleiche Länge, bis 3 Leerzeichen
//   Einrückung, danach nur Leerzeichen/Tabs. Ohne Schließ-Fence reicht der Block bis zum
//   Dokumentende. Andere Fences werden mitgeführt, damit Beispiele in ihnen nicht zählen.
// - Nicht ausgewertet: Fences in Containern (Blockquote `>`, Listeneinträge), Einrückung mit
//   Tab, HTML-Blöcke und eingerückte Code-Blöcke als Hülle um Fence-Zeilen.
import { msg } from '../i18n';
import { detectLineEnding, readText, type LineEnding } from './text';

export interface MermaidBlock {
	/** Laufende Nummer unter den Mermaid-Blöcken, ab 0. */
	index: number;
	/** Offset der öffnenden Fence-Zeile. */
	start: number;
	/** Offset des ersten Inhaltszeichens (nach dem Zeilenende der öffnenden Zeile). */
	contentStart: number;
	/** Offset nach dem Inhalt (Beginn der Schließ-Zeile bzw. Dokumentende). */
	contentEnd: number;
	/** Offset nach der Schließ-Zeile inkl. Zeilenende bzw. Dokumentende. */
	end: number;
	/** Fence-Zeichenfolge der öffnenden Zeile, z. B. "```" oder "~~~~". */
	fence: string;
	/** Info-String ohne Rand-Leerraum. */
	info: string;
	/** Einrückung der öffnenden Fence in Leerzeichen (0 bis 3). */
	indent: number;
	closed: boolean;
	/** Mermaid-Code: Einrückung entfernt, Zeilenenden LF, ohne letztes Zeilenende. */
	code: string;
}

interface Line {
	start: number;
	/** Ende ohne Zeilenende. */
	end: number;
	/** Beginn der nächsten Zeile. */
	next: number;
	text: string;
	terminator: string;
}

function splitLines(text: string): Line[] {
	const lines: Line[] = [];
	let start = 0;
	while (start < text.length) {
		const nl = text.indexOf('\n', start);
		const next = nl === -1 ? text.length : nl + 1;
		let end = nl === -1 ? text.length : nl;
		if (nl !== -1 && end > start && text.charCodeAt(end - 1) === 13) end--;
		lines.push({
			start,
			end,
			next,
			text: text.slice(start, end),
			terminator: text.slice(end, next)
		});
		start = next;
	}
	return lines;
}

const OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/;
const CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** Findet alle Mermaid-Fences in `markdown`. */
export function findMermaidBlocks(markdown: string): MermaidBlock[] {
	const lines = splitLines(markdown);
	const blocks: MermaidBlock[] = [];
	let i = 0;
	while (i < lines.length) {
		const open = OPEN.exec(lines[i].text);
		if (!open || (open[2][0] === '`' && open[3].includes('`'))) {
			i++;
			continue;
		}
		const [, indentStr, fence, rest] = open;
		const info = rest.trim();
		let close = i + 1;
		while (close < lines.length) {
			const c = CLOSE.exec(lines[close].text);
			if (c && c[1][0] === fence[0] && c[1].length >= fence.length) break;
			close++;
		}
		const closed = close < lines.length;
		if (info.split(/[ \t]/)[0] === 'mermaid') {
			const contentStart = lines[i].next;
			const contentEnd = closed ? lines[close].start : markdown.length;
			const indent = indentStr.length;
			blocks.push({
				index: blocks.length,
				start: lines[i].start,
				contentStart,
				contentEnd,
				end: closed ? lines[close].next : markdown.length,
				fence,
				info,
				indent,
				closed,
				code: lines
					.slice(i + 1, close)
					.map((l) => dedent(l.text, indent))
					.join('\n')
			});
		}
		i = close + 1;
	}
	return blocks;
}

/** Entfernt bis zu `n` führende Leerzeichen (CommonMark 4.5). */
function dedent(line: string, n: number): string {
	let k = 0;
	while (k < n && line[k] === ' ') k++;
	return line.slice(k);
}

/** Zeilenende für einen Block: das der Datei; bei gemischter Datei das der öffnenden Zeile. */
function blockEol(markdown: string, block: MermaidBlock): string {
	const ending: LineEnding = detectLineEnding(markdown);
	if (ending === 'crlf') return '\r\n';
	if (ending === 'mixed') {
		return markdown.slice(block.start, block.contentStart).endsWith('\r\n') ? '\r\n' : '\n';
	}
	return '\n';
}

/**
 * Ersetzt den Inhalt des Mermaid-Blocks `index`; alles außerhalb des Blocks bleibt byte-gleich.
 * `code` hat dieselbe Form wie `MermaidBlock.code`: Zeilen ohne letztes Zeilenende, eine
 * abschließende Leerzeile ist also `"…\n"`. Unveränderter Code lässt das Dokument unverändert.
 * Der neue Code wird mit der Einrückung der Fence versehen, seine Zeilenenden folgen der Datei.
 *
 * Enthält der neue Code eine Zeile, die den Block schließen würde (gleiches Fence-Zeichen,
 * mindestens Fence-Länge, CommonMark 4.5), werden öffnende und ggf. schließende Fence auf
 * längste solche Zeile + 1 verlängert. Entscheidung: Verlängern statt Fehler, weil damit jeder
 * Code speicherbar bleibt, der Block exakt den neuen Code liefert und außer den Fence-Zeichen
 * nichts geändert wird; ein offener Block am Dokumentende bleibt offen.
 */
export function replaceMermaidBlock(markdown: string, index: number, code: string): string {
	const block = findMermaidBlocks(markdown)[index];
	if (!block) throw new RangeError(msg('services.file.blockMissing', { index }));
	if (code === block.code) return markdown;
	const eol = blockEol(markdown, block);
	const pad = ' '.repeat(block.indent);
	const lines = code === '' ? [] : code.split(/\r?\n/).map((l) => (l === '' ? l : pad + l));
	const opening = markdown.slice(block.start, block.contentStart);
	const openHasEol = opening.endsWith('\n');
	const oldContent = markdown.slice(block.contentStart, block.contentEnd);
	// Endet der neue Code mit einer Leerzeile, braucht auch ein offener Block das Zeilenende,
	// sonst fällt diese Leerzeile beim erneuten Lesen weg.
	const trailing =
		block.closed ||
		oldContent.endsWith('\n') ||
		(oldContent === '' && openHasEol) ||
		lines.at(-1) === '';
	let content = lines.join(eol);
	if (lines.length > 0 && trailing) content += eol;
	// Öffnende Fence als letzte Zeile ohne Zeilenende: Umbruch vor dem neuen Inhalt nötig.
	const lead = lines.length > 0 && !openHasEol ? eol : '';

	let longest = 0;
	for (const line of lines) {
		const c = CLOSE.exec(line);
		if (c && c[1][0] === block.fence[0] && c[1].length >= block.fence.length) {
			longest = Math.max(longest, c[1].length);
		}
	}
	const fence = longest > 0 ? block.fence[0].repeat(longest + 1) : block.fence;
	const grow = (fenceLine: string) => fenceLine.replace(block.fence, fence);

	return (
		markdown.slice(0, block.start) +
		grow(opening) +
		lead +
		content +
		grow(markdown.slice(block.contentEnd, block.end)) +
		markdown.slice(block.end)
	);
}

/** Auswahl nach D-17 (a): Kennzeichen "Auswahl nötig" nur bei mehr als einem Block. */
export interface BlockSelection {
	count: number;
	needsSelection: boolean;
	/** Zu bearbeitender Block ohne Auswahl-Dialog; `null` bei 0 Blöcken oder Auswahl nötig. */
	defaultIndex: number | null;
}

export function planBlockSelection(blocks: readonly MermaidBlock[]): BlockSelection {
	const count = blocks.length;
	return { count, needsSelection: count > 1, defaultIndex: count === 1 ? 0 : null };
}

export interface MarkdownDocument {
	text: string;
	lineEnding: LineEnding;
	hadBom: boolean;
	blocks: MermaidBlock[];
	selection: BlockSelection;
}

/** Liest eine `.md`-Datei: BOM entfernen, Zeilenende erkennen, Mermaid-Blöcke finden. */
export function readMarkdown(input: string | Uint8Array): MarkdownDocument {
	const doc = readText(input);
	const blocks = findMermaidBlocks(doc.text);
	return { ...doc, blocks, selection: planBlockSelection(blocks) };
}
