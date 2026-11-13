// @vitest-environment jsdom
import { flushSync, mount, unmount } from 'svelte';
import { SvelteMap } from 'svelte/reactivity';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createSync, type SyncController } from '../../../../src/lib/controllers/sync';
import PropertiesPanel from '../../../../src/lib/views/panels/PropertiesPanel.svelte';
import { panelFor } from '../../../../src/lib/views/panels/properties';
import { fakeAdapters } from './helpers';

const timer = { set: () => 0, clear: () => {} };
let cleanup: (() => void) | null = null;

async function setup(text: string, selected: string | null) {
	const sync = await createSync(text, { adapters: fakeAdapters, timer });
	const target = document.createElement('div');
	document.body.append(target);
	/** Reaktive Auswahl ohne Runes: SvelteMap als Signal hinter dem Prop-Getter. */
	const state = new SvelteMap<'selected', string | null>([['selected', selected]]);
	const app = mount(PropertiesPanel, {
		target,
		props: {
			sync,
			get selected() {
				return state.get('selected') ?? null;
			}
		}
	});
	cleanup = () => {
		unmount(app);
		target.remove();
		sync.dispose();
	};
	const select = (id: string | null) => {
		state.set('selected', id);
		flushSync();
	};
	return { sync, target, select };
}

/** Zugänglicher Name wie `getByLabelText`: aria-labelledby, aria-label, `<label for>`. */
function nameOf(el: Element): string {
	const by = el.getAttribute('aria-labelledby');
	if (by) {
		return by
			.split(/\s+/)
			.map((id) => document.getElementById(id)?.textContent ?? '')
			.join(' ')
			.trim();
	}
	const aria = el.getAttribute('aria-label');
	if (aria) return aria.trim();
	const labels = (el as HTMLInputElement).labels;
	return labels ? [...labels].map((l) => (l.textContent ?? '').trim()).join(' ') : '';
}

const CONTROLS = 'input, select, textarea, output';

function getByLabelText(root: Element, name: string): HTMLInputElement {
	const hits = [...root.querySelectorAll(CONTROLS)].filter((el) => nameOf(el) === name);
	if (hits.length !== 1) throw new Error(`${hits.length} Treffer für Label "${name}"`);
	return hits[0] as HTMLInputElement;
}

function change(el: HTMLInputElement | HTMLSelectElement, value: string) {
	el.value = value;
	el.dispatchEvent(new Event('change', { bubbles: true }));
}

const code = (sync: SyncController) => {
	let text = '';
	sync.subscribe((s) => (text = s.code))();
	return text;
};

const settle = () => new Promise((r) => setTimeout(r, 0));

afterEach(() => cleanup?.());

describe('PropertiesPanel', () => {
	it('Text-Feld ändert Label per Command, Undo möglich', async () => {
		const { sync, target } = await setup('flowchart TD\n  A[Start]\n', 'A');
		expect(target.querySelector('h2')?.textContent).toBe('Knoten');
		const input = [...target.querySelectorAll('input')].find((i) => i.value === 'Start')!;
		input.value = '<b>Neu</b>';
		input.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();
		flushSync();
		expect(code(sync)).toContain('A["<b>Neu</b>"]');
		expect(target.querySelector('b')).toBeNull();
		await sync.undo();
		expect(code(sync)).toContain('A[Start]');
	});

	it('Auswahlfeld ändert Form, click nur als Text', async () => {
		const { sync, target } = await setup(
			'flowchart TD\n  A[Start]\n  click A call alert(1)\n',
			'A'
		);
		const select = target.querySelector('select')!;
		select.value = 'round';
		select.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();
		expect(code(sync)).toContain('A(Start)');
		expect(target.querySelector('a')).toBeNull();
		const inputs = [...target.querySelectorAll('input')];
		expect(inputs.some((i) => i.value === 'call alert(1)')).toBe(true);
		expect(target.querySelector('summary')?.textContent).toBe('Nur im Code änderbar');
	});

	it('Unveränderter Wert erzeugt keinen Command; Modus Code zeigt Hinweis', async () => {
		const { sync, target } = await setup('flowchart TD\n  A[Start]\n', 'A');
		const input = [...target.querySelectorAll('input')].find((i) => i.value === 'Start')!;
		input.dispatchEvent(new Event('change', { bubbles: true }));
		await settle();
		let canUndo = true;
		sync.commands.subscribe((c) => (canUndo = c.canUndo))();
		expect(canUndo).toBe(false);
		cleanup?.();
		const other = await setup('pie\n  "a": 1\n', null);
		expect(other.target.textContent).toContain('Keine Eigenschaften');
	});
});

describe('PropertiesPanel V-20', () => {
	const FLOW =
		'flowchart LR\n  A[Start] -->|ja| B((Ende))\n  subgraph S1 [Gruppe]\n    C\n  end\n' +
		'  style A fill:#f00\n';
	const SEQ =
		'sequenceDiagram\n  participant A as Alice\n  actor B\n  A->>+B: Hallo\n  Note over A,B: Text\n' +
		'  alt gut\n    B-->>A: ok\n  else schlecht\n    B-xA: nein\n  end\n  activate A\n';

	it.each([
		[FLOW, ['A', 'e1', 'S1', null]],
		[SEQ, ['A', 'e1', 'n1', 'c1', 'e4']]
	])('Jedes Feld hat einen zugänglichen Namen (%#)', async (text, ids) => {
		const { sync, target, select } = await setup(text, ids[0]);
		for (const id of ids) {
			select(id);
			const panel = panelFor(get(sync.commands).doc, id)!;
			expect(panel.fields.length).toBeGreaterThan(0);
			for (const field of panel.fields) {
				expect(getByLabelText(target, field.label).id).not.toBe('');
				if (field.kind === 'color') {
					expect(getByLabelText(target, `${field.label} (Farbwähler)`).type).toBe('color');
				}
			}
			const names = [...target.querySelectorAll(CONTROLS)].map(nameOf);
			expect(names.every((n) => n !== '')).toBe(true);
			expect(new Set(names).size).toBe(names.length);
		}
	});

	it('Farbwähler und Textfeld schreiben denselben Wert', async () => {
		const { sync, target } = await setup('flowchart TD\n  A[Start]\n', 'A');
		const picker = getByLabelText(target, 'Füllfarbe (Farbwähler)');
		expect(picker.type).toBe('color');
		change(picker, '#00ff00');
		await settle();
		flushSync();
		expect(code(sync)).toContain('style A fill:#00ff00');
		expect(getByLabelText(target, 'Füllfarbe').value).toBe('#00ff00');
		change(getByLabelText(target, 'Füllfarbe'), '#abc');
		await settle();
		flushSync();
		expect(code(sync)).toContain('style A fill:#abc');
		expect(getByLabelText(target, 'Füllfarbe (Farbwähler)').value).toBe('#aabbcc');
	});

	it('Strichmuster ist ein Auswahlfeld', async () => {
		const { sync, target } = await setup('flowchart TD\n  A[Start]\n', 'A');
		const dash = getByLabelText(target, 'Strichmuster') as unknown as HTMLSelectElement;
		expect(dash.tagName).toBe('SELECT');
		expect([...dash.options].map((o) => o.value)).toEqual(['', '5 5', '2 2', '10 5']);
		change(dash, '5 5');
		await settle();
		expect(code(sync)).toContain('style A stroke-dasharray:5 5');
	});

	it('Ungültige Farbe meldet, ändert den Code nicht; Auswahlwechsel leert die Meldung', async () => {
		const { sync, target, select } = await setup('flowchart TD\n  A[Start]\n  B\n', 'A');
		const before = code(sync);
		change(getByLabelText(target, 'Füllfarbe'), 'url(x)');
		await settle();
		flushSync();
		expect(target.querySelector('[role="alert"]')?.textContent).toBe('Ungültiger Wert: url(x)');
		expect(code(sync)).toBe(before);
		select('B');
		expect(target.querySelector('[role="alert"]')).toBeNull();
	});

	it('Gleicher Wert nach Normalisierung meldet nichts (P3-4)', async () => {
		const { sync, target } = await setup('flowchart TD\n  A[Start]\n  style A fill:red\n', 'A');
		const before = code(sync);
		change(getByLabelText(target, 'Füllfarbe'), ' red ');
		await settle();
		flushSync();
		expect(target.querySelector('[role="alert"]')).toBeNull();
		expect(code(sync)).toBe(before);
	});

	it('Theme-Auswahl schreibt Frontmatter, ein Undo-Schritt je Wechsel (F-09)', async () => {
		const text = 'flowchart TD\n  A[Start]\n';
		const { sync, target } = await setup(text, null);
		const select = getByLabelText(target, 'Mermaid-Theme') as unknown as HTMLSelectElement;
		expect(select.tagName).toBe('SELECT');
		change(select, 'dark');
		await settle();
		flushSync();
		expect(code(sync)).toBe(`---\nconfig:\n  theme: dark\n---\n${text}`);
		change(getByLabelText(target, 'Mermaid-Theme'), 'forest');
		await settle();
		flushSync();
		expect(code(sync)).toBe(`---\nconfig:\n  theme: forest\n---\n${text}`);
		await sync.undo();
		expect(code(sync)).toBe(`---\nconfig:\n  theme: dark\n---\n${text}`);
		await sync.undo();
		expect(code(sync)).toBe(text);
	});

	it('Theme aus Direktive: schreibgeschützt mit sichtbarem Hinweis', async () => {
		const text = '%%{init: {"theme": "forest"}}%%\nflowchart TD\n  A[Start]\n';
		const { target } = await setup(text, null);
		const output = getByLabelText(target, 'Mermaid-Theme');
		expect(output.tagName).toBe('OUTPUT');
		expect(output.textContent).toBe('forest');
		const hint = document.getElementById(output.getAttribute('aria-describedby') ?? '');
		expect(hint?.textContent).toBe('Gesetzt durch eine init-Direktive im Code; nur dort änderbar.');
	});

	it('Fehler aus execute verschwindet nach Auswahlwechsel', async () => {
		const { sync, target, select } = await setup('flowchart TD\n  A[Start]\n  B\n', 'A');
		const spy = vi.spyOn(sync, 'execute').mockRejectedValue(new Error('kaputt'));
		change(getByLabelText(target, 'Beschriftung'), 'Neu');
		await settle();
		flushSync();
		expect(target.querySelector('[role="alert"]')?.textContent).toBe('kaputt');
		select('B');
		expect(target.querySelector('[role="alert"]')).toBeNull();
		select(null);
		select('A');
		expect(target.querySelector('[role="alert"]')).toBeNull();
		spy.mockRestore();
	});

	it('Späte Fehler einer alten Auswahl erscheinen nicht', async () => {
		const { sync, target, select } = await setup('flowchart TD\n  A[Start]\n  B\n', 'A');
		let reject: (e: Error) => void = () => {};
		vi.spyOn(sync, 'execute').mockReturnValue(new Promise((_r, rj) => (reject = rj)));
		change(getByLabelText(target, 'Beschriftung'), 'Neu');
		select('B');
		reject(new Error('spät'));
		await settle();
		flushSync();
		expect(target.querySelector('[role="alert"]')).toBeNull();
	});
});

describe('PropertiesPanel Farbpalette (T137 C1)', () => {
	const TEXT =
		'flowchart LR\n  A[Start] --> B\n  style B fill:#123456\n  linkStyle 0 stroke:#ABCDEF\n';
	const swatches = (target: Element, label: string) => {
		const group = target.querySelector(`[role="group"][aria-label="${label}: Farben im Diagramm"]`);
		return [...(group?.querySelectorAll('button') ?? [])] as HTMLButtonElement[];
	};
	const undoable = (sync: SyncController) => {
		let n = 0;
		sync.commands.subscribe((c) => (n = c.canUndo ? 1 : 0))();
		return n === 1;
	};

	it('Swatches: Buttons mit Farbwert als Namen, per Tastatur erreichbar', async () => {
		const { target } = await setup(TEXT, 'A');
		const list = swatches(target, 'Füllfarbe');
		expect(list.map((b) => b.getAttribute('aria-label'))).toEqual(['#123456', '#abcdef']);
		for (const b of list) {
			expect(b.getAttribute('type')).toBe('button');
			expect(b.tabIndex).toBeGreaterThanOrEqual(0);
			expect(b.disabled).toBe(false);
		}
		expect(swatches(target, 'Linienfarbe')).toHaveLength(2);
	});

	it('Swatch setzt den Wert wie eine Eingabe, ein Undo-Schritt', async () => {
		const { sync, target } = await setup(TEXT, 'A');
		const before = code(sync);
		const pick = () => swatches(target, 'Füllfarbe').find((b) => b.title === '#abcdef')!;
		pick().click();
		await settle();
		flushSync();
		expect(code(sync)).toContain('style A fill:#abcdef');
		expect(getByLabelText(target, 'Füllfarbe').value).toBe('#abcdef');
		expect(getByLabelText(target, 'Füllfarbe (Farbwähler)').value).toBe('#abcdef');
		expect(pick().getAttribute('aria-pressed')).toBe('true');
		await sync.undo();
		expect(code(sync)).toBe(before);
		expect(undoable(sync)).toBe(false);
	});

	it('Swatch mit gleichem Wert erzeugt keinen Schritt', async () => {
		const { sync, target } = await setup(TEXT, 'B');
		const before = code(sync);
		const same = swatches(target, 'Füllfarbe')[0];
		expect(same.getAttribute('aria-pressed')).toBe('true');
		same.click();
		await settle();
		flushSync();
		expect(code(sync)).toBe(before);
		expect(undoable(sync)).toBe(false);
		expect(target.querySelector('[role="alert"]')).toBeNull();
	});

	it('Ohne Farben im Dokument keine Palette', async () => {
		const { target } = await setup('flowchart LR\n  A --> B\n', 'A');
		expect(target.querySelector('[role="group"]')).toBeNull();
	});
});

describe('PropertiesPanel Klassen (T137 C2)', () => {
	const STYLED = 'flowchart LR\n  A[Start] --> B\n  style A fill:#f00,stroke:#00f\n';
	const CLASSES =
		'flowchart LR\n  A[Start] --> B\n  classDef hot fill:#f00,stroke:red\n' +
		'  classDef cool fill:#abc\n  class A hot\n';
	const section = (target: Element) =>
		[...target.querySelectorAll('section section')].find(
			(s) => s.querySelector('h3')?.textContent === 'Klassen im Diagramm'
		);
	const toggles = (target: Element) =>
		[...(section(target)?.querySelectorAll('button[data-class]') ?? [])] as HTMLButtonElement[];
	const steps = (sync: SyncController) => {
		let state = { canUndo: false, canRedo: false };
		sync.commands.subscribe((c) => (state = { canUndo: c.canUndo, canRedo: c.canRedo }))();
		return state;
	};
	async function submit(target: Element, name: string) {
		const input = getByLabelText(target, 'Name der neuen Klasse');
		input.value = name;
		input.dispatchEvent(new Event('input', { bubbles: true }));
		flushSync();
		const button = [...target.querySelectorAll('button[type="submit"]')].find(
			(b) => b.textContent === 'Als Klasse speichern'
		) as HTMLButtonElement;
		button.click();
		await settle();
		await settle();
		flushSync();
		return input;
	}

	it('Als Klasse speichern: classDef und class als ein Undo-Schritt, Fokus auf neuer Klasse', async () => {
		const { sync, target } = await setup(STYLED, 'A');
		const before = code(sync);
		await submit(target, ' hot ');
		const out = code(sync);
		expect(out).toContain('classDef hot fill:#f00,stroke:#00f');
		expect(out).toContain('class A hot');
		expect(out).not.toContain('style A');
		const hot = toggles(target).find((b) => b.dataset.class === 'hot')!;
		expect(hot.getAttribute('aria-pressed')).toBe('true');
		expect(document.activeElement).toBe(hot);
		expect(getByLabelText(target, 'Füllfarbe').value).toBe('');
		// Kein übertragbarer Stil mehr: Speichern-Formular verschwindet.
		expect(target.querySelector('button[type="submit"]')).toBeNull();
		await sync.undo();
		expect(code(sync)).toBe(before);
		expect(steps(sync).canUndo).toBe(false);
	});

	it('Ungültiger Name meldet am Feld, ändert nichts; Auswahlwechsel leert Feld und Meldung', async () => {
		const { sync, target, select } = await setup(STYLED, 'A');
		const before = code(sync);
		const input = await submit(target, 'end');
		const alert = section(target)?.querySelector('[role="alert"]');
		expect(alert?.textContent).toBe('"end" ist in mermaid reserviert.');
		expect(input.getAttribute('aria-invalid')).toBe('true');
		expect(input.getAttribute('aria-describedby')).toBe(alert?.id);
		expect(code(sync)).toBe(before);
		expect(steps(sync).canUndo).toBe(false);
		select('B');
		select('A');
		expect(getByLabelText(target, 'Name der neuen Klasse').value).toBe('');
		expect(section(target)?.querySelector('[role="alert"]')).toBeNull();
	});

	it('Liste mit Vorschau; Zuweisen und Entfernen je ein Undo-Schritt, Fokus bleibt', async () => {
		const { sync, target, select } = await setup(CLASSES, 'B');
		const before = code(sync);
		const list = toggles(target);
		expect(list.map((b) => [b.dataset.class, b.getAttribute('aria-pressed')])).toEqual([
			['hot', 'false'],
			['cool', 'false']
		]);
		const preview = list[0].querySelector<HTMLElement>('.preview')!;
		expect(preview.getAttribute('aria-hidden')).toBe('true');
		expect(preview.style.background).not.toBe('');
		expect(preview.style.borderColor).toBe('');
		expect(list[0].textContent?.trim()).toContain('hot');

		const cool = list[1];
		cool.focus();
		cool.click();
		await settle();
		flushSync();
		expect(code(sync)).toContain('class B cool');
		expect(cool.getAttribute('aria-pressed')).toBe('true');
		expect(document.activeElement).toBe(cool);
		await sync.undo();
		expect(code(sync)).toBe(before);
		expect(steps(sync).canUndo).toBe(false);

		select('A');
		const hot = toggles(target).find((b) => b.dataset.class === 'hot')!;
		expect(hot.getAttribute('aria-pressed')).toBe('true');
		hot.click();
		await settle();
		flushSync();
		expect(code(sync)).not.toContain('class A hot');
		expect(hot.getAttribute('aria-pressed')).toBe('false');
		await sync.undo();
		expect(code(sync)).toBe(before);
	});

	it('Ohne Klassen und Stil, an Kanten und in sequence keine Klassen-Liste', async () => {
		const { target, select } = await setup('flowchart LR\n  A --> B\n', 'A');
		expect(section(target)).toBeUndefined();
		select('e1');
		expect(section(target)).toBeUndefined();
		cleanup?.();
		const other = await setup('sequenceDiagram\n  A->>B: x\n', 'A');
		expect(section(other.target)).toBeUndefined();
	});
});
