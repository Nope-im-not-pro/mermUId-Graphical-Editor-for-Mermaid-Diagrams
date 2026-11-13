// @vitest-environment jsdom
/**
 * T135 C2 (F-06): Teilnehmer-Gruppen (`box`) im Sequenz-Canvas: anlegen, umbenennen, Farbe aus
 * der Allow-Liste, Teilnehmer in/aus Gruppe, auflösen, löschen; je Aktion ein Undo-Schritt.
 */
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it } from 'vitest';
import type { Command } from '../../../../src/lib/controllers/commands/history';
import {
	addBox,
	addMessage,
	deleteElements,
	pointAfter,
	rename,
	setBoxColor,
	setParticipantBox,
	ungroupBox
} from '../../../../src/lib/views/canvas/sequence/commands';
import { textMeasure, toSequence } from '../../../../src/lib/views/canvas/sequence/mapping';
import {
	moveTo,
	participantOrder,
	reorderParticipants,
	stepParticipant
} from '../../../../src/lib/views/canvas/sequence/order';
import { apply, codeOf, docOf, makeSync, parseOk } from './helpers';
import { itemEl, mountSequence, settle, unmountAll } from './mount';

afterEach(unmountAll);

const GROUPED =
	'sequenceDiagram\n    box Aqua Team\n        participant A\n        participant B\n    end\n    A->>B: x\n    B->>C: y\n';

/** Command ausführen, Code prüfen, ein Undo stellt den Ausgangstext her, Redo wieder das Ergebnis. */
async function step(text: string, command: Command) {
	const sync = await makeSync(text);
	await sync.execute(command);
	const code = codeOf(sync);
	const doc = docOf(sync);
	expect(parseOk(code).containers.filter((c) => c.kind === 'box')).toHaveLength(
		doc.containers.filter((c) => c.kind === 'box').length
	);
	await sync.undo();
	expect(codeOf(sync)).toBe(text);
	await sync.redo();
	expect(codeOf(sync)).toBe(code);
	sync.dispose();
	return { code, doc };
}

const boxOf = (text: string) => parseOk(text).containers.find((c) => c.kind === 'box')!;

describe('Gruppe anlegen', () => {
	it('ohne Teilnehmer: leere Gruppe am Anfang', async () => {
		const { code } = await step('sequenceDiagram\n    A->>B: x\n', addBox());
		expect(code).toBe('sequenceDiagram\n    box transparent Gruppe\n    end\n    A->>B: x\n');
	});

	it('mit Teilnehmer: vor seinem ersten Auftreten, ausdrücklich deklariert', async () => {
		const { code } = await step('sequenceDiagram\n    A->>B: x\n    B->>C: y\n', addBox('C'));
		expect(code).toBe(
			'sequenceDiagram\n    A->>B: x\n    box transparent Gruppe\n        participant C\n    end\n    B->>C: y\n'
		);
		expect(boxOf(code).sections[0].memberIds).toEqual(['C']);
	});

	it('Teilnehmer-Reihenfolge bleibt: früher genannte werden vorab deklariert', async () => {
		const text = 'sequenceDiagram\n    A->>B: x\n';
		const { code } = await step(text, addBox('B'));
		expect(code).toBe(
			'sequenceDiagram\n    participant A\n    box transparent Gruppe\n        participant B\n    end\n    A->>B: x\n'
		);
		expect(participantOrder(parseOk(code))).toEqual(['A', 'B']);
		const crlf = await step(text.replace(/\n/g, '\r\n'), addBox('B'));
		expect(crlf.code).toBe(code.replace(/\n/g, '\r\n'));
	});

	it('Mitglied einer anderen Gruppe: neue Gruppe dahinter, Reihenfolge bleibt', async () => {
		const text =
			'sequenceDiagram\n    box Aqua T\n        participant A\n        participant B\n    end\n    A->>B: x\n';
		const { code } = await step(text, addBox('B'));
		expect(code).toBe(
			'sequenceDiagram\n    box Aqua T\n        participant A\n    end\n    box transparent Gruppe\n        participant B\n    end\n    A->>B: x\n'
		);
		expect(participantOrder(parseOk(code))).toEqual(['A', 'B']);
	});

	it('Reihenfolge nicht haltbar: abgelehnt mit Hinweis', () => {
		const doc = parseOk('sequenceDiagram\n    A->>B: x\n    participant A as Al\n');
		expect(() => apply(doc, addBox('B'))).toThrow('Reihenfolge der Teilnehmer');
	});

	it('Teilnehmer aus RawBlock-Deklaration nicht', () => {
		const doc = parseOk('sequenceDiagram\nbox currentcolor G\nparticipant X\nend\nX->>Y: a\n');
		expect(() => apply(doc, addBox('X'))).toThrow('nicht grafisch editierbar');
	});
});

describe('Gruppe bearbeiten', () => {
	it('umbenennen kanonisch, Farbe bleibt', async () => {
		const { code } = await step(GROUPED, rename(boxOf(GROUPED).id, 'Kern; #1'));
		expect(code).toContain('    box Aqua Kern#59; #35;1\n');
		expect(boxOf(code).label).toBe('Kern; #1');
	});

	it('Farbe nur aus der Allow-Liste, leer = ohne Farbe', async () => {
		const id = boxOf(GROUPED).id;
		expect((await step(GROUPED, setBoxColor(id, 'lightblue'))).code).toContain(
			'    box lightblue Team\n'
		);
		expect((await step(GROUPED, setBoxColor(id, 'transparent'))).code).toContain(
			'    box transparent Team\n'
		);
		expect((await step(GROUPED, setBoxColor(id, ''))).code).toContain('    box transparent Team\n');
		const doc = parseOk(GROUPED);
		for (const bad of ['url(x)', '#fff', 'currentcolor', 'red;x', 'red blue']) {
			expect(() => apply(doc, setBoxColor(id, bad)), bad).toThrow('Farbe nicht erlaubt');
		}
		expect(() => apply(doc, setBoxColor('e1', 'red'))).toThrow('Unbekannte ID');
	});

	it('Teilnehmer in eine Gruppe und wieder heraus', async () => {
		const id = boxOf(GROUPED).id;
		const into = await step(GROUPED, setParticipantBox('C', id));
		expect(boxOf(into.code).sections[0].memberIds).toEqual(['A', 'B', 'C']);
		const out = await step(GROUPED, setParticipantBox('A', null));
		expect(out.code).toBe(
			'sequenceDiagram\n    box Aqua Team\n        participant B\n    end\n    participant A\n    A->>B: x\n    B->>C: y\n'
		);
		const doc = parseOk(GROUPED);
		expect(apply(doc, setParticipantBox('A', id))).toBe(doc);
		expect(apply(doc, setParticipantBox('C', null))).toBe(doc);
	});

	it('Teilnehmer, der vor der Gruppe schon vorkommt, nicht hinein (mermaid)', () => {
		const text =
			'sequenceDiagram\n    A->>C: z\n    box G\n        participant B\n    end\n    B->>A: y\n';
		expect(() => apply(parseOk(text), setParticipantBox('A', boxOf(text).id))).toThrow(
			'kommt vor der Gruppe schon vor'
		);
	});

	it('auflösen: Kommentar der Gruppe auf Einrückung der Umgebung', async () => {
		const text =
			'sequenceDiagram\n    box Aqua T\n        %% c\n        participant A\n    end\n    A->>B: x\n';
		const { code } = await step(text, ungroupBox(boxOf(text).id));
		expect(code).toBe('sequenceDiagram\n    %% c\n    participant A\n    A->>B: x\n');
	});

	it('auflösen: Mitglieder an ihrer Stelle, ein Undo', async () => {
		const { code } = await step(GROUPED, ungroupBox(boxOf(GROUPED).id));
		expect(code).toBe(
			'sequenceDiagram\n    participant A\n    participant B\n    A->>B: x\n    B->>C: y\n'
		);
	});

	it('löschen: Gruppe samt Teilnehmern und ihren Nachrichten', async () => {
		const { code } = await step(GROUPED, deleteElements([boxOf(GROUPED).id]));
		expect(code).toBe('sequenceDiagram\n');
	});
});

describe('Gültigkeit (finish)', () => {
	it('Nachricht in eine Gruppe verschieben abgelehnt', () => {
		const doc = parseOk(GROUPED);
		expect(() =>
			apply(doc, moveTo('e1', { parent: boxOf(GROUPED).id, section: 0, index: 0 }))
		).toThrow('nur Teilnehmer');
	});

	it('Nachricht vor der Gruppe, die einen Mitglied nennt, abgelehnt', () => {
		const doc = parseOk(GROUPED);
		expect(() => apply(doc, moveTo('e2', { parent: null, section: 0, index: 0 }))).toThrow(
			'kommt vor der Gruppe schon vor'
		);
	});

	it('neue Nachricht hinter der Gruppe einfügen', () => {
		const doc = parseOk(GROUPED);
		const id = boxOf(GROUPED).id;
		expect(pointAfter(doc, id)).toEqual({ parent: null, section: 0, index: 1 });
		const next = apply(doc, addMessage('A', 'B', '->>', id));
		expect(next.order[1]).toMatch(/^e/);
	});
});

describe('Darstellung und Reihenfolge', () => {
	it('Rahmen um die Mitglieder, Füllung nur aus der Allow-Liste', () => {
		const v = toSequence(parseOk(GROUPED), [], textMeasure);
		const item = v.items.find((i) => i.type === 'box')!;
		const a = v.items.find((i) => i.id === 'A')!;
		const b = v.items.find((i) => i.id === 'B')!;
		const c = v.items.find((i) => i.id === 'C')!;
		expect(item.fill).toBe('Aqua');
		expect(item.aria).toBe('Gruppe: Team (2 Teilnehmer)');
		expect(item.box.x).toBeLessThan(a.box.x);
		expect(item.box.x + item.box.w).toBeGreaterThan(b.box.x + b.box.w);
		expect(item.box.x + item.box.w).toBeLessThan(c.box.x);
		expect(item.box.y).toBeLessThan(a.box.y);
		const plain = toSequence(
			parseOk('sequenceDiagram\nbox G\nparticipant A\nend\n'),
			[],
			textMeasure
		);
		expect(plain.items.find((i) => i.type === 'box')!.fill).toBeUndefined();
	});

	it('Umsortieren hält Mitglieder in der Gruppe', async () => {
		const sync = await makeSync(GROUPED);
		await sync.execute(reorderParticipants(['C', 'B', 'A']));
		const doc = parseOk(codeOf(sync));
		expect(boxOf(codeOf(sync)).sections[0].memberIds).toEqual(['B', 'A']);
		expect(doc.order[0]).toBe('C');
		sync.dispose();
	});

	it('Verschieben über die Gruppengrenze ohne Wirkung: kein Command, keine Änderung', () => {
		const doc = parseOk(GROUPED);
		expect(stepParticipant(doc, 'B', 1)).toBeNull();
		expect(stepParticipant(doc, 'C', -1)).toBeNull();
		expect(apply(doc, reorderParticipants(['A', 'C', 'B']))).toBe(doc);
		expect(stepParticipant(doc, 'A', 1)).not.toBeNull();
	});
});

describe('SequenceCanvas: Leiste Gruppe', () => {
	const select = (target: HTMLElement, label: string) =>
		target.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
	const button = (target: HTMLElement, text: string) =>
		[...target.querySelectorAll<HTMLButtonElement>('button')].find(
			(b) => b.textContent?.trim() === text
		)!;
	const choose = (el: HTMLSelectElement, value: string) => {
		el.value = value;
		el.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
	};
	const focusOn = (target: HTMLElement, id: string) => {
		itemEl(target, id)!.focus();
		flushSync();
	};

	it('anlegen, Farbe wählen, Teilnehmer zuordnen, auflösen', async () => {
		const { sync, target } = await mountSequence('sequenceDiagram\n    A->>B: x\n');
		focusOn(target, 'A');
		button(target, 'Gruppe anlegen').click();
		await settle();
		expect(codeOf(sync)).toBe(
			'sequenceDiagram\n    box transparent Gruppe\n        participant A\n    end\n    A->>B: x\n'
		);
		const id = docOf(sync).containers[0].id;
		expect(itemEl(target, id)!.querySelector('rect.frame')).not.toBeNull();

		focusOn(target, 'B');
		const member = select(target, 'Gruppe des Teilnehmers');
		expect(member.disabled).toBe(false);
		choose(member, id);
		await settle();
		expect(docOf(sync).containers[0].sections[0].memberIds).toEqual(['A', 'B']);

		focusOn(target, id);
		const color = select(target, 'Farbe der Gruppe');
		expect([...color.options].map((o) => o.value)).toContain('transparent');
		expect([...color.options].map((o) => o.value)).not.toContain('url(x)');
		choose(color, 'lightblue');
		await settle();
		expect(codeOf(sync)).toContain('box lightblue Gruppe');
		expect(itemEl(target, id)!.querySelector<SVGRectElement>('rect.frame')!.style.fill).toBe(
			'lightblue'
		);

		focusOn(target, id);
		button(target, 'Gruppe auflösen').click();
		await settle();
		expect(codeOf(sync)).toBe(
			'sequenceDiagram\n    participant A\n    participant B\n    A->>B: x\n'
		);
		await sync.undo();
		expect(codeOf(sync)).toContain('box lightblue Gruppe');
	});

	it('abgelehnte Zuordnung: Auswahl zeigt wieder den Modellwert', async () => {
		const text =
			'sequenceDiagram\n    A->>C: z\n    box G\n        participant B\n    end\n    B->>A: y\n';
		const { sync, target } = await mountSequence(text);
		focusOn(target, 'A');
		const member = select(target, 'Gruppe des Teilnehmers');
		choose(member, docOf(sync).containers[0].id);
		await settle();
		flushSync();
		expect(codeOf(sync)).toBe(text);
		expect(target.textContent).toContain('kommt vor der Gruppe schon vor');
		expect(select(target, 'Gruppe des Teilnehmers').value).toBe('');
	});

	it('Gruppe auflösen und Farbe ohne gewählte Gruppe gesperrt', async () => {
		const { target } = await mountSequence(GROUPED);
		expect(select(target, 'Farbe der Gruppe').disabled).toBe(true);
		expect(button(target, 'Gruppe auflösen').disabled).toBe(true);
		expect(select(target, 'Gruppe des Teilnehmers').disabled).toBe(true);
	});
});
