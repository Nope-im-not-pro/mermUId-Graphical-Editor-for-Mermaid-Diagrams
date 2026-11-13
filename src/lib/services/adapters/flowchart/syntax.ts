/**
 * Flowchart-Syntax: Zerlegung in Anweisungs-Stücke und Klassifikation einzelner Anweisungen.
 * Reine Funktionen ohne DOM; gemeinsam genutzt von Parser und Serializer (PARSER_ABDECKUNG §4).
 */
import type { StyleMap } from '../../../model/types';

/** Ein Anweisungs-Stück: `text` ist der exakte Quelltext (inkl. Einrückung und Zeilenende). */
export interface Piece {
	text: string;
	content: string;
	line: number;
}

export interface NodeRef {
	id: string;
	shape: string | null;
	label: string | null;
	classes: string[];
	text: string;
	/** Inhalts-Positionen `[von, bis)` von ID und Form (ohne `:::`-Klassen), für Edits in place. */
	span?: [number, number];
}

export interface LinkInfo {
	explicitId: string | null;
	lineStyle: string;
	arrowHead: string;
	length: number;
	label: string;
}

export type Stmt =
	| { kind: 'blank' }
	| { kind: 'comment' }
	| { kind: 'directive' }
	| { kind: 'decl'; keyword: string; direction: string }
	| { kind: 'subgraph'; id: string | null; label: string }
	| { kind: 'end' }
	| { kind: 'direction'; direction: string }
	| { kind: 'classDef'; names: string[]; style: StyleMap }
	| { kind: 'class'; ids: string[]; cls: string }
	| { kind: 'style'; id: string; style: StyleMap }
	| { kind: 'linkStyle'; indices: number[]; style: StyleMap }
	| { kind: 'click'; id: string; text: string }
	| { kind: 'graph'; groups: NodeRef[][]; links: LinkInfo[] }
	| { kind: 'raw' };

/** Richtungs-Token nach Mermaid-Grammatik. */
const DIRECTION = '(?:TB|TD|BT|RL|LR|<|>|\\^|v)';
const DECL = new RegExp(`^(flowchart-elk|flowchart|graph)(?:\\s+(${DIRECTION}))?$`);
const ID_CHAR = 'A-Za-z0-9_\\u00C0-\\uFFFF';
const NODE_ID = new RegExp(`[${ID_CHAR}](?:[${ID_CHAR}.]|-(?=[${ID_CHAR}]))*`, 'y');
const EDGE_ID = new RegExp(`([${ID_CHAR}]+)@(?=[-=~<ox])`, 'y');
/** Kanten-ID direkt nach `@{...}` (mermaid: Parse-Fehler). */
const META_EDGE_ID = new RegExp(`^\\s*[${ID_CHAR}]+@(?=[-=~<ox])`);
const HEAD = '(?:>|[ox])';
const LINK = new RegExp(
	`([<ox])?(-{2,}${HEAD}|-{3,}|={2,}${HEAD}|={3,}|-\\.+-${HEAD}?|~{3,})`,
	'y'
);
const TEXT_START = /([<ox])?(--|==|-\.)(?![->=.])/y;
/** Kantentext-Ende je Start-Token: Lauf-Zeichen und sticky Muster ab Laufbeginn. */
const TEXT_END: Record<string, [string, RegExp]> = {
	'--': ['-', new RegExp(`-{2,}${HEAD}|-{3,}`, 'y')],
	'==': ['=', new RegExp(`={2,}${HEAD}|={3,}`, 'y')],
	'-.': ['.', new RegExp(`\\.+-${HEAD}?`, 'y')]
};

/** Erstes Kantentext-Ende ab `from` (linearer Scan über Laufanfänge). */
function findTextEnd(s: string, from: number, start: string): { at: number; token: string } | null {
	const [ch, re] = TEXT_END[start];
	for (let i = from; i < s.length; i++) {
		if (s[i] !== ch || (i > from && s[i - 1] === ch)) continue;
		re.lastIndex = i;
		const m = re.exec(s);
		if (m) return { at: i, token: m[0] };
	}
	return null;
}

/** Öffner, Schließer, Formname (Mermaid-db-Typ); längste Öffner zuerst. */
export const SHAPES: readonly [string, string, string][] = [
	['(((', ')))', 'doublecircle'],
	['((', '))', 'circle'],
	['([', '])', 'stadium'],
	['[[', ']]', 'subroutine'],
	['[(', ')]', 'cylinder'],
	['[/', '/]', 'lean_right'],
	['[/', '\\]', 'trapezoid'],
	['[\\', '\\]', 'lean_left'],
	['[\\', '/]', 'inv_trapezoid'],
	['{{', '}}', 'hexagon'],
	['(', ')', 'round'],
	['[', ']', 'square'],
	['{', '}', 'diamond'],
	['>', ']', 'odd']
];

/**
 * Formen über `A@{ shape: ... }` (F-07): kanonischer Kurzname (mermaid `shortName`) und weitere
 * Aliase, wörtlich aus mermaid 12.2.0 `rendering-elements/shapes.ts` (`shapesDefs`).
 */
export const META_SHAPES: Readonly<Record<string, readonly string[]>> = {
	doc: ['document'],
	delay: ['half-rounded-rectangle'],
	'sl-rect': ['manual-input', 'sloped-rectangle'],
	'h-cyl': ['das', 'horizontal-cylinder'],
	'lin-cyl': ['disk', 'lined-cylinder']
};

const META_ALIAS = new Map(
	Object.entries(META_SHAPES).flatMap(([name, aliases]) =>
		[name, ...aliases].map((alias) => [alias, name] as const)
	)
);

/**
 * Ungequotete Werte, die js-yaml (mermaid) als Nicht-String lesen könnte (`~`, Zahlen jeder
 * Schreibweise, `.inf`, null/true/false in jeder Schreibweise): bewusst weiter gefasst, RawBlock.
 */
const YAML_NON_STRING = /^(?:[+.0-9~]|(?:null|true|false)$)/i;
const PLAIN = /^[^\s"'#,:{}[\]&*!|>%@`?-][^"'#,:{}[\]]*$/;

/**
 * Wert eines `@{}`-Eintrags wie js-yaml nach mermaids Lexer: `"..."` (Zeilenumbruch samt Einzug
 * wird ein Umbruch, nur `\\` und `\n` als Escape, `#quot;` wie im Klammer-Label), `'...'` (`''` = `'`) oder
 * ein einfacher ungequoteter String. Sonst `null` (nicht modelliert).
 */
function metaValue(raw: string): string | null {
	if (raw.startsWith('"')) {
		const m = /^"([^"]*)"$/.exec(raw);
		if (!m || /\\/.test(m[1].replace(/\\[\\n]/g, ''))) return null;
		const folded = m[1].replace(/\n\s*/g, '\n');
		return decodeQuoted(folded.replace(/\\([\\n])/g, (_, c) => (c === 'n' ? '\n' : '\\')));
	}
	if (raw.startsWith("'")) {
		const m = /^'((?:[^'\n]|'')*)'$/.exec(raw);
		return m ? m[1].replaceAll("''", "'") : null;
	}
	return PLAIN.test(raw) && !YAML_NON_STRING.test(raw) ? raw : null;
}

/** Einträge an `,` außerhalb von Anführungszeichen; `null` bei offenem String. */
function metaEntries(body: string): string[] | null {
	const out: string[] = [];
	let quote = '';
	let start = 0;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (quote) {
			if (ch === quote) quote = '';
		} else if (ch === '"' || ch === "'") quote = ch;
		else if (ch === ',') {
			out.push(body.slice(start, i));
			start = i + 1;
		}
	}
	if (quote) return null;
	out.push(body.slice(start));
	return out;
}

/**
 * Liest `@{ ... }` ab `c.pos` (vor `@`). Modelliert nur Metadaten aus `shape` (eine der
 * `META_SHAPES`) und optional `label`, je einmal, einzeilig außerhalb von Strings; alles andere
 * liefert `null` (Anweisung bleibt RawBlock, wie bisher).
 */
function readMeta(c: Cursor): { shape: string; label: string | null } | null {
	if (!c.s.startsWith('@{', c.pos)) return null;
	let end = c.pos + 2;
	while (end < c.s.length && c.s[end] !== '}') {
		const ch = c.s[end];
		if (ch === '^' || ch === '\n') return null;
		if (ch === '"') {
			end = c.s.indexOf('"', end + 1);
			if (end < 0) return null;
		}
		end++;
	}
	if (end >= c.s.length) return null;
	const entries = metaEntries(c.s.slice(c.pos + 2, end));
	if (!entries) return null;
	const found: Record<string, string> = {};
	for (const entry of entries) {
		const m = /^\s*(shape|label):\s+(\S[\s\S]*?)\s*$/.exec(entry);
		if (!m || m[1] in found) return null;
		const value = metaValue(m[2]);
		if (value === null) return null;
		found[m[1]] = value;
	}
	const shape = META_ALIAS.get(found.shape);
	if (!shape) return null;
	c.pos = end + 1;
	return { shape, label: found.label ? found.label : null };
}

const LINE_STYLE: Record<string, string> = {
	'-': 'solid',
	'=': 'thick',
	'.': 'dotted',
	'~': 'invisible'
};
const HEAD_NAME: Record<string, string> = { '>': 'arrow', o: 'circle', x: 'cross' };

function unquote(s: string): string {
	return s.length >= 2 && s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s;
}

/** Gegenstück zu `quote` im Serializer: dieser schreibt `"` in Anführungszeichen als `#quot;`. */
function decodeQuoted(inner: string): string {
	return inner.replaceAll('#quot;', '"');
}

/** Gequoteter Text ohne Anführungszeichen, getrimmt wie mermaid (`text.trim()` in der DB). */
function stripQuotes(s: string): string {
	const inner = unquote(s);
	return inner === s ? s : decodeQuoted(inner).trim();
}

/** Zeilenende-Stil eines Texts: CRLF, sobald irgendwo `\r\n` vorkommt. */
export function eolOf(text: string): string {
	return text.includes('\r\n') ? '\r\n' : '\n';
}

/** Zerlegt Text in physische Zeilen inkl. Zeilenende. */
export function splitLines(text: string): string[] {
	return text.match(/[^\n]*\n|[^\n]+$/g) ?? [];
}

/**
 * mermaid `directiveRegex` (12.2.0, `diagram-api/regexes.ts`) wörtlich: `\w+` nach `%%{`,
 * mehrzeilig, `}%%` optional. mermaid entfernt Direktiven im ganzen Dokument; hier wirkt die
 * Entfernung je Stück (ein offenes `%%{` reicht bis zum Stück-Ende, nicht bis zum Dateiende).
 */
const DIRECTIVE = /%{2}{\s*(?:(\w+)\s*:|(\w+))\s*(?:(\w+)|((?:(?!}%{2}).|\r?\n)*))?\s*(?:}%{2})?/gi;
/** `accTitle:`/`accDescr:` verbrauchen die Zeile, `accDescr {` reicht bis `}` (mermaid-Lexer). */
const ACC = /^acc(?:Title\s*:|Descr\s*[:{])/;
const ACC_BLOCK = /^accDescr\s*\{/;
/** `click X call name(args)`: mermaid liest Name `[^(]*` und Argumente `[^)]*` ohne String-Regel. */
const CALL = /^\s*click[ \t]+\S+[ \t]+call[ \t]+[^(\r\n]*(?:\([^)\r\n]*\)?)?/;
const BLANK = /^\s*$/;
const COMMENT_LINE = /^\s*%%(?!\{)[^\r\n]/;

/** Behaltene Bereiche `[von, bis)` von `text` nach Entfernen der Treffer von `re`. */
function keepOutside(text: string, re: RegExp): [number, number][] {
	const out: [number, number][] = [];
	let at = 0;
	for (const m of text.matchAll(re)) {
		if (m[0] === '') continue;
		if (m.index > at) out.push([at, m.index]);
		at = m.index + m[0].length;
	}
	if (at < text.length) out.push([at, text.length]);
	return out;
}

/**
 * mermaid `cleanupComments` `/^\s*%%(?!{)[^\n]+\n?/gm` linear: eine `%%`-Zeile entfällt samt
 * Zeilenende und dem Lauf reiner Leerraumzeilen direkt davor (das `\s*` des Musters); nackte
 * `%%`-Zeilen bleiben. Zeilenweise statt per Regex, damit Leerzeilen-Läufe nicht quadratisch
 * werden. CRLF trifft dieselben Bereiche wie mermaids LF-normalisierter Text.
 */
function keepComments(text: string): [number, number][] {
	const out: [number, number][] = [];
	let kept = 0;
	let run = -1;
	for (let start = 0; start < text.length;) {
		const nl = text.indexOf('\n', start);
		const end = nl < 0 ? text.length : nl + 1;
		const line = text.slice(start, end);
		if (COMMENT_LINE.test(line)) {
			const from = run < 0 ? start : run;
			if (from > kept) out.push([kept, from]);
			kept = end;
			run = -1;
		} else if (BLANK.test(line)) {
			if (run < 0) run = start;
		} else run = -1;
		start = end;
	}
	if (kept < text.length) out.push([kept, text.length]);
	return out;
}

/** Bereiche `ranges` von `inner` (Text = Verkettung von `outer`) in Koordinaten von `outer`. */
function compose(outer: [number, number][], inner: [number, number][]): [number, number][] {
	const out: [number, number][] = [];
	let k = 0;
	let base = 0;
	for (const [from, to] of inner) {
		let a = from;
		while (a < to) {
			while (base + outer[k][1] - outer[k][0] <= a) base += outer[k][1] - outer[k++][0];
			const [s, e] = outer[k];
			const b = Math.min(to, base + e - s);
			out.push([s + a - base, s + b - base]);
			a = b;
		}
	}
	return out;
}

const slices = (text: string, ranges: [number, number][]) =>
	ranges.map(([a, b]) => text.slice(a, b)).join('');

/**
 * Was mermaid von einem Stück liest, als behaltene Bereiche: erst `removeDirectives` (ganzes
 * Stück; Direktiv-Text weg, Zeile bleibt), dann `cleanupComments` (greift erst ab Zeile 2, weil
 * Zeile 1 eine Anweisung trägt). Stücke, die mit `%%` beginnen (Kommentar, Direktive), bleiben
 * ganz.
 */
function kept(text: string): [number, number][] {
	if (text.trimStart().startsWith('%%')) return [[0, text.length]];
	const outer = keepOutside(text, DIRECTIVE);
	const inner = keepComments(slices(text, outer));
	return compose(outer, inner);
}

/**
 * Inhalt eines Stücks: ohne Zeilenende, Einrückung, abschließendes `;`, Direktiven und innere
 * `%%`-Zeilen (siehe `kept`); Zeilenumbrüche als `\n`. Leerraum zwischen `}` und `;` bleibt:
 * nach `@{...}` ist er für mermaid ein Parse-Fehler (`readNode`).
 */
export function contentOf(text: string): string {
	const content = slices(text, kept(text)).replaceAll('\r\n', '\n').trim().replace(/;$/, '');
	return /\}[ \t]+$/.test(content) ? content : content.trim();
}

/** Quelltext-Bereich `[von, bis)` in `text` zu Inhalts-Positionen `[from, to)` (`contentOf`). */
export function sourceSpan(text: string, from: number, to: number): [number, number] {
	const at: number[] = [];
	for (const [a, b] of kept(text))
		for (let i = a; i < b; i++) if (!(text[i] === '\r' && text[i + 1] === '\n')) at.push(i);
	let lead = 0;
	while (lead < at.length && /\s/.test(text[at[lead]])) lead++;
	return [at[lead + from], at[lead + to - 1] + 1];
}

/** Ersetzt in `text` alle von mermaid entfernten Zeichen (außer Zeilenenden) durch Leerzeichen. */
function mask(text: string): string {
	let out = '';
	let at = 0;
	for (const [a, b] of kept(text)) {
		out += text.slice(at, a).replace(/[^\r\n]/g, ' ') + text.slice(a, b);
		at = b;
	}
	return out + text.slice(at).replace(/[^\r\n]/g, ' ');
}

/** Ungerade Zahl `"` außerhalb von `call`-Name und -Argumenten. */
const oddQuotes = (s: string) => (s.replace(CALL, '').match(/"/g) ?? []).length % 2 === 1;

/** Stück mit bis zum Dateiende offenem String (RawBlock ab Startzeile, D3). */
export function unclosedString(text: string): boolean {
	const content = contentOf(text);
	return !content.startsWith('%%') && !ACC.test(content) && oddQuotes(content);
}

/**
 * Positionen der Anweisungs-Trenner `;` außerhalb von Anführungszeichen, Klammern, `>...]`,
 * `|...|` und ungequotetem Kantentext (`-- text -->`).
 */
function separators(body: string): number[] {
	const out: number[] = [];
	const idChar = new RegExp(`[${ID_CHAR}]`);
	let depth = 0;
	let quote = false;
	let pipe = false;
	for (let i = 0; i < body.length; i++) {
		const ch = body[i];
		if (ch === '"') quote = !quote;
		else if (quote) continue;
		else if (ch === '|' && depth === 0) pipe = !pipe;
		else if (pipe) continue;
		else if ('[({'.includes(ch) || (ch === '>' && i > 0 && idChar.test(body[i - 1]))) depth++;
		else if ('])}'.includes(ch)) depth = Math.max(0, depth - 1);
		else if (depth > 0) continue;
		else if (ch === ';') out.push(i);
		else if (ch === '-' || ch === '=') i = skipLink(body, i) - 1;
	}
	return out;
}

/** Ende eines Link-Tokens ab `i` inkl. Kantentext; ohne Link `i + 1`, ohne Textende Zeilenende. */
function skipLink(body: string, i: number): number {
	LINK.lastIndex = i;
	if (LINK.exec(body)) return LINK.lastIndex;
	TEXT_START.lastIndex = i;
	const start = TEXT_START.exec(body);
	if (!start) return i + 1;
	const end = findTextEnd(body, TEXT_START.lastIndex, start[2]);
	return end ? end.at + end.token.length : body.length;
}

/**
 * Zerlegt Text lückenlos in Anweisungs-Stücke; `firstLine` ist die 1-basierte Startzeile.
 * Solange ein `"`-String offen ist, bilden mehrere Zeilen ein Statement (mermaid-Lexer, D3);
 * `%%`-, `accTitle:`- und `accDescr:`-Zeilen sowie der `accDescr {}`-Block sind davon
 * ausgenommen. Bleibt ein String bis zum Dateiende offen, ist der Rest ab der Startzeile ein Stück.
 */
export function splitPieces(text: string, firstLine = 1): Piece[] {
	const pieces: Piece[] = [];
	const lines = splitLines(text);
	const add = (text: string, line: number) => pieces.push({ text, content: contentOf(text), line });
	for (let i = 0; i < lines.length;) {
		const line = firstLine + i;
		const trimmed = lines[i].trim();
		let end = i + 1;
		if (trimmed === '' || trimmed.startsWith('%%') || ACC.test(trimmed)) {
			if (ACC_BLOCK.test(trimmed) && !trimmed.includes('}')) {
				const ends = (l: string) => l.includes('}') && !l.trim().startsWith('%%');
				while (end < lines.length && !ends(lines[end])) end++;
				end = Math.min(end + 1, lines.length);
			}
			add(lines.slice(i, end).join(''), line);
			i = end;
			continue;
		}
		let open = oddQuotes(lines[i]);
		for (; open && end < lines.length; end++)
			if (!lines[end].trim().startsWith('%%') && oddQuotes(lines[end])) open = false;
		const stmt = lines.slice(i, end).join('');
		i = end;
		if (open) add(stmt, line);
		else splitStatement(stmt, line, add);
	}
	return pieces;
}

/** Teilt ein Statement an `;`; innere `%%`-Zeilen zählen nicht (Positionen bleiben gleich). */
function splitStatement(stmt: string, line: number, add: (text: string, line: number) => void) {
	const eol = stmt.endsWith('\r\n') ? '\r\n' : stmt.endsWith('\n') ? '\n' : '';
	const body = stmt.slice(0, stmt.length - eol.length);
	const masked = mask(body);
	const cuts = body.trim() === '' ? [] : separators(masked);
	const parts: string[] = [];
	let start = 0;
	for (const cut of cuts) {
		parts.push(body.slice(start, cut + 1));
		start = cut + 1;
	}
	const rest = body.slice(start);
	if (parts.length > 0 && rest.trim() === '') parts[parts.length - 1] += rest;
	else parts.push(rest);
	parts[parts.length - 1] += eol;
	let at = line;
	for (const text of parts) {
		add(text, at);
		at += (text.match(/\n/g) ?? []).length;
	}
}

/** `k:v,k:v` zu StyleMap; Kommas in Klammern (z. B. `rgb(1,2,3)`) bleiben erhalten. */
export function parseStyle(text: string): StyleMap {
	const style: StyleMap = {};
	const parts: string[] = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; i++) {
		const ch = text[i];
		if (ch === '(') depth++;
		else if (ch === ')') depth = Math.max(0, depth - 1);
		else if (ch === ',' && depth === 0) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
	}
	parts.push(text.slice(start));
	for (const part of parts) {
		const colon = part.indexOf(':');
		if (colon > 0) style[part.slice(0, colon).trim()] = part.slice(colon + 1).trim();
	}
	return style;
}

export function styleText(style: StyleMap): string {
	return Object.entries(style)
		.map(([k, v]) => `${k}:${v}`)
		.join(',');
}

class Cursor {
	pos = 0;
	constructor(readonly s: string) {}
	ws(): void {
		while (this.pos < this.s.length && /\s/.test(this.s[this.pos])) this.pos++;
	}
	match(re: RegExp): RegExpExecArray | null {
		re.lastIndex = this.pos;
		const m = re.exec(this.s);
		if (m) this.pos = re.lastIndex;
		return m;
	}
	eat(lit: string): boolean {
		if (!this.s.startsWith(lit, this.pos)) return false;
		this.pos += lit.length;
		return true;
	}
	done(): boolean {
		return this.pos >= this.s.length;
	}
}

function readLabel(c: Cursor, closers: string[]): { label: string; closer: string } | null {
	if (c.s[c.pos] === '"') {
		const endQuote = c.s.indexOf('"', c.pos + 1);
		if (endQuote < 0) return null;
		const label = decodeQuoted(c.s.slice(c.pos + 1, endQuote)).trim();
		c.pos = endQuote + 1;
		const closer = closers.find((cl) => c.s.startsWith(cl, c.pos));
		if (!closer) return null;
		c.pos += closer.length;
		return { label, closer };
	}
	let best = -1;
	let closer = '';
	for (const cl of closers) {
		const at = c.s.indexOf(cl, c.pos);
		if (at >= 0 && (best < 0 || at < best)) [best, closer] = [at, cl];
	}
	if (best < 0) return null;
	const label = c.s.slice(c.pos, best).trim();
	c.pos = best + closer.length;
	return { label, closer };
}

function readNode(c: Cursor): NodeRef | null {
	const start = c.pos;
	const id = c.match(NODE_ID);
	if (!id) return null;
	let shape: string | null = null;
	let label: string | null = null;
	const opener = SHAPES.find(([open]) => c.s.startsWith(open, c.pos));
	if (c.s.startsWith('@{', c.pos)) {
		const meta = readMeta(c);
		// mermaid erlaubt nach `@{...}` keine `:::`-Klassen, keine Kanten-ID und keinen Leerraum
		// vor `;` (nur dann endet der Inhalt auf Leerraum, `contentOf`); sonst RawBlock.
		const rest = c.s.slice(c.pos);
		if (!meta || rest.startsWith(':::') || META_EDGE_ID.test(rest) || /^[ \t]+$/.test(rest))
			return null;
		return { id: id[0], ...meta, classes: [], text: c.s.slice(start, c.pos), span: [start, c.pos] };
	}
	if (opener) {
		const open = opener[0];
		const candidates = SHAPES.filter(([o]) => o === open);
		c.pos += open.length;
		const read = readLabel(
			c,
			candidates.map(([, close]) => close)
		);
		if (!read) return null;
		label = read.label;
		shape = candidates.find(([, close]) => close === read.closer)![2];
	}
	const span: [number, number] = [start, c.pos];
	const classes: string[] = [];
	let cls: RegExpExecArray | null;
	while ((cls = c.match(/:::([\w-]+)/y))) classes.push(cls[1]);
	return { id: id[0], shape, label, classes, text: c.s.slice(start, c.pos), span };
}

function readGroup(c: Cursor): NodeRef[] | null {
	const group: NodeRef[] = [];
	for (;;) {
		const node = readNode(c);
		if (!node) return null;
		group.push(node);
		const back = c.pos;
		c.ws();
		if (!c.eat('&')) {
			c.pos = back;
			return group;
		}
		c.ws();
	}
}

function linkFrom(
	start: string | undefined,
	body: string,
	head: string
): Omit<LinkInfo, 'label' | 'explicitId'> {
	const lineStyle = LINE_STYLE[body.includes('.') ? '.' : body[0]];
	const base = head ? HEAD_NAME[head] : 'none';
	const arrowHead = start && head ? `double_${base}` : base;
	const count = lineStyle === 'dotted' ? (body.match(/\./g) ?? []).length : body.length;
	const length =
		lineStyle === 'dotted' || lineStyle === 'invisible' ? count : count - (head ? 1 : 2);
	return { lineStyle, arrowHead, length: Math.max(1, lineStyle === 'invisible' ? 1 : length) };
}

function readLink(c: Cursor): LinkInfo | null {
	const explicitId = c.match(EDGE_ID)?.[1] ?? null;
	let label = '';
	let info: Omit<LinkInfo, 'label' | 'explicitId'>;
	const plain = c.match(LINK);
	if (plain) {
		const token = plain[2];
		const head = /[>ox]$/.test(token) && !/^~/.test(token) ? token.slice(-1) : '';
		info = linkFrom(plain[1], head ? token.slice(0, -1) : token, head);
	} else {
		const start = c.match(TEXT_START);
		if (!start) return null;
		const end = findTextEnd(c.s, c.pos, start[2]);
		if (!end) return null;
		label = stripQuotes(c.s.slice(c.pos, end.at).trim());
		c.pos = end.at + end.token.length;
		const token = end.token;
		const head = /[>ox]$/.test(token) ? token.slice(-1) : '';
		const body = head ? token.slice(0, -1) : token;
		info = linkFrom(start[1], start[2] === '-.' ? `-${body}` : body, head);
	}
	const back = c.pos;
	c.ws();
	const pipe = c.match(/\|\s*("[^"]*")\s*\||\|([^|]*)\|/y);
	if (pipe) label = stripQuotes((pipe[1] ?? pipe[2]).trim());
	else c.pos = back;
	return { explicitId, label, ...info };
}

function parseGraph(s: string): Stmt {
	const c = new Cursor(s);
	const groups: NodeRef[][] = [];
	const links: LinkInfo[] = [];
	const first = readGroup(c);
	if (!first) return { kind: 'raw' };
	groups.push(first);
	for (c.ws(); !c.done(); c.ws()) {
		const link = readLink(c);
		if (!link) return { kind: 'raw' };
		c.ws();
		const group = readGroup(c);
		if (!group) return { kind: 'raw' };
		links.push(link);
		groups.push(group);
	}
	return { kind: 'graph', groups, links };
}

const IDS = '[^\\s,]+(?:\\s*,\\s*[^\\s,]+)*';

/** Klassifiziert den Inhalt einer Anweisung (siehe `contentOf`). */
export function classify(content: string): Stmt {
	if (content === '') return { kind: 'blank' };
	if (content.startsWith('%%{')) return { kind: 'directive' };
	if (content.startsWith('%%')) return { kind: 'comment' };
	if (ACC.test(content) || oddQuotes(content)) return { kind: 'raw' };
	let m = DECL.exec(content);
	if (m) return { kind: 'decl', keyword: m[1], direction: m[2] ?? '' };
	if (content === 'end') return { kind: 'end' };
	if ((m = /^subgraph\s+(.+)$/s.exec(content))) {
		const rest = m[1].trim();
		const withId = /^([^\s[]+)\s*\[(.*)\]$/s.exec(rest);
		if (withId) return { kind: 'subgraph', id: withId[1], label: stripQuotes(withId[2].trim()) };
		const id = unquote(rest);
		return { kind: 'subgraph', id: /\s/.test(id) ? null : id, label: stripQuotes(rest) };
	}
	if ((m = new RegExp(`^direction\\s+(${DIRECTION})$`).exec(content)))
		return { kind: 'direction', direction: m[1] };
	if ((m = new RegExp(`^classDef\\s+(${IDS})\\s+(.+)$`).exec(content)))
		return { kind: 'classDef', names: m[1].split(/\s*,\s*/), style: parseStyle(m[2]) };
	if ((m = new RegExp(`^class\\s+(${IDS})\\s+([\\w-]+)$`).exec(content)))
		return { kind: 'class', ids: m[1].split(/\s*,\s*/), cls: m[2] };
	if ((m = /^style\s+(\S+)\s+(.+)$/.exec(content)))
		return { kind: 'style', id: m[1], style: parseStyle(m[2]) };
	if ((m = /^linkStyle\s+(\d+(?:\s*,\s*\d+)*)\s+(.+)$/.exec(content)))
		return {
			kind: 'linkStyle',
			indices: m[1].split(/\s*,\s*/).map(Number),
			style: parseStyle(m[2])
		};
	if ((m = /^click\s+(\S+)\s+\S/.exec(content))) return { kind: 'click', id: m[1], text: content };
	if (/^(subgraph|classDef|class|style|linkStyle|click|direction)\b/.test(content))
		return { kind: 'raw' };
	return parseGraph(content);
}

/** Knoten-IDs, die eine Anweisung erwähnt (`refs`) bzw. deren Eigenschaften sie setzt (`defs`). */
export function nodeUse(st: Stmt): { refs: string[]; defs: string[] } {
	switch (st.kind) {
		case 'graph': {
			const all = st.groups.flat();
			return {
				refs: all.map((n) => n.id),
				defs: all.filter((n) => n.shape !== null || n.classes.length > 0).map((n) => n.id)
			};
		}
		case 'class':
			return { refs: st.ids, defs: st.ids };
		case 'style':
		case 'click':
			return { refs: [st.id], defs: [st.id] };
		default:
			return { refs: [], defs: [] };
	}
}

/** Anzahl Kanten einer Graph-Anweisung (Ketten und `&` als Kreuzprodukt je Glied). */
export function edgeCount(st: Stmt): number {
	if (st.kind !== 'graph') return 0;
	let n = 0;
	for (let i = 0; i < st.links.length; i++) n += st.groups[i].length * st.groups[i + 1].length;
	return n;
}
