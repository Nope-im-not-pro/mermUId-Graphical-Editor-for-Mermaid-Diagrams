/**
 * Mini-Markdown-Parser der In-App-Hilfe (T22, O-30): Überschrift, Absatz, Liste, Tabelle,
 * Inline-Code, Code-Block und ```mermaid-Block -> Baum. Reine Funktionen ohne DOM; die
 * Darstellung erzeugt Svelte-Elemente, Text wird nie als HTML gelesen.
 */
export type Inline = { type: 'text'; text: string } | { type: 'code'; text: string };

export type Block =
	| { type: 'heading'; level: number; content: Inline[] }
	| { type: 'paragraph'; content: Inline[] }
	| { type: 'list'; ordered: boolean; items: Inline[][] }
	| { type: 'table'; head: Inline[][]; rows: Inline[][][] }
	| { type: 'code'; lang: string; text: string }
	| { type: 'mermaid'; text: string };

const HEADING = /^ {0,3}(#{1,6})[ \t]+(.*?)(?:[ \t]+#+)?[ \t]*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)/;
const ITEM = /^ {0,3}([-*+]|\d{1,9}[.)])[ \t]+(.*)$/;
const DELIMITER = /^ *\|? *:?-+:? *(\| *:?-+:? *)*\|? *$/;
const ESCAPABLE = /\\([!-/:-@[-`{-~])/g;

const blank = (line: string) => line.trim() === '';

function pushText(out: Inline[], text: string): void {
	if (text === '') return;
	const last = out[out.length - 1];
	if (last?.type === 'text') last.text += text;
	else out.push({ type: 'text', text });
}

/** Text mit Code-Spans (gleich lange Backtick-Folgen); Backslash-Escapes nur außerhalb. */
export function parseInline(source: string): Inline[] {
	const out: Inline[] = [];
	let i = 0;
	while (i < source.length) {
		const start = source.indexOf('`', i);
		if (start === -1) break;
		let run = start;
		while (source[run] === '`') run++;
		const ticks = source.slice(start, run);
		const close = new RegExp(`(?<!\`)${ticks}(?!\`)`, 'g');
		close.lastIndex = run;
		const end = close.exec(source);
		if (!end) {
			pushText(out, source.slice(i, run).replace(ESCAPABLE, '$1'));
			i = run;
			continue;
		}
		pushText(out, source.slice(i, start).replace(ESCAPABLE, '$1'));
		const body = source.slice(run, end.index);
		const trimmed = /^ .*[^ ].* $/s.test(body) ? body.slice(1, -1) : body;
		out.push({ type: 'code', text: trimmed });
		i = end.index + ticks.length;
	}
	pushText(out, source.slice(i).replace(ESCAPABLE, '$1'));
	return out;
}

/** Zellen einer Tabellenzeile; `\|` ist ein Pipe im Zelltext (auch in Code-Spans). */
function cells(line: string): string[] {
	const parts: string[] = [];
	let current = '';
	for (let i = 0; i < line.length; i++) {
		if (line[i] === '\\' && line[i + 1] === '|') {
			current += '|';
			i++;
		} else if (line[i] === '|') {
			parts.push(current);
			current = '';
		} else current += line[i];
	}
	parts.push(current);
	const trimmed = line.trim();
	if (trimmed.startsWith('|')) parts.shift();
	if (trimmed.endsWith('|') && !trimmed.endsWith('\\|')) parts.pop();
	return parts.map((c) => c.trim());
}

function startsBlock(lines: string[], i: number): boolean {
	const line = lines[i];
	return (
		HEADING.test(line) ||
		FENCE.test(line) ||
		ITEM.test(line) ||
		(line.includes('|') && i + 1 < lines.length && DELIMITER.test(lines[i + 1]))
	);
}

/** Zerlegt Markdown in Blöcke (Zeilenenden LF oder CRLF). */
export function parseMarkdown(source: string): Block[] {
	const lines = source.split(/\r?\n/);
	const blocks: Block[] = [];
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		if (blank(line)) {
			i++;
			continue;
		}
		const fence = FENCE.exec(line);
		if (fence) {
			const marker = fence[1];
			const closing = new RegExp(`^ {0,3}${marker[0]}{${marker.length},}[ \\t]*$`);
			const body: string[] = [];
			i++;
			while (i < lines.length && !closing.test(lines[i])) body.push(lines[i++]);
			i++;
			const lang = fence[2];
			const text = body.join('\n');
			blocks.push(lang === 'mermaid' ? { type: 'mermaid', text } : { type: 'code', lang, text });
			continue;
		}
		const heading = HEADING.exec(line);
		if (heading) {
			blocks.push({ type: 'heading', level: heading[1].length, content: parseInline(heading[2]) });
			i++;
			continue;
		}
		if (line.includes('|') && i + 1 < lines.length && DELIMITER.test(lines[i + 1])) {
			const head = cells(line);
			const rows: Inline[][][] = [];
			i += 2;
			while (i < lines.length && lines[i].includes('|') && !blank(lines[i])) {
				const row = cells(lines[i++]);
				rows.push(head.map((_, c) => parseInline(row[c] ?? '')));
			}
			blocks.push({ type: 'table', head: head.map((c) => parseInline(c)), rows });
			continue;
		}
		const item = ITEM.exec(line);
		if (item) {
			const ordered = /\d/.test(item[1]);
			const items: string[] = [];
			while (i < lines.length) {
				const next = ITEM.exec(lines[i]);
				if (next) {
					if (/\d/.test(next[1]) !== ordered) break;
					items.push(next[2].trim());
				} else if (!blank(lines[i]) && /^\s/.test(lines[i]) && !startsBlock(lines, i)) {
					items[items.length - 1] += ` ${lines[i].trim()}`;
				} else break;
				i++;
			}
			blocks.push({ type: 'list', ordered, items: items.map((t) => parseInline(t)) });
			continue;
		}
		const para: string[] = [];
		while (i < lines.length && !blank(lines[i]) && (para.length === 0 || !startsBlock(lines, i))) {
			para.push(lines[i++].trim());
		}
		blocks.push({ type: 'paragraph', content: parseInline(para.join(' ')) });
	}
	return blocks;
}

/** Inhalte aller ```mermaid-Blöcke in Dokument-Reihenfolge. */
export function mermaidBlocks(blocks: readonly Block[]): string[] {
	return blocks.flatMap((b) => (b.type === 'mermaid' ? [b.text] : []));
}
