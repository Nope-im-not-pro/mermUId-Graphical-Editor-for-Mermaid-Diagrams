import { describe, expect, it } from 'vitest';
import {
	FLOW_SHAPES,
	SEQ_ARROW_OPTIONS,
	clickTail,
	commandFor,
	paletteFor,
	panelFor,
	pickerValue,
	type PanelModel
} from '../../../../src/lib/views/panels/properties';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import { ctx, flow, flowOut, seq, seqOut } from './helpers';

const FLOW =
	'flowchart LR\n  A[Start] -->|ja| B((Ende))\n  subgraph S1 [Gruppe]\n    C\n  end\n' +
	'  click A "https://x.y" "Tip"\n  style A fill:#f00\n  linkStyle 0 stroke:#0f0\n  class B foo\n';
const SEQ =
	'sequenceDiagram\n  participant A as Alice\n  actor B\n  A->>+B: Hallo\n  Note over A,B: Text\n' +
	'  alt gut\n    B-->>A: ok\n  else schlecht\n    B-xA: nein\n  end\n  activate A\n';

function apply(doc: DiagramDocument, id: string | null, key: string, value: string) {
	const cmd = commandFor(doc, id, key, value);
	if (!cmd) throw new Error(`kein Command für ${key}`);
	expect(cmd.label).toBe(`Eigenschaft ${key}`);
	return cmd.do(doc, ctx);
}

const value = (p: PanelModel | null, key: string) => p?.fields.find((f) => f.key === key)?.value;
const keys = (p: PanelModel | null) => p?.fields.map((f) => f.key);

describe('panelFor flowchart', () => {
	const doc = flow(FLOW);

	it('Knoten: alle FA-04-Werte, click als Text', () => {
		const p = panelFor(doc, 'A');
		expect(p?.title).toBe('Knoten');
		expect(keys(p)).toEqual([
			'id',
			'label',
			'shape',
			'classes',
			'style:fill',
			'style:stroke',
			'style:stroke-width',
			'style:stroke-dasharray',
			'style:color',
			'click'
		]);
		expect(value(p, 'shape')).toBe('square');
		expect(value(p, 'style:fill')).toBe('#f00');
		expect(value(p, 'click')).toBe('"https://x.y" "Tip"');
		expect(p?.fields[0].kind).toBe('readonly');
		expect(p?.gaps.length).toBeGreaterThan(0);
		expect(value(panelFor(doc, 'B'), 'classes')).toBe('foo');
	});

	it('Formen decken SUBSET ab', () => {
		expect(FLOW_SHAPES.map((o) => o.value)).toEqual(
			expect.arrayContaining(['default', 'square', 'round', 'stadium', 'subroutine', 'cylinder'])
		);
		expect(FLOW_SHAPES).toHaveLength(20);
	});

	it('Kante: Endpunkte inkl. Subgraph, Linie, Spitze, Länge, linkStyle', () => {
		const p = panelFor(doc, 'e1');
		expect(p?.title).toBe('Kante');
		expect(value(p, 'lineStyle')).toBe('solid');
		expect(value(p, 'arrowHead')).toBe('arrow');
		expect(value(p, 'length')).toBe('1');
		expect(value(p, 'style:stroke')).toBe('#0f0');
		const src = p?.fields.find((f) => f.key === 'source');
		expect(src?.options?.map((o) => o.value)).toEqual(['A', 'B', 'C', 'S1']);
		expect(src?.options?.[0].label).toBe('A (Start)');
	});

	it('Subgraph und Diagramm', () => {
		expect(keys(panelFor(doc, 'S1'))).toEqual(['id', 'label', 'direction']);
		const d = panelFor(doc, null);
		expect(d?.title).toBe('Diagramm');
		expect(value(d, 'docDirection')).toBe('LR');
		expect(value(panelFor(flow('graph >\n  A\n'), null), 'docDirection')).toBe('LR');
		expect(value(panelFor(flow('flowchart\n  A\n'), null), 'docDirection')).toBe('TB');
	});

	it('RawBlock nicht grafisch, unbekannte ID null', () => {
		const p = panelFor(doc, 'c2');
		expect(p?.title).toBe('Nicht grafisch editierbar');
		expect(p?.fields).toEqual([]);
		expect(panelFor(doc, 'fehlt')).toBeNull();
		expect(panelFor({ ...doc, diagramType: '' }, 'A')).toBeNull();
	});
});

describe('commandFor flowchart', () => {
	const doc = flow(FLOW);

	it('Knoten-Werte landen im Code ohne Code-Wissen', () => {
		let d = apply(doc, 'A', 'label', 'Los\ngeht');
		d = apply(d, 'A', 'shape', 'diamond');
		d = apply(d, 'A', 'style:fill', '#00f');
		d = apply(d, 'A', 'style:stroke', '#111');
		d = apply(d, 'A', 'click', 'href "https://z"');
		d = apply(d, 'B', 'classes', 'bar, baz bar % a--b x--');
		const out = flowOut(d);
		expect(out).toContain('A{Los geht}');
		expect(out).toContain('style A fill:#00f,stroke:#111');
		expect(out).toContain('click A href "https://z"');
		expect(d.nodes.find((n) => n.id === 'B')?.cssClasses).toEqual(['bar', 'baz']);
		expect(d.modelVersion).toBeGreaterThan(doc.modelVersion);
	});

	it('Leere Werte entfernen Stil und click', () => {
		let d = apply(doc, 'A', 'style:fill', '');
		d = apply(d, 'A', 'click', '  ');
		const a = d.nodes.find((n) => n.id === 'A');
		expect(a?.style).toEqual({});
		expect(a?.props.click).toBeUndefined();
		expect(flowOut(d)).not.toContain('click');
	});

	it('Kante: Linie, Spitze, Länge, Endpunkte, Stil', () => {
		let d = apply(doc, 'e1', 'lineStyle', 'dotted');
		d = apply(d, 'e1', 'length', '3');
		d = apply(d, 'e1', 'arrowHead', 'circle');
		d = apply(d, 'e1', 'target', 'S1');
		d = apply(d, 'e1', 'style:stroke', '');
		expect(flowOut(d)).toContain('A -...-o|ja| S1');
		d = apply(d, 'e1', 'length', '1');
		expect(d.edges[0].props.length).toBeUndefined();
		const inv = apply(doc, 'e1', 'lineStyle', 'invisible');
		expect(inv.edges[0].arrowHead).toBe('none');
		d = apply(d, 'e1', 'source', 'B');
		expect(d.edges[0].sourceId).toBe('B');
		expect(apply(doc, 'e1', 'length', '99').edges[0].props.length).toBe(10);
	});

	it('Subgraph und Diagramm-Richtung', () => {
		let d = apply(doc, 'S1', 'direction', 'LR');
		d = apply(d, 'S1', 'label', 'Neu');
		d = apply(d, null, 'docDirection', 'BT');
		const out = flowOut(d);
		expect(out.startsWith('flowchart BT\n')).toBe(true);
		expect(out).toContain('subgraph S1 [Neu]\n    direction LR');
		const bare = flow('graph\r\n  A\r\n');
		expect(flowOut(apply(bare, null, 'docDirection', 'RL'))).toContain('graph RL\r\n');
		expect(apply(d, 'S1', 'direction', '').containers[0].direction).toBe('');
	});

	it('Ungültiges ergibt null', () => {
		expect(commandFor(doc, 'A', 'shape', 'stern')).toBeNull();
		expect(commandFor(doc, 'A', 'id', 'Z')).toBeNull();
		expect(commandFor(doc, 'A', 'label', 'Start')).toBeNull();
		expect(commandFor(doc, 'A', 'gibtsnicht', 'x')).toBeNull();
		expect(commandFor(doc, 'e1', 'source', 'fehlt')).toBeNull();
		expect(commandFor(doc, 'e1', 'lineStyle', 'wellig')).toBeNull();
		expect(commandFor(doc, 'e1', 'arrowHead', 'stern')).toBeNull();
		expect(commandFor(doc, 'e1', 'length', '0')).toBeNull();
		expect(commandFor(doc, 'e1', 'length', 'abc')).toBeNull();
		expect(commandFor(doc, 'S1', 'direction', 'XX')).toBeNull();
		expect(commandFor(doc, null, 'docDirection', 'XX')).toBeNull();
		expect(commandFor(doc, 'c2', 'label', 'x')).toBeNull();
		expect(commandFor(doc, 'fehlt', 'label', 'x')).toBeNull();
	});

	it('Command liest beim Ausführen den aktuellen Stand', () => {
		const cmd = commandFor(doc, 'A', 'label', 'X');
		const moved = apply(doc, 'A', 'shape', 'round');
		expect(cmd?.do(moved, ctx).nodes[0]).toMatchObject({ label: 'X', shape: 'round' });
		const noDecl = commandFor(doc, null, 'docDirection', 'BT');
		const stripped = { ...doc, rawBlocks: [] };
		expect(noDecl?.do(stripped, ctx)).toBe(stripped);
	});

	it('clickTail', () => {
		expect(clickTail('click A call cb()')).toBe('call cb()');
		expect(clickTail(undefined)).toBe('');
		expect(clickTail('  frei ')).toBe('frei');
	});
});

describe('sequence', () => {
	const doc = seq(SEQ);

	it('Panels je Elementtyp', () => {
		expect(keys(panelFor(doc, 'A'))).toEqual(['id', 'kind', 'label']);
		expect(panelFor(doc, 'A')?.title).toBe('Teilnehmer');
		const note = panelFor(doc, 'n1');
		expect(note?.title).toBe('Notiz');
		expect(keys(note)).toEqual(['label', 'placement', 'noteFrom', 'noteTo']);
		expect(value(note, 'noteTo')).toBe('B');
		const msg = panelFor(doc, 'e1');
		expect(msg?.title).toBe('Nachricht');
		expect(value(msg, 'arrow')).toBe('->>');
		expect(value(msg, 'activation')).toBe('+');
		expect(msg?.fields[0].options?.map((o) => o.value)).toEqual(['A', 'B']);
		expect(panelFor(doc, 'e4')?.title).toBe('Aktivierung');
		const block = panelFor(doc, 'c1');
		expect(block?.title).toBe('Block');
		expect(keys(block)).toEqual(['kind', 'label', 'section:1']);
		expect(block?.fields[0].options?.map((o) => o.value)).toEqual(['alt', 'par', 'critical']);
		const single = panelFor(seq('sequenceDiagram\n  break Fehler\n    A->>B: x\n  end\n'), 'c1');
		expect(single?.fields[0]).toMatchObject({ value: 'break' });
		expect(single?.fields[0].options?.find((o) => o.value === 'break')?.label).toBe(
			'Abbruch (break)'
		);
		expect(panelFor(doc, null)?.gaps.join(' ')).not.toMatch(/\b(?:break|autonumber)\b/);
		expect(panelFor(doc, null)).toMatchObject({ title: 'Diagramm' });
		expect(keys(panelFor(doc, null))).toEqual(['theme']);
	});

	it('Pfeil-Katalog mit Halbpfeilen', () => {
		const tokens = SEQ_ARROW_OPTIONS.map((o) => o.value);
		expect(tokens).toEqual(
			expect.arrayContaining(['->>', '--)', '<<-->>', '-|\\', '--|\\', '/|--'])
		);
		expect(new Set(tokens).size).toBe(tokens.length);
	});

	it('Änderungen als Commands bis in den Code', () => {
		let d = apply(doc, 'A', 'kind', 'actor');
		d = apply(d, 'B', 'label', 'Bob');
		d = apply(d, 'n1', 'placement', 'left of');
		d = apply(d, 'e1', 'arrow', '--)');
		d = apply(d, 'e1', 'activation', '-');
		d = apply(d, 'c1', 'label', 'sehr gut');
		d = apply(d, 'c1', 'section:1', 'mies');
		d = apply(d, 'c1', 'kind', 'par');
		d = apply(d, 'e4', 'activationKind', 'deactivate');
		d = apply(d, 'e4', 'participant', 'B');
		const out = seqOut(d);
		for (const part of [
			'actor A as Alice',
			'actor B as Bob',
			'A--)-B: Hallo',
			'Note left of A: Text',
			'par sehr gut',
			'and mies',
			'deactivate B'
		]) {
			expect(out).toContain(part);
		}
		expect(d.edges[0]).toMatchObject({ lineStyle: 'dotted', arrowHead: 'open' });
	});

	it('Notiz-Teilnehmer', () => {
		let d = apply(doc, 'n1', 'noteTo', '');
		expect(d.nodes[2].props.participants).toEqual(['A']);
		d = apply(d, 'n1', 'noteFrom', 'B');
		d = apply(d, 'n1', 'noteTo', 'A');
		expect(seqOut(d)).toContain('Note over B,A: Text');
	});

	it('Nachricht ohne Token nutzt Linie und Spitze', () => {
		const d = { ...doc, edges: doc.edges.map((e) => ({ ...e, props: {} })) };
		expect(value(panelFor(d, 'e3'), 'arrow')).toBe('-x');
		const odd = { ...doc, edges: doc.edges.map((e) => ({ ...e, lineStyle: '?', props: {} })) };
		expect(value(panelFor(odd, 'e1'), 'arrow')).toBe('->>');
	});

	it('Ungültiges ergibt null', () => {
		expect(commandFor(doc, 'A', 'kind', 'robot')).toBeNull();
		expect(commandFor(doc, 'n1', 'placement', 'unter')).toBeNull();
		expect(commandFor(doc, 'n1', 'noteFrom', 'fehlt')).toBeNull();
		expect(commandFor(doc, 'e1', 'arrow', '=>')).toBeNull();
		expect(commandFor(doc, 'e1', 'activation', '*')).toBeNull();
		expect(commandFor(doc, 'e4', 'activationKind', 'x')).toBeNull();
		expect(commandFor(doc, 'c1', 'kind', 'loop')).toBeNull();
		expect(commandFor(doc, 'c1', 'section:5', 'x')).toBeNull();
		expect(commandFor(doc, null, 'docDirection', 'LR')).toBeNull();
	});

	it('Einzel-Block erlaubt alle Arten', () => {
		const d = seq('sequenceDiagram\n  A->>B: x\n  loop immer\n    A->>B: y\n  end\n');
		const id = d.containers[0].id;
		expect(panelFor(d, id)?.fields[0].options).toHaveLength(7);
		expect(seqOut(apply(d, id, 'kind', 'opt'))).toContain('opt immer');
		expect(seqOut(apply(d, id, 'kind', 'break'))).toContain('break immer');
		const rect = seq('sequenceDiagram\n  rect rgb(1,2,3)\n    A->>B: y\n  end\n');
		expect(panelFor(rect, rect.containers[0].id)?.fields[1].label).toBe('Farbe');
	});
});

describe('Stilfelder (V-20)', () => {
	const doc = flow('flowchart TD\n  A[Start]\n  B\n  A --> B\n  style B stroke-dasharray:3 1\n');
	const field = (id: string, key: string) => panelFor(doc, id)?.fields.find((f) => f.key === key);

	it('Farben als Farbfeld, Strichmuster als Auswahl, Stärke als Text', () => {
		for (const key of ['style:fill', 'style:stroke', 'style:color']) {
			expect(field('A', key)?.kind).toBe('color');
		}
		expect(field('e1', 'style:stroke')?.kind).toBe('color');
		expect(field('A', 'style:stroke-width')?.kind).toBe('text');
		const dash = field('A', 'style:stroke-dasharray');
		expect(dash?.kind).toBe('select');
		expect(dash?.options?.map((o) => o.value)).toEqual(['', '5 5', '2 2', '10 5']);
		expect(dash?.options?.[0].label).toBe('Standard');
		const custom = field('B', 'style:stroke-dasharray');
		expect(custom?.value).toBe('3 1');
		expect(custom?.options?.map((o) => o.value)).toContain('3 1');
	});

	it('Farbwerte nur Hex (flowchart: mermaid lehnt rgb()/rgba() in Stilen ab, O-117)', () => {
		const bad = [
			'url(x)',
			'red',
			'#00f;x',
			'#12',
			'rgb(1,2)',
			'expression(1)',
			'rgb(1, 2, 3)',
			'rgba(0,0,0,0.5)',
			'rgb(1,\n2,3)',
			'rgb(1,\u20282,3)',
			'rgb(1,\t2,3)',
			'#a\tbc',
			'#a\u2028bc'
		];
		for (const v of bad) {
			expect(commandFor(doc, 'A', 'style:fill', v)).toBeNull();
			expect(commandFor(doc, 'e1', 'style:stroke', v)).toBeNull();
		}
		expect(flowOut(apply(doc, 'A', 'style:fill', ' #ABC '))).toContain('style A fill:#ABC');
		expect(flowOut(apply(doc, 'A', 'style:color', '#AbCdEf80'))).toContain('color:#AbCdEf80');
		expect(flowOut(apply(doc, 'e1', 'style:stroke', '#1234'))).toContain(
			'linkStyle 0 stroke:#1234'
		);
	});

	it('Strichmuster nur aus der Auswahl', () => {
		expect(commandFor(doc, 'A', 'style:stroke-dasharray', '7 7')).toBeNull();
		expect(flowOut(apply(doc, 'A', 'style:stroke-dasharray', '5 5'))).toContain(
			'style A stroke-dasharray:5 5'
		);
		const cleared = apply(doc, 'B', 'style:stroke-dasharray', '');
		expect(cleared.nodes.find((n) => n.id === 'B')?.style).toEqual({});
	});

	it('pickerValue liefert #rrggbb für den nativen Farbwähler', () => {
		expect(pickerValue('#abc')).toBe('#aabbcc');
		expect(pickerValue('#ABCDEF')).toBe('#abcdef');
		expect(pickerValue('#11223344')).toBe('#112233');
		expect(pickerValue('#1234')).toBe('#112233');
		expect(pickerValue('rgb(255, 0, 16)')).toBe('#ff0010');
		expect(pickerValue('rgba(1,2,3,0.5)')).toBe('#010203');
		expect(pickerValue('rgb(300,0,0)')).toBe('#000000');
		expect(pickerValue('red')).toBe('#000000');
		expect(pickerValue('rgb(1,\n2,3)')).toBe('#000000');
		expect(pickerValue('rgb(1,\t2,3)')).toBe('#000000');
		expect(pickerValue('')).toBe('#000000');
	});

	it('Gestrichelte Halbpfeile tragen ihr eigenes Token (O-56)', () => {
		const label = (token: string) => SEQ_ARROW_OPTIONS.find((o) => o.value === token)?.label;
		expect(label('-|\\')).toBe('Halbpfeil -|\\');
		expect(label('--|\\')).toBe('Halbpfeil gestrichelt --|\\');
		expect(label('/|--')).toBe('Halbpfeil gestrichelt /|--');
	});
});

describe('Mermaid-Theme (F-09)', () => {
	const BODY = 'flowchart LR\n  A --> B\n';
	const theme = (d: DiagramDocument) => panelFor(d, null)?.fields.find((f) => f.key === 'theme');

	it('Diagramm-Panel zeigt Theme-Auswahl der Allow-Liste, Standard ohne Eintrag', () => {
		const field = theme(flow(BODY));
		expect(field?.kind).toBe('select');
		expect(field?.value).toBe('default');
		expect(field?.options?.map((o) => o.value)).toEqual([
			'default',
			'neutral',
			'dark',
			'forest',
			'base'
		]);
		expect(keys(panelFor(flow(BODY), null))).toEqual(['docDirection', 'theme']);
		expect(
			value(panelFor(flow(`---\nconfig:\n  theme: forest\n---\n${BODY}`), null), 'theme')
		).toBe('forest');
	});

	it('schreibt Frontmatter neu an und "default" entfernt es wieder byte-gleich', () => {
		const doc = flow(BODY);
		const dark = apply(doc, null, 'theme', 'dark');
		expect(flowOut(dark)).toBe(`---\nconfig:\n  theme: dark\n---\n${BODY}`);
		const back = apply(flow(flowOut(dark)), null, 'theme', 'default');
		expect(flowOut(back)).toBe(BODY);
	});

	it('vorhandenes Frontmatter bleibt sonst byte-gleich', () => {
		const head =
			'---\ntitle: "Mein Titel"\n# Notiz\nconfig:\n    look: classic\n    flowchart:\n      curve: basis\n---\n';
		const doc = flow(head + BODY);
		const out = flowOut(apply(doc, null, 'theme', 'neutral'));
		expect(out).toBe(
			'---\ntitle: "Mein Titel"\n# Notiz\nconfig:\n    theme: neutral\n    look: classic\n' +
				'    flowchart:\n      curve: basis\n---\n' +
				BODY
		);
		expect(flowOut(apply(flow(out), null, 'theme', 'default'))).toBe(head + BODY);
		const titled = '---\ntitle: X\n---\n' + BODY;
		const added = flowOut(apply(flow(titled), null, 'theme', 'base'));
		expect(added).toBe('---\ntitle: X\nconfig:\n  theme: base\n---\n' + BODY);
		expect(flowOut(apply(flow(added), null, 'theme', 'default'))).toBe(titled);
	});

	it('ersetzt nur den Wert, Kommentar und Zeilenende bleiben (CRLF)', () => {
		const text = '---\r\nconfig:\r\n  theme: "dark" # mein\r\n---\r\nflowchart LR\r\n  A\r\n';
		const out = flowOut(apply(flow(text), null, 'theme', 'forest'));
		expect(out).toBe(text.replace('"dark"', 'forest'));
		const fresh = flowOut(apply(flow('flowchart LR\r\n  A\r\n'), null, 'theme', 'dark'));
		expect(fresh).toBe('---\r\nconfig:\r\n  theme: dark\r\n---\r\nflowchart LR\r\n  A\r\n');
	});

	it('"default" behält config mit weiteren Schlüsseln und anderes Frontmatter', () => {
		const text = `---\nconfig:\n  theme: dark\n  look: classic\n---\n${BODY}`;
		expect(flowOut(apply(flow(text), null, 'theme', 'default'))).toBe(
			`---\nconfig:\n  look: classic\n---\n${BODY}`
		);
	});

	it('fremder Wert erscheint als eigene Option, Auswahl ersetzt ihn', () => {
		const doc = flow(`---\nconfig:\n  theme: neo\n---\n${BODY}`);
		const field = theme(doc);
		expect(field?.value).toBe('neo');
		expect(field?.options?.at(-1)).toEqual({ value: 'neo', label: 'Nicht unterstützt (neo)' });
		expect(flowOut(apply(doc, null, 'theme', 'dark'))).toContain('  theme: dark\n');
		expect(flowOut(apply(doc, null, 'theme', 'default'))).toBe(BODY);
	});

	it('nur Allow-Listen-Werte, keine Änderung ergibt null', () => {
		const doc = flow(BODY);
		for (const v of ['neo', 'redux', 'dark\n  themeCSS: x', '', 'Dark']) {
			expect(commandFor(doc, null, 'theme', v)).toBeNull();
		}
		expect(commandFor(doc, null, 'theme', 'default')).toBeNull();
	});

	it('Fluss-Schreibweise von config: nur lesend, Wert nicht gelesen (O-174: nur Block-Form)', () => {
		const doc = flow(`---\nconfig: { theme: dark }\n---\n${BODY}`);
		expect(theme(doc)).toMatchObject({ kind: 'readonly', value: 'Nicht lesbar' });
		expect(commandFor(doc, null, 'theme', 'forest')).toBeNull();
	});

	it('Direktive setzt das Theme: Feld schreibgeschützt mit wirksamem Wert und Hinweis', () => {
		const doc = flow(`%%{init: {"theme": "forest"}}%%\n${BODY}`);
		const hint = 'Gesetzt durch eine init-Direktive im Code; nur dort änderbar.';
		expect(theme(doc)).toEqual({
			key: 'theme',
			label: 'Mermaid-Theme',
			kind: 'readonly',
			value: 'forest',
			hint
		});
		expect(commandFor(doc, null, 'theme', 'dark')).toBeNull();
		const fm = flow(`---\nconfig:\n  theme: dark\n---\n%%{init: {"theme": "neo"}}%%\n${BODY}`);
		expect(theme(fm)).toMatchObject({ kind: 'readonly', value: 'neo', hint });
		expect(theme(flow(`%%{init: {"flowchart": {"curve": "basis"}}}%%\n${BODY}`))?.kind).toBe(
			'select'
		);
	});

	it('Direktiven-Lesung nur zur Anzeige: Quotes, initialize, letzte gewinnt, ungültig zählt nicht', () => {
		const value = (head: string) => theme(flow(head + BODY));
		expect(value("%%{init: {'theme':'neutral'}}%%\n")).toMatchObject({ value: 'neutral' });
		expect(value('%%{initialize: {"theme": "base"}}%%\n')).toMatchObject({ value: 'base' });
		expect(value('%%{init: {"theme": "dark"}}%%\n%%{init: {"theme": "forest"}}%%\n')).toMatchObject(
			{ value: 'forest' }
		);
		expect(value('%%{init: {kaputt}}%%\n')?.kind).toBe('select');
	});

	it('nicht einfache Frontmatter-Schlüssel: nur lesend, kein doppelter Schlüssel', () => {
		const hint = 'Diese Schreibweise ist nur im Code änderbar.';
		for (const body of ['config:\n  "theme": neo', '? config\n: { theme: neo }', 'config: &a']) {
			const doc = flow(`---\n${body}\n---\n${BODY}`);
			expect(theme(doc), body).toMatchObject({ kind: 'readonly', hint });
			expect(commandFor(doc, null, 'theme', 'forest'), body).toBeNull();
		}
	});

	it('vorhandenes Frontmatter mit Leerzeile oder Kommentar bleibt nach "default" stehen', () => {
		for (const head of ['---\n\n---\n', '---\n# Notiz\n---\n']) {
			const dark = flowOut(apply(flow(head + BODY), null, 'theme', 'dark'));
			expect(dark).toContain('config:\n  theme: dark\n');
			expect(flowOut(apply(flow(dark), null, 'theme', 'default'))).toBe(head + BODY);
		}
		const text = `---\nconfig:\n  # Notiz\n  theme: dark\n---\n${BODY}`;
		expect(flowOut(apply(flow(text), null, 'theme', 'default'))).toBe(
			`---\nconfig:\n  # Notiz\n---\n${BODY}`
		);
	});

	it('Block-Skalar und andere nicht ersetzbare Werte: nur lesend', () => {
		const hint = 'Diese Schreibweise ist nur im Code änderbar.';
		for (const line of [
			'  theme: >\n    dark',
			'  theme: |-\n    dark',
			'  theme:\n    dark',
			'  theme: dark\n    mode',
			'  theme: dark mode',
			'  theme: "da',
			'  theme: *a',
			'  theme: [dark]'
		]) {
			const doc = flow(`---\nconfig:\n${line}\n---\n${BODY}`);
			expect(theme(doc), line).toMatchObject({ kind: 'readonly', hint });
			expect(commandFor(doc, null, 'theme', 'forest'), line).toBeNull();
		}
		const odd = flow(`---\n"config":\n  theme: neo\n---\n${BODY}`);
		expect(theme(odd)).toMatchObject({ kind: 'readonly', value: 'Nicht lesbar', hint });
		expect(theme(flow(`---\nconfig: { theme: dark }\n---\n${BODY}`))).toMatchObject({ hint });
	});

	it('Sequenz: gleiche Auswahl, Undo-fähiger Command', () => {
		const text = 'sequenceDiagram\n  A->>B: x\n';
		const d = apply(seq(text), null, 'theme', 'forest');
		expect(seqOut(d)).toBe(`---\nconfig:\n  theme: forest\n---\n${text}`);
		expect(keys(panelFor(seq(text), null))).toEqual(['theme']);
	});
});

describe('Farbpalette des Diagramms (T137 C1)', () => {
	const doc = flow(
		'flowchart LR\n  A --> B\n  B --> C\n' +
			'  classDef hot fill:#F00,stroke:#00ff00,color:url(x)\n' +
			'  classDef cool fill:rgb(1,2,3),stroke:red\n' +
			'  style A fill:#f00,stroke:#123456\n' +
			'  style B fill:expression(x),color:#FFF\n' +
			'  linkStyle 0 stroke:#ABCDEF\n  linkStyle 1 stroke:#abcdef\n'
	);

	it('Farben aus style, linkStyle und classDef: dedupliziert, normalisiert, nur Allow-Liste', () => {
		expect(paletteFor(doc)).toEqual(['#f00', '#123456', '#fff', '#abcdef', '#00ff00']);
	});

	it('Klasse am Knoten und classDef default über resolveStyle', () => {
		const d = flow(
			'flowchart LR\n  A\n  classDef default fill:#111\n  classDef x stroke:#222\n  class A x\n'
		);
		expect(paletteFor(d)).toEqual(['#111', '#222']);
	});

	it('Reihenfolge: Knoten-style, dann linkStyle, dann classDef in Definitions-Reihenfolge', () => {
		const d = flow(
			'flowchart LR\n  A --> B\n  classDef y fill:#333\n  classDef x fill:#222\n' +
				'  class A x\n  style B fill:#111\n  linkStyle 0 stroke:#444\n'
		);
		expect(paletteFor(d)).toEqual(['#111', '#444', '#333', '#222']);
	});

	it('Ohne Stile leer; sequence ohne Farbfelder leer', () => {
		expect(paletteFor(flow('flowchart LR\n  A --> B\n'))).toEqual([]);
		expect(paletteFor(seq(SEQ))).toEqual([]);
	});

	it('Jede Palettenfarbe ist als Eingabe gültig und erzeugt einen Command', () => {
		for (const c of paletteFor(doc)) {
			expect(commandFor(doc, 'C', 'style:fill', c)).not.toBeNull();
		}
	});
});
