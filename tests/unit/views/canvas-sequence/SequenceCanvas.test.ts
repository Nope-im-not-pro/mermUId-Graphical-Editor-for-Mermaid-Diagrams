// @vitest-environment jsdom
import { flushSync } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { codeOf, docOf, SAMPLE } from './helpers';
import { itemEl, mountSequence, press, settle, unmountAll } from './mount';
import { applyLocale } from '../../../../src/lib/views/shell/i18n.svelte';

afterEach(unmountAll);

const button = (target: HTMLElement, text: string) =>
	[...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

const control = <T extends HTMLElement>(target: HTMLElement, label: string) =>
	target.querySelector<T>(`[aria-label="${label}"]`)!;

function choose(target: HTMLElement, label: string, value: string) {
	const select = control<HTMLSelectElement>(target, label);
	select.value = value;
	select.dispatchEvent(new Event('change', { bubbles: true }));
	flushSync();
}

async function click(el: HTMLElement) {
	el.click();
	await settle();
}

function focus(target: HTMLElement, id: string) {
	const el = itemEl(target, id)!;
	el.focus();
	flushSync();
	return el;
}

const editor = (target: HTMLElement) => target.querySelector<HTMLTextAreaElement>('.inline-editor');

describe('SequenceCanvas: Darstellung (C1)', () => {
	it('Elemente als fokussierbare SVG-Gruppen, Tab-Reihenfolge = Dokument-Reihenfolge', async () => {
		const { target } = await mountSequence(SAMPLE);
		const els = [...target.querySelectorAll<SVGGElement>('svg [data-id]')];
		expect(els.map((e) => e.getAttribute('data-id'))).toEqual([
			'A',
			'B',
			'e1',
			'n1',
			'c1',
			'e2',
			'c1:1',
			'e3',
			'e4',
			'e5'
		]);
		expect(els.every((e) => e.getAttribute('tabindex') === '0')).toBe(true);
		expect(els[0].getAttribute('aria-label')).toBe('Teilnehmer: Alice');
		expect(els[2].getAttribute('aria-label')).toBe('Nachricht: Hallo');
		expect(itemEl(target, 'A')!.textContent).toContain('Alice');
		expect(target.querySelectorAll('line.lifeline')).toHaveLength(2);
		expect(target.querySelectorAll('rect.bar').length).toBeGreaterThan(0);
		expect(
			itemEl(target, 'e2')!.querySelector('path')!.getAttribute('stroke-dasharray')
		).toBeTruthy();
	});

	it('Labels nur als Text, kein Markup', async () => {
		const { target } = await mountSequence(
			'sequenceDiagram\nA->>B: <img src=x onerror=alert(1)>Hi\n'
		);
		expect(target.querySelector('img')).toBeNull();
		expect(itemEl(target, 'e1')!.textContent).toContain('Hi');
	});

	it('RawBlocks, Hinweise, Verschachtelung als Liste', async () => {
		// T135: autonumber steht nicht mehr in der RawBlock-Liste, box schon.
		const boxed = await mountSequence('sequenceDiagram\nbox currentcolor G\nparticipant C\nend\n');
		const raw = boxed.target.querySelector('[data-testid="raw-blocks"]')!;
		expect(raw.textContent).toContain('box currentcolor G');
		expect(raw.textContent).toContain('nicht grafisch editierbar');
		const { sync, target } = await mountSequence(SAMPLE);
		const outline = target.querySelector('[data-testid="outline"]')!;
		expect(outline.querySelector('ul ul ul')!.textContent).toContain('Nachricht: Ja');
		sync.editCode('sequenceDiagram\nA->>B: x\n%%FEHLER\n');
		await sync.flush();
		flushSync();
		expect(target.querySelector('[data-testid="canvas-issues"]')!.textContent).toContain('Zeile');
	});
});

describe('SequenceCanvas: Bearbeiten (C1)', () => {
	it('F2 öffnet den Editor, Enter übernimmt als Command', async () => {
		const { sync, target } = await mountSequence(SAMPLE);
		press(focus(target, 'e1'), 'F2');
		await settle();
		const area = editor(target)!;
		expect(area.value).toBe('Hallo');
		area.value = 'Neu';
		area.dispatchEvent(new Event('input', { bubbles: true }));
		press(area, 'Delete');
		expect(docOf(sync).edges.some((e) => e.id === 'e1')).toBe(true);
		press(area, 'Enter');
		await settle();
		expect(codeOf(sync)).toContain('A->>+B: Neu');
		expect(editor(target)).toBeNull();
	});

	it('Doppelklick öffnet den Editor, Escape verwirft', async () => {
		const { sync, target } = await mountSequence(SAMPLE);
		itemEl(target, 'A')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
		await settle();
		const area = editor(target)!;
		area.value = 'X';
		press(area, 'Escape');
		await settle();
		expect(editor(target)).toBeNull();
		expect(codeOf(sync)).toContain('participant A as Alice');
	});

	it('Entf löscht das fokussierte Element; ohne Canvas-Fokus nichts', async () => {
		const { sync, target } = await mountSequence(SAMPLE);
		press(document.body, 'Delete');
		await settle();
		expect(docOf(sync).edges.some((e) => e.id === 'e4')).toBe(true);
		press(focus(target, 'e4'), 'Delete');
		await settle();
		expect(codeOf(sync)).not.toContain('Nein');
	});

	it('Ablehnung landet als Status, kein unbehandelter Fehler', async () => {
		const { target } = await mountSequence(
			'sequenceDiagram\nbox currentcolor G\nparticipant X\nend\nX->>Y: a\n'
		);
		press(focus(target, 'X'), 'Delete');
		await settle();
		expect(target.querySelector('.status')!.textContent).toMatch(/^Löschen fehlgeschlagen: /);
		press(focus(target, 'X'), 'F2');
		await settle();
		expect(editor(target)).toBeNull();
	});

	it('Werkzeugleiste legt Teilnehmer, Nachricht, Notiz und Aktivierung an', async () => {
		const { sync, target } = await mountSequence('sequenceDiagram\nparticipant A\nparticipant B\n');
		await click(button(target, '+ Teilnehmer'));
		await click(button(target, '+ Akteur'));
		expect(codeOf(sync)).toContain('participant Teilnehmer1');
		expect(codeOf(sync)).toContain('actor Akteur1');
		choose(target, 'Von', 'B');
		choose(target, 'An', 'A');
		choose(target, 'Pfeil', '--x');
		await click(button(target, '+ Nachricht'));
		expect(codeOf(sync)).toContain('B--xA: Nachricht');
		choose(target, 'Platzierung', 'right of');
		await click(button(target, '+ Notiz'));
		expect(codeOf(sync)).toMatch(/Note right of B: Notiz/);
		await click(button(target, '+ Aktivierung'));
		expect(codeOf(sync)).toContain('activate B');
		expect(codeOf(sync)).toContain('deactivate B');
	});

	it('Fokus meldet Auswahl über onselect, Abschnitt als Block', async () => {
		const onselect = vi.fn();
		const { target } = await mountSequence(SAMPLE, { onselect });
		focus(target, 'e1');
		expect(onselect).toHaveBeenLastCalledWith(['e1']);
		focus(target, 'c1:1');
		expect(onselect).toHaveBeenLastCalledWith(['c1']);
	});

	it('Nachricht ändern: Pfeil des fokussierten Elements', async () => {
		const { sync, target } = await mountSequence('sequenceDiagram\nA->>B: m\n');
		focus(target, 'e1');
		choose(target, 'Nachricht Pfeil', '-)');
		await settle();
		expect(codeOf(sync)).toContain('A-)B: m');
	});

	it('Nachricht-Felder immer vorhanden, ohne Nachricht deaktiviert (keine Verschiebung bei Auswahl)', async () => {
		const { target } = await mountSequence('sequenceDiagram\nA->>B: m\n');
		const labels = ['Nachricht von', 'Nachricht an', 'Nachricht Pfeil'];
		const state = () =>
			labels.map((l) => {
				const s = control<HTMLSelectElement>(target, l);
				return s ? [s.disabled, s.options.length] : null;
			});
		const idle = state();
		expect(idle.map((s) => s?.[0])).toEqual([true, true, true]);
		focus(target, 'e1');
		expect(state().map((s) => s?.[0])).toEqual([false, false, false]);
		expect(state().map((s) => s?.[1])).toEqual(idle.map((s) => s?.[1]));
		expect(control<HTMLSelectElement>(target, 'Nachricht von').value).toBe('A');
		focus(target, 'A');
		expect(state().map((s) => s?.[0])).toEqual([true, true, true]);
	});
});

describe('SequenceCanvas: Blöcke und Umsortieren (C2)', () => {
	it('Block um das fokussierte Element, Abschnitt dazu', async () => {
		const { sync, target } = await mountSequence('sequenceDiagram\nA->>B: m\n');
		focus(target, 'e1');
		choose(target, 'Blockart', 'alt');
		await click(button(target, '+ Block'));
		const code = codeOf(sync);
		expect(code).toMatch(/alt Bedingung\n\s+A->>B: m\n\s*end/);
		const cid = docOf(sync).containers[0].id;
		focus(target, cid);
		await click(button(target, '+ Abschnitt'));
		expect(codeOf(sync)).toContain('else Abschnitt');
	});

	it('Pfeiltasten: Teilnehmer horizontal, Nachrichten vertikal', async () => {
		const { sync, target } = await mountSequence(SAMPLE);
		press(focus(target, 'A'), 'ArrowRight');
		await settle();
		expect(codeOf(sync).indexOf('actor B')).toBeLessThan(codeOf(sync).indexOf('participant A'));
		expect(document.activeElement?.getAttribute('data-id')).toBe('A');
		press(focus(target, 'e1'), 'ArrowDown');
		await settle();
		expect(docOf(sync).order.indexOf('n1')).toBeLessThan(docOf(sync).order.indexOf('e1'));
	});

	it('Ziehen sortiert vertikal und horizontal um', async () => {
		const { sync, target } = await mountSequence(SAMPLE);
		const drag = (id: string, dx: number, dy: number) => {
			const el = itemEl(target, id)!;
			const at = { bubbles: true, clientX: 0, clientY: 0, button: 0 };
			el.dispatchEvent(new MouseEvent('pointerdown', at));
			window.dispatchEvent(new MouseEvent('pointermove', { ...at, clientX: dx, clientY: dy }));
			window.dispatchEvent(new MouseEvent('pointerup', { ...at, clientX: dx, clientY: dy }));
		};
		drag('e1', 0, 2000);
		await settle();
		expect(docOf(sync).order.indexOf('e1')).toBeGreaterThan(docOf(sync).order.indexOf('c1'));
		drag('A', 2000, 0);
		await settle();
		expect(codeOf(sync).indexOf('actor B')).toBeLessThan(codeOf(sync).indexOf('participant A'));
		drag('e2', 1, 1);
		await settle();
		expect(docOf(sync).containers[0].sections[0].memberIds).toEqual(['e2']);
	});
});

describe('SequenceCanvas: Pfeilspitzen und lokalisierte Leiste (T103)', () => {
	const options = (target: HTMLElement, label: string) =>
		[...control<HTMLSelectElement>(target, label).options].map((o) => [o.value, o.text.trim()]);

	it('Marker arrow und half füllen mit currentColor (V-05)', async () => {
		const { target } = await mountSequence(SAMPLE);
		for (const head of ['arrow', 'half']) {
			const marker = [...target.querySelectorAll('marker')].find((m) => m.id.endsWith(`-${head}`))!;
			expect(marker.querySelector('path')!.getAttribute('fill')).toBe('currentColor');
		}
	});

	it('Pfeil, Platzierung, Block: Bezeichnung mit Token, Wert bleibt Token (V-16)', async () => {
		const { target } = await mountSequence('sequenceDiagram\nA->>B: m\n');
		const arrows = options(target, 'Pfeil');
		expect(arrows).toContainEqual(['->>', 'Pfeil (->>)']);
		expect(arrows).toContainEqual(['-->', 'Linie gestrichelt ohne Spitze (-->)']);
		expect(arrows).toContainEqual(['-|\\', 'Halbpfeil (-|\\)']);
		expect(arrows).toContainEqual(['--|\\', 'Halbpfeil gestrichelt (--|\\)']);
		expect(arrows).toContainEqual(['//--', 'Halbpfeil gestrichelt (//--)']);
		expect(options(target, 'Platzierung')).toEqual([
			['over', 'Über (over)'],
			['left of', 'Links neben (left of)'],
			['right of', 'Rechts neben (right of)']
		]);
		const blocks = options(target, 'Blockart');
		expect(blocks.map(([v]) => v)).toEqual([
			'loop',
			'alt',
			'opt',
			'par',
			'critical',
			'rect',
			'break'
		]);
		expect(blocks).toContainEqual(['loop', 'Schleife (loop)']);
		expect(blocks).toContainEqual(['critical', 'Kritisch (critical/option)']);
		focus(target, 'e1');
		expect(options(target, 'Nachricht Pfeil')).toContainEqual([
			'-)',
			'Offene Spitze (asynchron) (-))'
		]);
	});

	it('Sprachwechsel EN: Bezeichnungen englisch, Wert bleibt Token (V-16)', async () => {
		applyLocale('en');
		try {
			const { target } = await mountSequence('sequenceDiagram\nA->>B: m\n');
			expect(options(target, 'Placement')).toContainEqual(['over', 'Over (over)']);
			expect(options(target, 'Arrow')).toContainEqual(['--|\\', 'Half arrow dashed (--|\\)']);
			expect(options(target, 'Block type')).toContainEqual(['loop', 'Loop (loop)']);
		} finally {
			applyLocale('de');
		}
	});
});
