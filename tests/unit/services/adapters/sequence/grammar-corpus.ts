/**
 * Eingaben der Golden-Tests zur Sequenz-Erkennung (T128 C1, V-25): RawBlock-Texte für `rawEvents`
 * und das Raster für `messageLexes`, genutzt von `grammar.test.ts` (Adapter gegen Golden). Das
 * Golden stammt aus der früheren View-Erkennung (`grammar-view.test.ts`, beide mit T128 C2
 * entfernt) und lässt sich nicht mehr neu erzeugen: Eingaben hier nicht ändern.
 */

/** RawBlock-Texte aus `tests/unit/views/canvas-sequence/raw.test.ts` und `commands.test.ts`. */
export const FIXTURES = [
	'break b\n    A->>C: y\nend\n',
	'box Aqua Gruppe\nparticipant X as Ix\nactor Y\nend\n',
	'break b\nNote over P,Q: t\nNote left of R: u\nend\n',
	'break b\ncreate participant Z\nlinks Z: {}\nend\n',
	'break b\nA-->>+B: x; B--x-A: y\nend\n',
	'break A wants\nactivate A\ndeactivate A\nend\n',
	'title A->>B: x\n',
	'break b\nA -|\\ B: halb\nend\n',
	'break b\nA-->>+B: x; B--x-A: y\nactivate C\ndeactivate C\nend\n',
	'title activate A\n',
	'box x\nparticipant Teilnehmer1\nend\n',
	'box G\nparticipant X\nend\n'
];

export const ARROWS = [
	'->',
	'-->',
	'->>',
	'-->>',
	'-x',
	'--x',
	'-X',
	'-)',
	'--)',
	'<<->>',
	'<<-->>',
	'-|\\',
	'--|/',
	'/|-',
	'\\\\--'
];
const NAMES = ['A', 'x1', 'Over', 'A-B', 'a b', 'X'];

/**
 * Bewusste Abweichung von der früheren View-Erkennung: `\r`, `\u2028`, `\u2029` im Text nach dem
 * `:` mit nicht-leerem Rest auf derselben Zeile (mermaids `.` endet dort). Adapter: keine
 * Nachricht/Notiz (wie `rawUses` und Parser), View: Nachricht/Notiz. `\r\n` (CRLF) zählt nicht.
 */
export const DEVIATION = /:[^\n]*[\r\u2028\u2029][^\n\r\u2028\u2029]/;
export const DEVIATION_REASON = 'Zeilenende \\r/\\u2028/\\u2029 im Text nach ":"';

/** Zeilen über alle Anweisungsarten, auch Grenzfälle (Entity-`;`, Alias, leere Namen). */
export function corpusLines(): string[] {
	const lines: string[] = [];
	for (const from of NAMES)
		for (const arrow of ARROWS)
			for (const act of ['', '+', '-', ' + '])
				lines.push(`${from}${arrow}${act}B: t`, `${from} ${arrow}${act} B : t`);
	lines.push(
		'participant A as Alpha',
		'participant A B as C',
		'actor  Y',
		'create actor Z as Zed',
		'create participant Q',
		'participant',
		'destroy A',
		'create destroy A',
		'destroy A B',
		'destroy  ',
		'activate A',
		'deactivate  B C',
		'ACTIVATE x',
		'note right of A: n',
		'Note over A, B ,C: n',
		'note over : n',
		'link A: x',
		'properties B: {}',
		'details  C : d',
		'A->>B: a#59; B->>C: b',
		'A->>B: a; B->>C: b;C->>A: c',
		'A->>B: a #amp; b',
		'A->>B',
		':A->>B: x',
		'A<B->>C: x',
		'A->>B:C: x',
		`${'A'.repeat(2001)}->>B: x`,
		'A->>B: x\ry',
		'A->>+B: x\u2028y',
		'A-->>B: x\u2029y',
		'note over A: x\u2028y',
		'note left of A: x\ry',
		''
	);
	return lines;
}

export function corpus(): string[] {
	const lines = corpusLines();
	const texts = lines.map((l) => `break b\n${l}\nend\n`);
	for (let i = 0; i + 3 < lines.length; i += 3) texts.push(lines.slice(i, i + 4).join('\n'));
	// Kurze Proben: `title`/`%%{` am Textanfang schließen den ganzen Text aus (`NO_PARTICIPANTS`).
	texts.push(`title x\n${lines.slice(0, 4).join('\n')}`, `%%{init: {}}%%\n${lines[0]}`);
	return texts;
}

/** Alle RawBlock-Eingaben des Goldens in fester Reihenfolge. */
export const rawTexts = (): string[] => [...FIXTURES, ...corpus()];

/** Raster für `messageLexes`: Namen x Pfeile x Aktivierung x Namen, in dieser Schachtelung. */
export const LEX_NAMES = [
	...NAMES,
	'note',
	'end',
	'loop1',
	'x',
	'X2',
	'a,b',
	'title',
	'1',
	'links'
];
export const LEX_ACTS = ['', '+', '-'];

export function lexGrid(): [string, string, string, string][] {
	const grid: [string, string, string, string][] = [];
	for (const from of LEX_NAMES)
		for (const arrow of ARROWS)
			for (const act of LEX_ACTS) for (const to of LEX_NAMES) grid.push([from, arrow, act, to]);
	return grid;
}

/** Einzelfälle `[from, arrow, activation, to, erwartet]` für `messageLexes`. */
export const LEX_CASES: [string, string, string, string, boolean][] = [
	['B', '-->>', '-', 'A', true],
	['B', '-->>', '-', 'X', true],
	['B', '->>', '-', 'x1', true],
	['B', '->>', '+', 'x1', true],
	['x1', '-x', '', 'X', true],
	['A-B', '->>', '', 'C', true],
	['A', '->>', '', 'Over', false],
	['A', '-|\\', '', 'B', true],
	['B', '/|-', '-', 'A', true],
	['B', '\\\\-', '-', 'X', true],
	['B', '/|-', '+', 'A', true]
];

/** JSON Lines: Kopfzeile `GoldenHead`, danach je Eintrag von `rawTexts()` eine `GoldenEvents`-Zeile. */
export const GOLDEN_FILE = 'grammar.golden.jsonl';

export interface GoldenHead {
	note: string;
	/** `1`/`0` je Rasterpunkt von `lexGrid()` (View-Ergebnis). */
	messageLexes: string;
}

export interface GoldenEvents {
	text: string;
	/** Ergebnis der View-Erkennung. */
	events: unknown;
	/** Nur bei bewusster Abweichung (`DEVIATION`): Grund und Adapter-Soll. */
	deviation?: string;
	adapter?: unknown;
}
