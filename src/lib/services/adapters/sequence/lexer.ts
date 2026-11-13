/**
 * Nachbildung des mermaid-Lexers (sequenceDiagram, Zustand INITIAL, die erste passende Regel
 * gewinnt) für kanonisch geschriebene Nachrichtenzeilen `Von<Pfeil>[+-]Nach: Text`. Regeln und
 * Reihenfolge wie in mermaid 12; Regeln vor `ACTOR`, die hier nur stören können, sind zu `OTHER`
 * zusammengefasst. Die Zeile entsteht wie im Serializer (Leerzeichen vor `-` hinter einem Pfeil auf
 * `-`, nach `-` vor x/X). Einziger Ort dieser Grammatik (T128, V-25); die View erhält sie über
 * den Sync-Controller (`sequenceGrammar`).
 */
const SPACE = /^\s+/;
const OTHER = new RegExp(
	'^(?:#[^\\n]*|%(?!\\{)[^\\n]*|[^\\}]%%[^\\n]*|(?:[0-9]+(?:\\.[0-9]{1,2})?|\\.[0-9]{1,2})(?=[ \\n]+)|' +
		'(?:box|participant|actor|create|destroy|loop|rect|opt|alt|else|par|par_over|and|critical|' +
		'option|break|end|left of|right of|over|note|activate|deactivate|sequenceDiagram|autonumber|' +
		'off)\\b|(?:links?|properties|details)(?=[ \\t]+[^/\\\\+()<>:\\n,;\\s-])|title:?\\s[^#\\n;]+|' +
		'accTitle\\s*:\\s*|accDescr\\s*[:{]\\s*|[,;])',
	'i'
);
const ACTOR =
	/^[^/\\+()+<\->\->:\n,;]+((?!(-x|--x|-\)|--\)|-\|\\|-\\|-\/|-\/\/|-\|\/|\/\|-|\\\|-|\/\/-|\\\\-|\/\|-|--\|\\|--|\(\)))[-]*[^+<\->\->:\n,;]+)*/i;
const ARROWS = [
	'->>',
	'<<->>',
	'-->>',
	'<<-->>',
	'->',
	'-->',
	'-x',
	'--x',
	'-)',
	'--)',
	'--|\\',
	'--|/',
	'--\\\\',
	'--//',
	'/|--',
	'\\|--',
	'//--',
	'\\\\--',
	'-|\\',
	'-|/',
	'-\\\\',
	'-//',
	'/|-',
	'\\|-',
	'//-',
	'\\\\-'
];

type Token = { kind: 'other' | 'actor' | 'arrow' | 'text' | '+' | '-'; text: string };

function tokens(line: string): Token[] {
	const out: Token[] = [];
	let rest = line;
	while (rest) {
		const space = SPACE.exec(rest);
		if (space) {
			rest = rest.slice(space[0].length);
			continue;
		}
		let token: Token;
		const other = OTHER.exec(rest);
		const actor = !other && ACTOR.exec(rest);
		const arrow = ARROWS.find((a) => rest.slice(0, a.length).toLowerCase() === a);
		if (other) token = { kind: 'other', text: other[0] };
		else if (actor) token = { kind: 'actor', text: actor[0] };
		else if (arrow) token = { kind: 'arrow', text: rest.slice(0, arrow.length) };
		else if (rest[0] === ':') token = { kind: 'text', text: rest };
		else if (rest[0] === '+' || rest[0] === '-') token = { kind: rest[0], text: rest[0] };
		else token = { kind: 'other', text: rest[0] };
		out.push(token);
		rest = rest.slice(token.text.length);
	}
	return out;
}

/** Liest mermaid die Zeile `Von<Pfeil>[+-]Nach: …` als genau diese Nachricht? */
export function messageLexes(from: string, arrow: string, activation: string, to: string): boolean {
	const pre = activation === '-' && arrow.endsWith('-') ? ' ' : '';
	const post = activation === '-' && /^x/i.test(to) ? ' ' : '';
	const got = tokens(`${from}${arrow}${pre}${activation}${post}${to}: x`).map((t) =>
		t.kind === 'actor' ? `actor:${t.text.trim()}` : `${t.kind}:${t.text.toLowerCase()}`
	);
	const want = [`actor:${from}`, `arrow:${arrow.toLowerCase()}`];
	if (activation) want.push(`${activation}:${activation}`);
	want.push(`actor:${to}`, 'text:: x');
	return got.length === want.length && got.every((t, i) => t === want[i]);
}
