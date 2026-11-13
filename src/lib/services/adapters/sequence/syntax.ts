/**
 * Syntax-Tabellen des Sequence-Adapters (Untermenge nach SUBSET.md), geteilt von Parser und
 * Serializer. Kein DOM, kein Svelte.
 */
import type { DiagramDocument } from '../../../model/types';
import { isBackgroundColor } from '../../export/background';

export const TYPE_KEYWORD = 'sequenceDiagram';

/** Pfeil-Token zu `lineStyle`/`arrowHead`. Halbpfeile behalten ihr Token in `props.arrow`. */
const ARROWS: Record<string, [string, string]> = {
	'->': ['solid', 'none'],
	'-->': ['dotted', 'none'],
	'->>': ['solid', 'arrow'],
	'-->>': ['dotted', 'arrow'],
	'-x': ['solid', 'cross'],
	'--x': ['dotted', 'cross'],
	'-)': ['solid', 'open'],
	'--)': ['dotted', 'open'],
	'<<->>': ['solid', 'both'],
	'<<-->>': ['dotted', 'both']
};
const HALF_SOLID = ['-|\\', '-|/', '-\\\\', '-//', '/|-', '\\|-', '//-', '\\\\-'];
for (const token of HALF_SOLID) {
	ARROWS[token] = ['solid', 'half'];
	ARROWS[token.startsWith('-') ? `-${token}` : `${token}-`] = ['dotted', 'half'];
}

export function arrowStyle(token: string): [string, string] {
	return ARROWS[token.toLowerCase()];
}

/** Kanonisches Token aus `lineStyle`/`arrowHead`; Halbpfeile nur über `fallback`. */
export function arrowToken(lineStyle: string, arrowHead: string, fallback: unknown): string {
	if (arrowHead !== 'half') {
		const found = Object.entries(ARROWS).find(
			([, [style, head]]) => style === lineStyle && head === arrowHead
		);
		if (found) return found[0];
	}
	return typeof fallback === 'string' && fallback in ARROWS ? fallback : '->>';
}

/** Erlaubtes Section-Schlüsselwort je Container-Art. */
export const SECTION_KEYWORD: Record<string, string> = {
	alt: 'else',
	par: 'and',
	critical: 'option'
};

/** Längere Zeilen gehen ohne Statement-Regex in einen RawBlock (Laufzeit-Schranke). */
export const MAX_LINE = 2000;

/** Erstes `#` außerhalb einer Entity `#name;` bzw. `#123;`. */
export const BARE_HASH = /#(?!\w+;)/;
/** Entities nach mermaid (`encodeEntities`). */
export const ENTITY = /#\w+;/g;

/** Zeilenenden, die mermaids `.` nicht überliest. */
const LINE_BREAK = /(\r\n|[\n\r\u2028\u2029])/;
const SPACE_CHAR = /\s/;

/**
 * Wie mermaids `replace(/<keyword>.*:\S*#.*;/g, ...)` auf einer Zeile ohne Umbruch: greift ab dem
 * ersten `keyword`, wenn danach ein `:` mit `\S`-Lauf bis zu einem `#` und dahinter ein `;` folgt,
 * und entfernt dann das letzte `;` der Zeile. Ein Durchlauf, linear in der Zeilenlänge.
 */
function dropSemi(line: string, keyword: string): string {
	const at = line.indexOf(keyword);
	if (at < 0) return line;
	let run = false;
	for (let i = at + keyword.length; i < line.length; i++) {
		const ch = line[i];
		if (run && ch === '#') {
			const semi = line.lastIndexOf(';');
			return semi > i ? line.slice(0, semi) + line.slice(semi + 1) : line;
		}
		if (ch === ':') run = true;
		else if (SPACE_CHAR.test(ch)) run = false;
	}
	return line;
}

/** Vorstufe von mermaid `encodeEntities`: erst `style`-, dann `classDef`-Durchlauf je Zeile. */
export function styleStage(text: string): string {
	return text
		.split(LINE_BREAK)
		.map((part, i) => (i % 2 ? part : dropSemi(dropSemi(part, 'style'), 'classDef')))
		.join('');
}

/** Rest nach einem `;`, den mermaid überliest: weitere `;`, Leerraum, Kommentar. */
const TRAILER = /^[\s;]*(?:#.*|%(?!\{).*)?$/;

/**
 * Statement-Zeile nach mermaids Vorstufe (`styleStage`) bis zu der Stelle, an der mermaid den Text
 * nach dem ersten `:` beendet (Lexer `:[^#\n;]*` nach Ersetzen der Entities): erstes `#` oder `;`
 * außerhalb einer Entity. Nach `#` folgt ein Kommentar, nach `;` nur Leerraum, `;` oder Kommentar.
 * `null`, wenn vor dem `:` ein solches Zeichen steht, nach `;` eine weitere Anweisung folgt oder
 * direkt nach dem `:` ein `%%` steht (mermaids Lexer liest `:%%...` als Kommentar).
 */
export function statementText(line: string): string | null {
	const text = styleStage(line);
	const masked = text.replace(ENTITY, (e) => '\u0000'.repeat(e.length));
	const colon = masked.indexOf(':');
	if (colon >= 0 && masked.startsWith('%%', colon + 1)) return null;
	const stop = masked.slice(colon + 1).search(/[#;]/);
	if (stop < 0) return /[#;]/.test(masked) ? null : text;
	const cut = colon + 1 + stop;
	if (colon < 0 || /[#;]/.test(masked.slice(0, colon))) return null;
	if (masked[cut] === ';' && !TRAILER.test(masked.slice(cut + 1))) return null;
	return text.slice(0, cut);
}

/** Umbruch-Schalter am Textanfang wie mermaid `extractWrap`. */
const WRAP = /^:?(no)?wrap:/;

/** Text von Nachricht/Notiz wie mermaid `parseMessage`: getrimmt, ohne `wrap:`/`nowrap:`, dekodiert. */
export function messageText(raw: string): { label: string; wrap?: boolean } {
	const text = raw.trim();
	const wrap = WRAP.exec(text);
	if (!wrap) return { label: decodeLabel(text) };
	return { label: decodeLabel(text.slice(wrap[0].length).trim()), wrap: !wrap[1] };
}

/** Schreibweise von `props.wrap` vor dem Text (ohne Schalter leer). */
export function wrapPrefix(wrap: unknown): string {
	return wrap === true ? 'wrap:' : wrap === false ? 'nowrap:' : '';
}

/**
 * Statement-Regexe für den Rumpf erwarten getrimmte Zeilen. Keine überlappenden Quantoren
 * (Leerraum-Läufe werden nur einmal abgesucht), daher linear in der Zeilenlänge.
 */
export const RE = {
	directiveStart: /^\s*%%\{/,
	directiveEnd: /\}%%/,
	comment: /^\s*(%|#)/,
	typeLine: /^\s*sequenceDiagram\b/i,
	participant: /^(participant|actor)\s+(\S.*)$/i,
	alias: /(?<=\S)\s+as(?:\s+|$)/i,
	name: /^[^<>:\n,;@]+$/,
	note: /^note\s+(left of|right of|over)\s+([^:\s](?:[^:]*[^:\s])?)\s*:(.*)$/i,
	activation: /^(activate|deactivate)\s+([^<>:\n,;\s](?:[^<>:\n,;]*[^<>:\n,;\s])?)$/i,
	title: /^title(?::\s*|\s+)(.+)$/i,
	accDescrBlock: /^\s*accDescr\s*\{/i,
	block: /^(loop|alt|opt|par|critical|rect|break)(?:\s+(.*))?$/i,
	section: /^(else|and|option)(?:\s+(.*))?$/i,
	end: /^\s*end\s*$/i,
	rawBlock: /^\s*(box|par_over)(?:\s|$)/i,
	anyBlock: /^\s*(loop|alt|opt|par|par_over|critical|rect|break|box)(?:\s|$)/i
};

/** Namen, die mermaid in einer Deklaration vor `as` liest (kein Leerraum). */
export const ALIASABLE = /^\S+$/;

/** Alias-Trenner einer Deklaration wie mermaid: nur hinter einem Namen nach `ALIASABLE`. */
export function aliasOf(rest: string): RegExpExecArray | null {
	const alias = RE.alias.exec(rest);
	return alias && ALIASABLE.test(rest.slice(0, alias.index)) ? alias : null;
}

/** Deklarationsrest `Name [as Beschreibung]`: ID und Label (ohne Alias `undefined`). */
export function declaration(rest: string): { id: string; label?: string; tail: string } {
	const alias = aliasOf(rest);
	if (!alias) return { id: rest, tail: '' };
	// `#` außerhalb einer Entity beendet den Alias.
	const tail = rest.slice(alias.index + alias[0].length).split(BARE_HASH)[0];
	return { id: rest.slice(0, alias.index), label: decodeLabel(tail.trim()), tail };
}

/** Teilnehmer-Nennung in einem RawBlock; `kind` nur bei Deklaration. */
export interface RawUse {
	id: string;
	kind?: string;
	label?: string;
}

/** RawBlocks, deren Zeilen keine Teilnehmer anlegen (Titel, Beschreibung, Direktive). */
const NO_PARTICIPANTS = /^\s*(?:(?:title|accTitle|accDescr)\b|%%\{)/i;
/** `;` außerhalb einer Entity trennt Anweisungen wie ein Zeilenende. */
const STATEMENT_END = /(?<!#\w+);/;
const CREATE = /^create\s+/i;
const ACTOR_DATA = /^(?:links?|properties|details)\s+([^:]*[^:\s])\s*:/i;

/**
 * Teilnehmer, die mermaid aus einem RawBlock anlegt (Nachricht, Notiz, Deklaration auch in `box`
 * und mit `create`, `link`/`links`/`properties`/`details`), in Reihenfolge des Auftretens.
 * Zeilen über `MAX_LINE` bleiben unausgewertet.
 */
export function rawUses(rawText: string): RawUse[] {
	if (NO_PARTICIPANTS.test(rawText)) return [];
	const found: RawUse[] = [];
	for (const line of rawText.split('\n')) {
		if (line.length > MAX_LINE) continue;
		for (const part of lineParts(line)) {
			const text = part.trim().replace(CREATE, '');
			const msg = matchMessage(text);
			const p = msg ? null : RE.participant.exec(text);
			const n = msg || p ? null : RE.note.exec(text);
			const d = msg || p || n ? null : ACTOR_DATA.exec(text);
			if (msg) found.push({ id: msg[0] }, { id: msg[3] });
			else if (p) {
				const { id, label } = declaration(p[2]);
				found.push({ id, kind: p[1].toLowerCase(), label });
			} else if (n) n[2].split(',').forEach((id) => found.push({ id: id.trim() }));
			else if (d) found.push({ id: d[1] });
		}
	}
	return found.filter((use) => RE.name.test(use.id));
}

/** Anweisung in Reihenfolge wie mermaid-db sie verarbeitet (Nachricht: erst Teilnehmer, dann sie). */
export type RawStep =
	| { type: 'use'; id: string; decl?: RawDeclaration }
	| { type: 'create'; id: string; decl?: RawDeclaration }
	| { type: 'destroy'; id: string }
	| { type: 'message'; from: string; to: string }
	| { type: 'autonumber'; set: Autonumber };

/** Deklaration (`participant`/`actor`): Typ und ob ein Alias (`… as …`) folgt. */
export interface RawDeclaration {
	kind: string;
	alias: boolean;
}

/**
 * `autonumber`-Anweisung wie mermaid (Grammatik-Fälle 19-22): `start`/`step` nur mit Zahl
 * (`autonumber N` setzt `step` 1), `off` blendet aus. Ohne `start` zählt mermaid weiter.
 */
export interface Autonumber {
	start?: number;
	step?: number;
	visible: boolean;
}

/**
 * Zahl wie mermaids `NUM` (`[0-9]+(\.[0-9]{1,2})?` oder `\.[0-9]{1,2}`), dahinter wie der Lexer
 * nur Leerzeichen oder Zeilenende (Tab, `;`, `#` direkt nach der Zahl: Fehler in mermaid).
 */
const NUM = String.raw`(\d+(?:\.\d{1,2})?|\.\d{1,2})(?= |$)`;
/**
 * Kommentar wie mermaids Lexer: `#…`, `%…` (nicht `%%{`), `x%%…` verschluckt das Zeichen davor.
 * `#wort;` ist eine Entity (mermaid kodiert sie vor dem Lexer), kein Kommentarbeginn.
 */
const COMMENT = String.raw`(?:#(?!\w+;).*|%(?!%?\{).*|[^}\s]%%.*)`;
/**
 * Eine Anweisung (getrimmt, samt abschließendem `;`); Leerzeichen am Zeilenende wie am Dateiende
 * zugelassen (mitten im Dokument liest mermaid sie mit dem Zeilenende als Fehler).
 */
const AUTONUMBER = new RegExp(
	String.raw`^autonumber\b\s*(?:(?:(off)\b|${NUM}(?:\s+${NUM})?)\s*)?${COMMENT}?;?$`,
	'i'
);

/** Teile, getrimmt, jeder außer dem letzten mit seinem `;`. */
const terminate = (parts: string[]) =>
	parts.map((p, i) => (i < parts.length - 1 ? `${p};` : p).trim());

/**
 * Teile einer Zeile wie `line.split(STATEMENT_END)`; nach einer `autonumber`-Anweisung mit
 * Kommentar endet die Zeile (mermaids Lexer liest den Rest samt `;` als Kommentar).
 */
function lineParts(line: string): string[] {
	const parts = line.split(STATEMENT_END);
	const end = terminate(parts).findIndex((p) => /[#%]/.test(p) && autonumberStatement(p));
	return end < 0 ? parts : parts.slice(0, end + 1);
}

/** Anweisungen einer Zeile (`lineParts`), getrimmt, jede außer der letzten mit ihrem `;`. */
const statements = (line: string) => terminate(lineParts(line));

/** `text` (getrimmte Anweisung) ist `autonumber`; sonst `undefined`. */
function autonumberStatement(text: string): Autonumber | undefined {
	const m = AUTONUMBER.exec(text);
	if (!m) return undefined;
	if (m[1]) return { visible: false };
	if (m[2] === undefined) return { visible: true };
	return { start: Number(m[2]), step: m[3] === undefined ? 1 : Number(m[3]), visible: true };
}

/** Zeile besteht nur aus `autonumber`-Anweisungen (getrennt durch `;`). */
function autonumberLine(line: string): boolean {
	const parts = statements(line);
	return (
		parts.some((p) => autonumberStatement(p)) &&
		parts.every((p) => /^;?$/.test(p) || autonumberStatement(p))
	);
}

/**
 * RawBlock-Text ohne die Zeilen, die nur aus `autonumber`-Anweisungen bestehen (T135, Schalter
 * "Nummerierung"); Leerzeilen und übrige Zeilen bleiben byte-gleich. Blöcke ohne Anweisungen
 * (`NO_PARTICIPANTS`, etwa `accDescr { … }`) bleiben unverändert.
 */
export function withoutAutonumber(rawText: string): string {
	if (NO_PARTICIPANTS.test(rawText)) return rawText;
	return (rawText.match(/[^\n]*\n|[^\n]+$/g) ?? []).filter((l) => !autonumberLine(l)).join('');
}

/** Auswertung eines RawBlocks für Canvas-Prüfungen (T128: vormals `views/.../raw.ts`). */
export interface RawEvents {
	/** Teilnehmer-Nennungen in Reihenfolge, gleich den IDs von `rawUses`. */
	uses: string[];
	/** Aktivierungen (`activate`/`deactivate`, `+`/`-` an Nachrichten) in Reihenfolge. */
	act: { on: boolean; participant: string }[];
	/** Deklarierte Teilnehmer (`participant`/`actor`, auch mit `create`). */
	declared: string[];
	steps: RawStep[];
	/** Nur wenn der RawBlock außer Leerzeilen genau eine `autonumber`-Anweisung ist (T135). */
	autonumber?: Autonumber;
	/**
	 * Nur mit `autonumber`-Anweisung (Schalter "Nummerierung", O-175): `visible` eine davon blendet
	 * ein, `fixed` eine steht in einer Zeile mit anderen Anweisungen (`withoutAutonumber` entfernt
	 * sie nicht).
	 */
	numbering?: { visible: boolean; fixed: boolean };
}

const DESTROY = /^destroy\s+([^<>:\n,;\s](?:[^<>:\n,;]*[^<>:\n,;\s])?)$/i;

/** `create`-Deklaration bzw. `destroy` als Nachrichten-Option (T135 C3). */
export type Lifecycle =
	{ type: 'create'; id: string; kind: string; label: string } | { type: 'destroy'; id: string };

/**
 * Text aus Leerzeilen und genau einer Anweisung `create participant|actor <Deklaration>` (wie
 * der Teilnehmer-Zweig des Parsers: gültiger Name, kein `;`) bzw. `destroy <Name>`; sonst `null`.
 * Ob die Nachricht danach passt, prüft der Aufrufer.
 */
export function lifecycleLine(text: string): Lifecycle | null {
	const line = text.replace(/^(?:[ \t]*\r?\n)*/, '').replace(/\r?\n$/, '');
	const trimmed = line.trim();
	if (/[\r\n]/.test(line) || trimmed.length > MAX_LINE) return null;
	const x = DESTROY.exec(trimmed);
	if (x) return { type: 'destroy', id: x[1] };
	const p = CREATE.test(trimmed) ? RE.participant.exec(trimmed.replace(CREATE, '')) : null;
	if (!p) return null;
	const { id, label, tail } = declaration(p[2]);
	if (!RE.name.test(id) || tail.replace(ENTITY, '').includes(';')) return null;
	return { type: 'create', id, kind: p[1].toLowerCase(), label: label ?? id };
}

/**
 * Wie `rawUses`, zusätzlich Aktivierungen, Deklarationen und die Abfolge, die mermaid-db prüft
 * (`create`, `destroy`, Nachricht). Gleiche Zeilenregeln (`MAX_LINE`, `;`, `NO_PARTICIPANTS`).
 */
export function rawEvents(rawText: string): RawEvents {
	const out: RawEvents = { uses: [], act: [], declared: [], steps: [] };
	if (NO_PARTICIPANTS.test(rawText)) return out;
	const use = (id: string, type: 'use' | 'create' = 'use', decl?: RawDeclaration) => {
		if (!RE.name.test(id)) return false;
		out.uses.push(id);
		out.steps.push(decl ? { type, id, decl } : { type, id });
		return true;
	};
	let fixed = false;
	for (const line of rawText.split('\n')) {
		if (line.length > MAX_LINE) continue;
		const terminated = statements(line);
		let numbered = false;
		for (const [k, part] of lineParts(line).entries()) {
			const set = autonumberStatement(terminated[k]);
			if (set) {
				out.steps.push({ type: 'autonumber', set });
				numbered = true;
				continue;
			}
			const created = CREATE.test(part.trim());
			const text = part.trim().replace(CREATE, '');
			const msg = matchMessage(text);
			const p = msg ? null : RE.participant.exec(text);
			const n = msg || p ? null : RE.note.exec(text);
			const d = msg || p || n ? null : ACTOR_DATA.exec(text);
			const a = msg || p || n || d ? null : RE.activation.exec(text);
			const x = msg || p || n || d || a || created ? null : DESTROY.exec(text);
			if (msg) {
				const [from, , sign, to] = msg;
				use(from);
				use(to);
				out.steps.push({ type: 'message', from, to });
				if (sign) out.act.push({ on: sign === '+', participant: sign === '+' ? to : from });
			} else if (p) {
				const decl = { kind: p[1].toLowerCase(), alias: aliasOf(p[2]) !== null };
				const { id } = declaration(p[2]);
				if (use(id, created ? 'create' : 'use', decl)) out.declared.push(id);
			} else if (n) n[2].split(',').forEach((id) => use(id.trim()));
			else if (d) use(d[1]);
			else if (a) out.act.push({ on: a[1].toLowerCase() === 'activate', participant: a[2] });
			else if (x) out.steps.push({ type: 'destroy', id: x[1] });
		}
		if (numbered && !autonumberLine(line)) fixed = true;
	}
	const sets = out.steps.flatMap((s) => (s.type === 'autonumber' ? [s.set] : []));
	if (sets.length === 1 && withoutAutonumber(rawText).trim() === '') out.autonumber = sets[0];
	if (sets.length) out.numbering = { visible: sets.some((s) => s.visible), fixed };
	return out;
}

const SPACE = /\s/;
/** Zeichen, die in Teilnehmer-Namen von Nachrichten nicht vorkommen (`[<>:\n,;+()]`), nach ASCII-Code. */
const STOP_CODES = new Uint8Array(128);
for (const ch of '<>:\n,;+()') STOP_CODES[ch.charCodeAt(0)] = 1;
/** `text[i]` ist ein solches Zeichen. */
const isStop = (text: string, i: number) => {
	const code = text.charCodeAt(i);
	return code < 128 && STOP_CODES[code] === 1;
};
/** Wie `SPACE.test(text[i])`; Leerzeichen und sichtbare ASCII-Zeichen ohne Regex. */
const isSpace = (text: string, i: number) => {
	const code = text.charCodeAt(i);
	return code === 32 || ((code < 33 || code > 126) && SPACE.test(text[i]));
};
/** Pfeil-Tokens samt Großschreibung (`-X`), längste zuerst wie eine Regex-Alternation. */
const ARROW_TOKENS = Object.keys(ARROWS)
	.flatMap((t) => (t.includes('x') ? [t, t.toUpperCase()] : [t]))
	.sort((a, b) => b.length - a.length);
const ARROW_MAX = ARROW_TOKENS[0].length;
const ARROW_SET = new Set(ARROW_TOKENS);
const PLUS = 43;
const MINUS = 45;
/** Zeilenenden im Text, die mermaids `.` nicht liest. */
const LABEL_BREAK = /[\r\u2028\u2029]/g;
/** Zeichen bei `i` (vor `end`) kann Rand eines Teilnehmer-Namens sein. */
const isEdge = (text: string, i: number, end: number) =>
	i < end && !isStop(text, i) && !isSpace(text, i);
const skipSpace = (text: string, i: number, end: number) => {
	while (i < end && isSpace(text, i)) i++;
	return i;
};
/**
 * Stellen, an denen ein Pfeil-Token beginnt, mit dem längsten dort (Gruppe 1): Vorfilter der
 * Pfeilsuche in einem Durchlauf. Die übrigen Tokens an der Stelle sind Anfangsstücke davon.
 */
const ARROW_START = new RegExp(
	`(?=(${ARROW_TOKENS.map((t) => t.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')).join('|')}))`,
	'g'
);

/**
 * Nachricht `Von<Pfeil>[+-]Nach:Text` mit trägem Absender und gierigem Empfänger (Gruppen wie
 * `^(Von)\s*(Pfeil)\s*(?:([+-])\s*)?(Nach)\s*:(.*)$`, Pfeil case-insensitiv). Linear statt
 * Regex: der Empfänger liegt im Namens-Lauf direkt vor dem ersten `:`; Pfeile werden nur an den
 * Stellen aus `ARROW_START` probiert. `\r`, `\u2028`, `\u2029` im Text: keine Nachricht (`.`).
 */
export function matchMessage(text: string): [string, string, string, string, string] | null {
	const colon = text.indexOf(':');
	LABEL_BREAK.lastIndex = colon + 1;
	if (colon < 1 || LABEL_BREAK.test(text)) return null;
	let end = colon;
	while (end > 0 && isSpace(text, end - 1)) end--;
	let run = end;
	while (run > 0 && !isStop(text, run - 1)) run--;
	if (!isEdge(text, 0, end)) return null;
	// Zwischen Pfeilanfang und Empfänger liegen höchstens Pfeil, Leerraum und `+`/`-`.
	let minAt = run;
	while (minAt > 0 && isSpace(text, minAt - 1)) minAt--;
	const before = text.charCodeAt(minAt - 1);
	if (before === PLUS || before === MINUS) minAt--;
	while (minAt > 0 && isSpace(text, minAt - 1)) minAt--;
	minAt -= ARROW_MAX;
	let first = Math.max(minAt, 1);
	while (first > 1 && isSpace(text, first - 1)) first--;
	let stop = 0;
	while (!isStop(text, stop)) stop++;
	const last = Math.min(end - 1, stop);
	// Nur Pfeil-Anfänge `at` ab `minAt`; der Absender endet vor dem Leerraum-Lauf davor (`f`).
	ARROW_START.lastIndex = Math.max(minAt, first);
	for (let m = ARROW_START.exec(text); m && m.index < end; m = ARROW_START.exec(text)) {
		const at = m.index;
		ARROW_START.lastIndex = at + 1;
		let f = at;
		while (f > first && isSpace(text, f - 1)) f--;
		if (f > last || !isEdge(text, f - 1, end)) continue;
		for (let len = m[1].length; len >= 2; len--) {
			const token = len === m[1].length ? m[1] : m[1].slice(0, len);
			if (len < m[1].length && !ARROW_SET.has(token)) continue;
			const after = skipSpace(text, at + token.length, end);
			const signed = text[after] === '+' || text[after] === '-';
			const sign = signed ? skipSpace(text, after + 1, end) : -1;
			const to = signed && sign >= run && isEdge(text, sign, end) ? sign : after;
			if (to < run || !isEdge(text, to, end)) continue;
			const activation = to === sign ? text[after] : '';
			const from = text.slice(0, f);
			return [from, token, activation, text.slice(to, end), text.slice(colon + 1)];
		}
	}
	return null;
}

/** Label aus Rohtext: numerische Entities (`#59;`, `#35;`) dekodiert, benannte bleiben. */
export function decodeLabel(text: string): string {
	return text.replace(/#(\d+);/g, (entity, code: string) =>
		Number(code) <= 0x10ffff ? String.fromCodePoint(Number(code)) : entity
	);
}

/**
 * Label für neue Zeilen: `;` und `#` als Entity, Zeilenumbruch als `<br>`, benannte Entities
 * bleiben; `:` eines führenden `wrap:`/`nowrap:` als Entity (sonst liest mermaid einen Schalter),
 * mit `colon` jedes `:` (gegen die `style`/`classDef`-Vorstufe, siehe `stageSafe`).
 */
export function encodeLabel(label: string, colon = false): string {
	const text = label
		.replace(/\r\n?|\n/g, '<br>')
		.replace(/#[A-Za-z]\w*;|[#;]/g, (m) => (m === '#' ? '#35;' : m === ';' ? '#59;' : m));
	return colon ? text.replace(/:/g, '#58;') : text.replace(/^(\s*:?(?:no)?wrap):/, '$1#58;');
}

/**
 * Neue Zeile, an der mermaids `style`/`classDef`-Vorstufe nichts ändert: löst die fertige Zeile sie
 * aus, wird sie mit `colon` neu gebaut (jedes `:` im Text als Entity, Leerzeichen nach `wrap:`).
 * Danach folgt auf jedes verbliebene `:` ein Leerzeichen; die Vorstufe greift nicht mehr.
 */
export function stageSafe(build: (colon: boolean) => string): string {
	const line = build(false);
	return styleStage(line) === line ? line : build(true);
}

/**
 * Farbe einer Teilnehmer-Gruppe (`box`, T135 C2): Allow-Liste des PNG-Hintergrunds
 * (`isBackgroundColor`: benannte Farben samt `transparent`, `rgb()`/`rgba()`, `hsl()`/`hsla()`)
 * ohne Hex, denn `#` beginnt im `box`-Kopf einen Kommentar.
 */
export function isBoxColor(value: string): boolean {
	return !value.startsWith('#') && isBackgroundColor(value);
}

/** Auswahl der Canvas-Farbliste für Gruppen (Teilmenge der Allow-Liste, `''` = ohne Farbe). */
export const BOX_COLORS = [
	'transparent',
	'aliceblue',
	'lavender',
	'honeydew',
	'lightyellow',
	'mistyrose',
	'lightblue',
	'lightgreen',
	'lightgray',
	'aqua',
	'wheat',
	'pink'
];

/**
 * Wörter, die mermaid (`CSS.supports`) je nach Browser als Farbe liest: CSS-weite
 * Schlüsselwörter, `currentcolor`, Systemfarben. Ein `box`-Kopf damit bleibt RawBlock.
 */
const UNSURE_COLOR = new RegExp(
	'^(?:inherit|initial|unset|revert|revert-layer|currentcolor|canvas|canvastext|linktext|' +
		'visitedtext|activetext|buttonface|buttontext|buttonborder|field|fieldtext|highlight|' +
		'highlighttext|selecteditem|selecteditemtext|mark|marktext|graytext|accentcolor|' +
		'accentcolortext|activeborder|activecaption|appworkspace|background|buttonhighlight|' +
		'buttonshadow|captiontext|inactiveborder|inactivecaption|inactivecaptiontext|' +
		'infobackground|infotext|menu|menutext|scrollbar|threeddarkshadow|threedface|' +
		'threedhighlight|threedlightshadow|threedshadow|window|windowframe|windowtext)$',
	'i'
);
/** Aufteilung wie mermaid `parseBoxData` (gierige Klammer, sonst Wortzeichen). */
const BOX_DATA = /^((?:rgba?|hsla?)\s*\(.*\)|\w*)(.*)$/;
const BOX_KEYWORD = /^box(?:\s+|$)/i;

/** Kopf einer Teilnehmer-Gruppe: Farbe (`''` ohne), Titel, Umbruch-Schalter. */
export interface BoxHead {
	color: string;
	label: string;
	wrap?: boolean;
}

/**
 * `box`-Kopf (getrimmte Zeile) wie mermaid `parseBoxData`; `null`, wo das Ergebnis vom Browser
 * abhängt oder der Kopf Kommentar bzw. `;` enthält (dann bleibt die Gruppe RawBlock): Farbwort
 * außerhalb der Allow-Liste, das mermaid als Farbe lesen kann (Funktion, `UNSURE_COLOR`).
 */
export function boxHead(line: string): BoxHead | null {
	const keyword = BOX_KEYWORD.exec(line);
	if (!keyword) return null;
	const rest = line.slice(keyword[0].length).trim();
	if (/[#;]/.test(rest.replace(ENTITY, ''))) return null;
	const [, word, tail] = BOX_DATA.exec(rest)!;
	const color = word.trim();
	let title = rest;
	if (color && isBoxColor(color)) title = tail;
	else if (color && (/^(?:rgba?|hsla?)\s*\(/i.test(color) || UNSURE_COLOR.test(color))) return null;
	const { label, wrap } = messageText(title);
	return {
		color: color && isBoxColor(color) ? color : '',
		label,
		...(wrap === undefined ? {} : { wrap })
	};
}

/**
 * Kanonischer `box`-Kopf: Farbe (ohne Farbe bei Titel `transparent`, sonst läse mermaid das
 * erste Titelwort als Farbe), Umbruch-Schalter, Titel mit `%` und bei Funktionsfarbe `(`/`)` als
 * Entity (mermaids gierige Klammer).
 */
export function boxHeadLine({ color, label, wrap }: BoxHead): string {
	const prefix = wrapPrefix(wrap);
	if (!label && !prefix) return color ? `box ${color}` : 'box';
	const fn = color.includes('(');
	return stageSafe((colon) => {
		let title = encodeLabel(label, colon).replace(/%/g, '#37;');
		if (fn) title = title.replace(/\(/g, '#40;').replace(/\)/g, '#41;');
		return `box ${color || 'transparent'} ${prefix}${title}`;
	});
}

/** Zeilenende des Dokuments: erstes Zeilenende in den Rohtexten, sonst `\n`. */
export function detectEol(doc: DiagramDocument): string {
	const raw = [
		doc.header.frontmatter,
		...doc.header.directives,
		...doc.nodes.map((n) => n.sourceText),
		...doc.edges.map((e) => e.sourceText),
		...doc.containers.flatMap((c) => [
			c.sourceText,
			...((c.props.sourceSections as string[] | undefined) ?? []),
			String(c.props.sourceEnd ?? '')
		]),
		...doc.comments.map((c) => c.text),
		...doc.rawBlocks.map((r) => r.rawText)
	];
	for (const text of raw) {
		const at = text.indexOf('\n');
		if (at >= 0) return text[at - 1] === '\r' ? '\r\n' : '\n';
	}
	return '\n';
}
