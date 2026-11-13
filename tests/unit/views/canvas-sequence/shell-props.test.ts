// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { SequenceControl } from '../../../../src/lib/views/canvas/sequence/SequenceCanvas.svelte';
import { docOf } from './helpers';
import { itemEl, mountSequence, press, settle, unmountAll } from './mount';

afterEach(unmountAll);

const TEXT = 'sequenceDiagram\n  participant A\n  participant B\n  A->>B: hi\n';

const button = (target: HTMLElement, text: string) =>
	[...target.querySelectorAll('button')].find((b) => b.textContent?.trim() === text)!;

describe('SequenceCanvas: additive Props der Shell (T21 C3)', () => {
	it('oncontrol.select setzt Auswahl und Fokus, meldet sie über onselect', async () => {
		let control: SequenceControl | null = null;
		const onselect = vi.fn();
		const { target } = await mountSequence(TEXT, {
			onselect,
			oncontrol: (c: SequenceControl) => (control = c)
		});
		control!.select('B');
		await settle();
		expect(document.activeElement).toBe(itemEl(target, 'B'));
		expect(itemEl(target, 'B')!.classList.contains('selected')).toBe(true);
		expect(onselect).toHaveBeenLastCalledWith(['B']);
		control!.focus();
		expect(document.activeElement).toBe(target.querySelector('.surface'));
		control!.select('A', false);
		await settle();
		expect(document.activeElement).toBe(target.querySelector('.surface'));
		expect(itemEl(target, 'A')!.classList.contains('selected')).toBe(true);
		expect(onselect).toHaveBeenLastCalledWith(['A']);
	});

	it('beforedelete: false bricht ab, Shift-Entf meldet force, Button ohne force', async () => {
		const answers = [false, true, true];
		const beforedelete = vi.fn(async () => answers.shift()!);
		const { sync, target } = await mountSequence(TEXT, { beforedelete });
		const el = itemEl(target, 'A')!;
		el.focus();
		press(el, 'Delete');
		await settle();
		expect(beforedelete).toHaveBeenLastCalledWith(['A'], false);
		expect(docOf(sync).nodes.map((n) => n.id)).toEqual(['A', 'B']);
		itemEl(target, 'A')!.focus();
		press(itemEl(target, 'A')!, 'Delete', { shiftKey: true });
		await settle();
		expect(beforedelete).toHaveBeenLastCalledWith(['A'], true);
		expect(docOf(sync).nodes.map((n) => n.id)).toEqual(['B']);
		itemEl(target, 'B')!.focus();
		await settle();
		button(target, 'Löschen').click();
		await settle();
		expect(beforedelete).toHaveBeenLastCalledWith(['B'], false);
		expect(docOf(sync).nodes).toHaveLength(0);
	});

	it('ohne neue Props unverändertes Löschen', async () => {
		const { sync, target } = await mountSequence(TEXT);
		itemEl(target, 'B')!.focus();
		press(itemEl(target, 'B')!, 'Delete');
		await settle();
		expect(docOf(sync).nodes.map((n) => n.id)).toEqual(['A']);
	});
});

describe('SequenceCanvas: Rand der Vorschau-Karte (T126 C1, O-141)', () => {
	it('Outline und Status enden über die Variable --reserve-right links der Karte', () => {
		const source = readFileSync('src/lib/views/canvas/sequence/SequenceCanvas.svelte', 'utf-8');
		const style = source.slice(source.indexOf('<style>'));
		for (const selector of ['.outline', '.status']) {
			const rule = style.match(new RegExp(`\\n\\t\\${selector} \\{([^}]*)\\}`));
			expect(rule, selector).not.toBeNull();
			expect(rule![1], selector).toContain('margin-right: var(--reserve-right, 0);');
		}
		// Die Shell setzt nur die Variable, ohne Regeln auf Kind-Elemente des Canvas.
		const shell = readFileSync('src/lib/views/shell/Workspace.svelte', 'utf-8');
		expect(shell).not.toContain(':global(.sequence-canvas');
	});
});
