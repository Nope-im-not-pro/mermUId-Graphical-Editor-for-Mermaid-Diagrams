// @vitest-environment jsdom
// T105 C1 (V-14, F-14): "Neu" öffnet nach der Ungespeichert-Rückfrage (T101) die Typwahl
// flowchart/sequence mit je drei Vorlagen. Enter legt die Standardvorlage an, Esc bricht ab;
// ein Sequenzdiagramm entsteht ohne Code-Panel.
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { installBrowserStubs, nodeEl } from '../canvas/helpers';
import { button, mountShell, settle, unmountShells } from './helpers';

beforeAll(installBrowserStubs);
afterEach(unmountShells);

const TWO = 'flowchart LR\n  A\n  B\n';

const text = (el: Element | null) => el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
const dialog = () => document.querySelector<HTMLElement>('.dialog[role="dialog"]');
const title = () => text(dialog()?.querySelector('h2') ?? null);
const message = (target: HTMLElement) => text(target.querySelector('[data-testid="message"]'));
const fileLabel = (target: HTMLElement) => text(target.querySelector('[data-testid="file"]'));

function click(el: Element) {
	el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
	flushSync();
}

function key(el: Element, k: string) {
	const e = new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true });
	el.dispatchEvent(e);
	if (k === 'Enter' && !e.defaultPrevented && el instanceof HTMLButtonElement) el.click();
	flushSync();
}

function radio(group: string, label: string): HTMLInputElement {
	const fieldset = [...dialog()!.querySelectorAll('fieldset')].find(
		(f) => text(f.querySelector('legend')) === group
	)!;
	const item = [...fieldset.querySelectorAll('label')].find((l) => text(l) === label);
	if (!item) throw new Error(`Option fehlt: ${group}/${label}`);
	return item.querySelector('input')!;
}

const options = (group: string) =>
	[
		...[...dialog()!.querySelectorAll('fieldset')]
			.find((f) => text(f.querySelector('legend')) === group)!
			.querySelectorAll('label')
	].map(text);

function choose(input: HTMLInputElement) {
	input.click();
	flushSync();
}

async function openNew(target: HTMLElement) {
	const trigger = button(target, 'Neu');
	trigger.focus();
	click(trigger);
	await settle();
	return trigger;
}

describe('T105 C1: Neu-Dialog', () => {
	it('ohne Änderungen: Typwahl mit je drei Vorlagen, "Anlegen" fokussiert', async () => {
		const { target } = await mountShell(TWO);
		await openNew(target);
		expect(title()).toBe('Neues Diagramm');
		expect(options('Diagrammtyp')).toEqual(['Flussdiagramm', 'Sequenzdiagramm']);
		expect(radio('Diagrammtyp', 'Flussdiagramm').checked).toBe(true);
		expect(options('Vorlage')).toEqual(['Leer', 'Ablauf', 'Entscheidung']);
		expect(radio('Vorlage', 'Leer').checked).toBe(true);
		choose(radio('Diagrammtyp', 'Sequenzdiagramm'));
		expect(options('Vorlage')).toEqual(['Leer', 'Anfrage und Antwort', 'Drei Beteiligte']);
		expect(radio('Vorlage', 'Leer').checked).toBe(true);
		expect(text(document.activeElement)).toBe('Anlegen');
	});

	it('Enter legt die Standardvorlage an (leeres flowchart)', async () => {
		const { target } = await mountShell(TWO);
		await openNew(target);
		key(document.activeElement!, 'Enter');
		await settle();
		expect(dialog()).toBeNull();
		expect(message(target)).toBe('Neues Diagramm.');
		expect(nodeEl(target, 'A')).toBeNull();
		expect(target.querySelector('.graph-canvas')).not.toBeNull();
		expect(fileLabel(target)).toBe('Datei: diagramm.mmd');
	});

	it('Esc und Abbrechen: nichts passiert, Fokus zurück zu "Neu"', async () => {
		const { target } = await mountShell(TWO);
		const trigger = await openNew(target);
		key(document.activeElement!, 'Escape');
		await settle();
		expect(dialog()).toBeNull();
		expect(nodeEl(target, 'A')).not.toBeNull();
		expect(document.activeElement).toBe(trigger);
		await openNew(target);
		click([...dialog()!.querySelectorAll('button')].find((b) => text(b) === 'Abbrechen')!);
		await settle();
		expect(dialog()).toBeNull();
		expect(nodeEl(target, 'A')).not.toBeNull();
		expect(message(target)).not.toBe('Neues Diagramm.');
	});

	it('flowchart-Vorlage "Entscheidung" wird angelegt', async () => {
		const { target } = await mountShell(TWO);
		await openNew(target);
		choose(radio('Vorlage', 'Entscheidung'));
		click(button(dialog()!, 'Anlegen'));
		await settle();
		expect(nodeEl(target, 'B')).not.toBeNull();
		expect(nodeEl(target, 'D')).not.toBeNull();
		expect(fileLabel(target)).toBe('Datei: diagramm.mmd');
	});

	it('Sequenzdiagramm ohne Code-Panel: Vorlage anlegen, Teilnehmer grafisch ergänzen', async () => {
		const { target } = await mountShell(TWO);
		await openNew(target);
		choose(radio('Diagrammtyp', 'Sequenzdiagramm'));
		choose(radio('Vorlage', 'Anfrage und Antwort'));
		click(button(dialog()!, 'Anlegen'));
		await settle();
		const seq = target.querySelector('.shell-canvas .sequence-canvas')!;
		expect(seq).not.toBeNull();
		expect(seq.querySelector('[data-id="Client"]')).not.toBeNull();
		expect(seq.querySelector('[data-id="Server"]')).not.toBeNull();
		const before = seq.querySelectorAll('[data-id]').length;
		click(button(target, '+ Teilnehmer'));
		await settle();
		expect(seq.querySelectorAll('[data-id]').length).toBeGreaterThan(before);
		const codeTab = [...target.querySelectorAll('[role="tab"]')].find((el) => text(el) === 'Code');
		expect(codeTab?.getAttribute('aria-selected')).toBe('false');
	});

	it('Enter in der Radiogruppe legt die aktuelle Auswahl an (C1-Fix 2)', async () => {
		const { target } = await mountShell(TWO);
		await openNew(target);
		choose(radio('Diagrammtyp', 'Sequenzdiagramm'));
		const pick = radio('Vorlage', 'Anfrage und Antwort');
		choose(pick);
		pick.focus();
		key(pick, 'Enter');
		await settle();
		expect(dialog()).toBeNull();
		const seq = target.querySelector('.shell-canvas .sequence-canvas')!;
		expect(seq.querySelector('[data-id="Client"]')).not.toBeNull();
		expect(message(target)).toBe('Neues Diagramm.');
	});

	it('Datei-Drop bei offenem Neu- oder Export-Dialog wird ignoriert (C1-Fix 1)', async () => {
		const { target } = await mountShell(TWO);
		const drop = () => {
			const e = new MouseEvent('drop', { bubbles: true, cancelable: true });
			Object.defineProperty(e, 'dataTransfer', {
				value: { types: ['Files'], files: [new File(['flowchart TD\n  D\n'], 'd.mmd')] }
			});
			target.querySelector('.shell')!.dispatchEvent(e);
			expect(e.defaultPrevented).toBe(true);
		};
		await openNew(target);
		drop();
		await settle();
		expect(title()).toBe('Neues Diagramm');
		expect(nodeEl(target, 'D')).toBeNull();
		key(document.activeElement!, 'Escape');
		await settle();
		click(button(target, 'Export'));
		await settle();
		expect(dialog()).not.toBeNull();
		drop();
		await settle();
		expect(nodeEl(target, 'D')).toBeNull();
		expect(fileLabel(target)).toBe('Datei: diagramm.mmd');
	});

	it('mit Änderungen: erst Ungespeichert-Rückfrage, Verwerfen führt zur Typwahl', async () => {
		const { sync, target } = await mountShell(TWO);
		sync.editCode('flowchart LR\n  X\n');
		await sync.flush();
		await settle();
		await openNew(target);
		expect(title()).toBe('Ungespeicherte Änderungen');
		click([...dialog()!.querySelectorAll('button')].find((b) => text(b) === 'Abbrechen')!);
		await settle();
		expect(dialog()).toBeNull();
		await openNew(target);
		click([...dialog()!.querySelectorAll('button')].find((b) => text(b) === 'Verwerfen')!);
		await settle();
		expect(title()).toBe('Neues Diagramm');
		expect(nodeEl(target, 'X')).not.toBeNull();
		key(document.activeElement!, 'Enter');
		await settle();
		expect(nodeEl(target, 'X')).toBeNull();
		expect(message(target)).toBe('Neues Diagramm.');
	});
});
