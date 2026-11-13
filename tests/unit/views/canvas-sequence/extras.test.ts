// @vitest-environment jsdom
/**
 * T135 C1 (F-06): Nummerierung (`autonumber`) und Block-Typ `break` im Sequenz-Canvas.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushSync } from 'svelte';
import { compile } from 'svelte/compiler';
import { afterEach, describe, expect, it } from 'vitest';
import {
	addContainer,
	addSection,
	setAutonumber
} from '../../../../src/lib/views/canvas/sequence/commands';
import { textMeasure, toSequence } from '../../../../src/lib/views/canvas/sequence/mapping';
import { apply, codeOf, docOf, makeSync, parseOk, roundTrip, SAMPLE } from './helpers';
import { itemEl, mountSequence, settle, unmountAll } from './mount';

afterEach(unmountAll);

const view = (text: string) => toSequence(parseOk(text), [], textMeasure);
const numbers = (text: string) =>
	view(text)
		.items.filter((i) => i.type === 'message')
		.map((i) => i.number);

describe('Nummerierung: Darstellung', () => {
	it('zählt wie mermaid: start/step, off blendet aus, ohne Zahl weiter', () => {
		const text = [
			'sequenceDiagram',
			'A->>B: a',
			'autonumber',
			'B->>A: b',
			'Note over A: n',
			'A->>B: c',
			'autonumber 10 5',
			'A->>B: d',
			'autonumber off',
			'A->>B: e',
			'autonumber',
			'A->>B: f',
			'autonumber 3',
			'A->>B: g',
			'A->>B: h',
			''
		].join('\n');
		expect(numbers(text)).toEqual([undefined, '2', '3', '10', undefined, '20', '3', '4']);
	});

	it('Nachrichten in Blöcken und RawBlocks zählen mit', () => {
		const text =
			'sequenceDiagram\nautonumber\nA->>B: a; B->>A: b\nloop l\nA->>B: c\nend\nbreak x\nB->>A: d\nend\nactivate A\nA->>B: e\n';
		expect(numbers(text)).toEqual(['3', '4', '5']);
	});

	it('Dezimalschritte gerundet wie mermaid', () => {
		expect(numbers('sequenceDiagram\nautonumber 1 .1\nA->>B: a\nA->>B: b\nA->>B: c\n')).toEqual([
			'1',
			'1.1',
			'1.2'
		]);
	});

	it('autonumber in größerem RawBlock und mit ";" zählt wie mermaid', () => {
		const block =
			'sequenceDiagram\n    A->>B: x\n    par_over p\n        autonumber 5\n        A->>B: y\n    end\n    A->>B: z\n';
		expect(numbers(block)).toEqual([undefined, '6']);
		expect(view(block).autonumber).toBe(true);
		expect(numbers('sequenceDiagram\nautonumber 3; A->>B: y\nA->>B: z\n')).toEqual([undefined]);
		expect(numbers('sequenceDiagram\nautonumber 3 ; A->>B: y\nA->>B: z\n')).toEqual(['4']);
		expect(numbers('sequenceDiagram\nautonumber # an\nA->>B: z\n')).toEqual(['1']);
	});

	it('Schalter-Zustand und Aria der Nachricht', () => {
		const on = view('sequenceDiagram\nautonumber\nA->>B: Hallo\n');
		expect(on.autonumber).toBe(true);
		expect(on.items.find((i) => i.type === 'message')!.aria).toBe('Nachricht 1: Hallo');
		expect(view('sequenceDiagram\nautonumber off\nA->>B: x\n').autonumber).toBe(false);
		expect(view('sequenceDiagram\nA->>B: x\n').autonumber).toBe(false);
	});

	it('autonumber erscheint nicht mehr als "nicht grafisch editierbar"', () => {
		const v = view(
			'sequenceDiagram\nautonumber 2 2\nA->>B: x\nautonumber off\nbox currentcolor G\nparticipant C\nend\n'
		);
		expect(v.rawBlocks.map((r) => r.text)).toEqual(['box currentcolor G\nparticipant C\nend']);
	});
});

describe('Nummerierung: Schalter (Command, Undo)', () => {
	it('einschalten setzt autonumber an den Anfang, Einrückung und Zeilenende wie das Dokument', async () => {
		for (const eol of ['\n', '\r\n']) {
			const text = ['sequenceDiagram', '  A->>B: x', '  B->>A: y', ''].join(eol);
			const sync = await makeSync(text);
			await sync.execute(setAutonumber(true));
			expect(codeOf(sync)).toBe(
				['sequenceDiagram', '  autonumber', '  A->>B: x', '  B->>A: y', ''].join(eol)
			);
			expect(toSequence(docOf(sync), [], textMeasure).autonumber).toBe(true);
			await sync.undo();
			expect(codeOf(sync)).toBe(text);
			await sync.redo();
			expect(codeOf(sync)).toContain(`autonumber${eol}`);
			sync.dispose();
		}
	});

	it('einschalten im leeren Diagramm', async () => {
		const sync = await makeSync('sequenceDiagram\n');
		await sync.execute(setAutonumber(true));
		expect(codeOf(sync)).toBe('sequenceDiagram\n    autonumber\n');
		sync.dispose();
	});

	it('einschalten entfernt vorhandene "autonumber off"', async () => {
		const sync = await makeSync(
			'sequenceDiagram\n    A->>B: x\n    autonumber off\n    B->>A: y\n'
		);
		await sync.execute(setAutonumber(true));
		expect(codeOf(sync)).toBe('sequenceDiagram\n    autonumber\n    A->>B: x\n    B->>A: y\n');
		sync.dispose();
	});

	it('ausschalten entfernt alle autonumber-Anweisungen in einem Schritt, Undo stellt sie her', async () => {
		const text =
			'sequenceDiagram\n    autonumber 5\n    A->>B: x\n    loop l\n        autonumber off\n        B->>A: y\n    end\n    autonumber\n';
		const sync = await makeSync(text);
		await sync.execute(setAutonumber(false));
		expect(codeOf(sync)).toBe(
			'sequenceDiagram\n    A->>B: x\n    loop l\n        B->>A: y\n    end\n'
		);
		expect(docOf(sync).rawBlocks).toEqual([]);
		await sync.undo();
		expect(codeOf(sync)).toBe(text);
		sync.dispose();
	});

	it('ausschalten entfernt nur die Anweisungszeile, Leerzeilen bleiben', async () => {
		for (const [text, expected] of [
			[
				'sequenceDiagram\n    A->>B: x\n\n    autonumber 10 5\n    B->>A: y\n',
				'sequenceDiagram\n    A->>B: x\n\n    B->>A: y\n'
			],
			[
				'sequenceDiagram\n    A->>B: x\n    autonumber\n\n\n',
				'sequenceDiagram\n    A->>B: x\n\n\n'
			],
			['sequenceDiagram\r\n\r\n    autonumber # c\r\n', 'sequenceDiagram\r\n\r\n']
		]) {
			const sync = await makeSync(text);
			await sync.execute(setAutonumber(false));
			expect(codeOf(sync)).toBe(expected);
			await sync.undo();
			expect(codeOf(sync)).toBe(text);
			sync.dispose();
		}
	});

	it('Schalter erfasst autonumber in größerem RawBlock', async () => {
		const text =
			'sequenceDiagram\n    A->>B: x\n    par_over p\n        autonumber 5\n        A->>B: y\n    end\n';
		const sync = await makeSync(text);
		expect(apply(docOf(sync), setAutonumber(true))).toBe(docOf(sync));
		await sync.execute(setAutonumber(false));
		expect(codeOf(sync)).toBe(
			'sequenceDiagram\n    A->>B: x\n    par_over p\n        A->>B: y\n    end\n'
		);
		expect(toSequence(docOf(sync), [], textMeasure).autonumber).toBe(false);
		await sync.undo();
		expect(codeOf(sync)).toBe(text);
		sync.dispose();
	});

	it('Zeilenende ohne Mischung: leeres CRLF-Diagramm, CRLF nur im Frontmatter', async () => {
		for (const [text, expected] of [
			['sequenceDiagram\r\n', 'sequenceDiagram\r\n    autonumber\r\n'],
			[
				'---\r\ntitle: t\r\n---\r\nsequenceDiagram',
				'---\r\ntitle: t\r\n---\r\nsequenceDiagram\r\n    autonumber\r\n'
			]
		]) {
			const sync = await makeSync(text);
			await sync.execute(setAutonumber(true));
			expect(codeOf(sync)).toBe(expected);
			sync.dispose();
		}
	});

	it('accDescr-Block mit Zeile "autonumber" bleibt beim Ein- und Ausschalten unverändert', async () => {
		const desc = '    accDescr {\n    autonumber\n    }\n';
		const text = `sequenceDiagram\n${desc}    A->>B: x\n`;
		const sync = await makeSync(text);
		const block = docOf(sync).rawBlocks.find((r) => r.rawText.includes('accDescr'))!;
		expect(toSequence(docOf(sync), [], textMeasure).autonumber).toBe(false);
		await sync.execute(setAutonumber(true));
		expect(codeOf(sync)).toBe(`sequenceDiagram\n    autonumber\n${desc}    A->>B: x\n`);
		expect(docOf(sync).rawBlocks).toContain(block);
		await sync.execute(setAutonumber(false));
		expect(codeOf(sync)).toBe(text);
		expect(docOf(sync).rawBlocks).toContain(block);
		sync.dispose();
	});

	it('Mischzeile (autonumber mit weiterer Anweisung): Schalter gesperrt statt hängend (O-175)', () => {
		for (const text of [
			'sequenceDiagram\n    autonumber; A->>B: y\n    A->>B: z\n',
			'sequenceDiagram\n    autonumber off; A->>B: y\n    A->>B: z\n',
			'sequenceDiagram\n    autonumber\n    loop l\n        autonumber off; A->>B: y\n    end\n'
		]) {
			const doc = parseOk(text);
			const v = toSequence(doc, [], textMeasure);
			// Vorher: Ausschalten ließ das Modell unverändert, der Schalter blieb ohne Wirkung.
			expect(apply(doc, setAutonumber(!v.autonumber)), text).toBe(doc);
			expect(v.autonumberFixed, text).toBe(true);
		}
		const plain = toSequence(
			parseOk('sequenceDiagram\n    autonumber\n    A->>B: z\n'),
			[],
			textMeasure
		);
		expect(plain.autonumberFixed).toBe(false);
		const comment = 'sequenceDiagram\n    autonumber # c; A->>B: y\n';
		expect(toSequence(parseOk(comment), [], textMeasure).autonumberFixed).toBe(false);
	});

	it('ohne Änderung bleibt das Modell gleich', () => {
		const on = parseOk('sequenceDiagram\nautonumber\nA->>B: x\n');
		expect(apply(on, setAutonumber(true))).toBe(on);
		const off = parseOk('sequenceDiagram\nA->>B: x\n');
		expect(apply(off, setAutonumber(false))).toBe(off);
	});
});

describe('Block-Typ break', () => {
	it('anlegen: kanonisch, Re-Parse gleich, Undo', async () => {
		const text = 'sequenceDiagram\n    A->>B: x\n';
		const { doc, same } = await roundTrip(text, addContainer('break', 'e1'));
		expect(same[0]).toEqual(same[1]);
		expect(doc.containers[0]).toMatchObject({ kind: 'break', label: 'Abbruch' });
		const sync = await makeSync(text);
		await sync.execute(addContainer('break', 'e1'));
		expect(codeOf(sync)).toBe('sequenceDiagram\n    A->>B: x\n    break Abbruch\n    end\n');
		await sync.undo();
		expect(codeOf(sync)).toBe(text);
		sync.dispose();
	});

	it('um eine Nachricht legen', async () => {
		const { same, reparsed } = await roundTrip(
			'sequenceDiagram\n    A->>B: x\n    B->>A: y\n',
			addContainer('break', undefined, 'e2')
		);
		expect(same[0]).toEqual(same[1]);
		expect(reparsed.containers[0].sections[0].memberIds).toEqual(['e2']);
	});

	it('kein Abschnitt in break', () => {
		const doc = parseOk('sequenceDiagram\nbreak b\nA->>B: x\nend\n');
		expect(() => apply(doc, addSection('c1'))).toThrow();
	});

	it('Darstellung als Block mit Schlüsselwort', () => {
		const item = view('sequenceDiagram\nbreak voll\nA->>B: x\nend\n').items.find(
			(i) => i.type === 'container'
		)!;
		expect(item.lines).toEqual(['break [voll]']);
		expect(item.aria).toBe('Block break: voll');
	});
});

describe('SequenceCanvas: Leiste (T135 C1)', () => {
	const toggle = (target: HTMLElement) =>
		target.querySelector<HTMLButtonElement>('button[aria-pressed]')!;

	it('Schalter Nummerierung zeigt den Zustand und schaltet um', async () => {
		const { sync, target } = await mountSequence('sequenceDiagram\n    A->>B: x\n');
		expect(toggle(target).textContent?.trim()).toBe('Nummerierung');
		expect(toggle(target).getAttribute('aria-pressed')).toBe('false');
		toggle(target).click();
		await settle();
		expect(codeOf(sync)).toBe('sequenceDiagram\n    autonumber\n    A->>B: x\n');
		expect(toggle(target).getAttribute('aria-pressed')).toBe('true');
		expect(itemEl(target, 'e1')!.querySelector('.number')!.textContent).toBe('1');
		toggle(target).click();
		await settle();
		expect(codeOf(sync)).toBe('sequenceDiagram\n    A->>B: x\n');
		expect(itemEl(target, 'e1')!.querySelector('.number')).toBeNull();
	});

	it('Mischzeile: Schalter deaktiviert mit sichtbarem Hinweis, sonst ohne Hinweis', async () => {
		const hint =
			'Nummerierung nur im Code änderbar: autonumber steht in einer Zeile mit weiteren Anweisungen';
		const free = await mountSequence('sequenceDiagram\n    autonumber\n    A->>B: x\n');
		expect(toggle(free.target).disabled).toBe(false);
		expect(free.target.textContent).not.toContain(hint);
		const { sync, target } = await mountSequence(
			'sequenceDiagram\n    autonumber; A->>B: y\n    A->>B: z\n'
		);
		expect(toggle(target).disabled).toBe(true);
		expect(toggle(target).getAttribute('aria-pressed')).toBe('true');
		const note = target.querySelector<HTMLElement>('[data-testid="autonumber-fixed"]')!;
		expect(note.textContent?.trim()).toBe(hint);
		expect(toggle(target).getAttribute('aria-describedby')).toBe(note.id);
		toggle(target).click();
		await settle();
		expect(codeOf(sync)).toBe('sequenceDiagram\n    autonumber; A->>B: y\n    A->>B: z\n');
	});

	it('gedrückter Schalter ist sichtbar hervorgehoben', () => {
		const css = compile(
			readFileSync(
				join(__dirname, '../../../../src/lib/views/canvas/sequence/SequenceCanvas.svelte'),
				'utf8'
			),
			{ filename: 'SequenceCanvas.svelte', css: 'external' }
		).css!.code.replace(/:where\(\.svelte-[\w-]+\)|\.svelte-[\w-]+/g, '');
		const body = /\.toolbar button\[aria-pressed=(['"])true\1\]\s*\{([^}]*)\}/.exec(css)?.[2];
		expect(body).toMatch(/background:\s*var\(--accent-soft\)/);
		expect(body).toMatch(/color:\s*var\(--accent\)/);
	});

	it('SAMPLE: autonumber ohne Hinweis "nicht grafisch editierbar"', async () => {
		const { target } = await mountSequence(SAMPLE);
		expect(target.querySelector('[data-testid="raw-blocks"]')).toBeNull();
		expect(toggle(target).getAttribute('aria-pressed')).toBe('true');
	});

	it('Block-Typ break in der Auswahl, anlegen über die Leiste', async () => {
		const { sync, target } = await mountSequence('sequenceDiagram\n    A->>B: x\n');
		const select = target.querySelector<HTMLSelectElement>('[aria-label="Blockart"]')!;
		expect([...select.options].map((o) => o.value)).toContain('break');
		select.value = 'break';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		flushSync();
		[...target.querySelectorAll('button')]
			.find((b) => b.textContent?.trim() === '+ Block')!
			.click();
		await settle();
		expect(codeOf(sync)).toContain('break Abbruch');
	});
});
