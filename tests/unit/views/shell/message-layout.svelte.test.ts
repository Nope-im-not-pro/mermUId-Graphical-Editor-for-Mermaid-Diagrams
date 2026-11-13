// @vitest-environment jsdom
// T114 F1 (O-114 b): Die Meldungszeile verschiebt die Arbeitsfläche nicht. Sie hat in jedem
// Zustand (leer, Erfolg/Info, Fehler) dieselbe feste Höhe im Fluss; Zustandsklassen ändern nur
// Farben. Lange Meldungen brechen nicht um (Ellipse), der volle Text steht in `title`.
// jsdom wertet die Svelte-Styles nicht aus (keine Layout-Berechnung), daher prüft der Test die
// Regeln im `<style>`-Block von MessageBar.svelte (T123 C4, vorher Shell.svelte); die echte Box prüft e2e invalid-code (:133/:508).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flushSync } from 'svelte';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { installBrowserStubs } from '../canvas/helpers';
import { button, mountShell, settle, unmountShells } from './helpers';

const source = readFileSync(
	join(__dirname, '../../../../src/lib/views/shell/MessageBar.svelte'),
	'utf8'
);
const style = source.slice(source.lastIndexOf('<style>') + 7, source.lastIndexOf('</style>'));

type Rule = { sel: string[]; at: string[]; decl: Record<string, string> };

/** Trennt an `sep` auf oberster Ebene (nicht in Klammern). */
const splitTop = (text: string, sep: RegExp) => {
	const parts: string[] = [];
	let depth = 0;
	let cur = '';
	for (const ch of text) {
		if (ch === '(') depth++;
		if (ch === ')') depth--;
		if (depth === 0 && sep.test(ch)) {
			parts.push(cur);
			cur = '';
		} else cur += ch;
	}
	return [...parts, cur].map((s) => s.trim()).filter(Boolean);
};

/** Alle Stilregeln mit Selektorliste, umgebendem At-Kontext (`@media ...`) und Deklarationen. */
function parseRules(css: string): Rule[] {
	const out: Rule[] = [];
	const stack: string[] = [];
	let buf = '';
	for (const ch of css.replace(/\/\*[\s\S]*?\*\//g, '')) {
		if (ch === '{') {
			stack.push(buf.trim());
			buf = '';
		} else if (ch === '}') {
			const head = stack.pop() ?? '';
			if (!head.startsWith('@')) {
				const decl: Record<string, string> = {};
				for (const d of splitTop(buf, /;/)) {
					const i = d.indexOf(':');
					if (i > 0) decl[d.slice(0, i).trim().toLowerCase()] = d.slice(i + 1).trim();
				}
				out.push({ sel: splitTop(head, /,/), at: stack.filter((h) => h.startsWith('@')), decl });
			}
			buf = '';
		} else if (ch === ';' && !stack.length) buf = '';
		else buf += ch;
	}
	return out;
}

/** Selektor-Subjekt (letzter Verbund nach Kombinatoren) ist `.message`, z. B. `.message.shown`. */
const subjectIsMessage = (sel: string) =>
	/\.message(?![\w-])/.test(
		(splitTop(sel.replace(/\s*([>+~])\s*/g, ' '), /\s/).at(-1) ?? '').replace(/\([^()]*\)/g, '()')
	);

const rules = parseRules(style);
const own = rules.filter(({ sel }) => sel.some(subjectIsMessage));
const isBase = ({ sel, at }: Rule) => at.length === 0 && sel.includes('.message');

/** Eigenschaften, die Höhe, Lage oder Fluss der Zeile beeinflussen. */
const LAYOUT =
	/^(position|display|box-sizing|float|clear|order|zoom|contain|transform|translate|scale|flex(-.*)?|grid(-.*)?|align-self|justify-self|place-self|(min-|max-)?(height|width|block-size|inline-size)|inset(-.*)?|top|bottom|left|right|padding(-.*)?|margin(-.*)?|border(-(top|bottom|left|right|block|inline)(-(start|end))?)?(-(width|style))?|font|font-size|line-height|white-space|overflow(-.*)?|clip-path|content)$/;

describe('T114 F1: Meldungszeile ohne Layoutsprung (Regeln)', () => {
	it('genau eine Grundregel `.message` außerhalb von At-Regeln', () => {
		expect(own.filter(isBase)).toHaveLength(1);
	});

	it('keine andere `.message`-Regel (Zustände, Pseudoklassen, @media/@supports) setzt Layout', () => {
		const offending = own
			.filter((rule) => !isBase(rule))
			.flatMap(({ sel, at, decl }) =>
				Object.keys(decl)
					.filter((k) => LAYOUT.test(k))
					.map((k) => `${[...at, sel.join(', ')].join(' ')} { ${k} }`)
			);
		expect(offending).toEqual([]);
	});

	it('Grundregel: feste Höhe im Fluss, kein Umbruch', () => {
		const base = own.find(isBase)!.decl;
		expect(base.height).toMatch(/^\d+(\.\d+)?px$/);
		expect(base.flex).toBe('none');
		expect(base['box-sizing']).toBe('border-box');
		expect(base.overflow).toBe('hidden');
		expect(base.position ?? 'static').toBe('static');
		expect(base.display ?? 'block').toBe('block');
		const p = rules.find(({ sel, at }) => !at.length && sel.includes('.message p'))!.decl;
		expect(p['white-space']).toBe('nowrap');
		expect(p['text-overflow']).toBe('ellipsis');
		expect(p.overflow).toBe('hidden');
	});
});

describe('T114 F1: Meldungszeile (DOM)', () => {
	beforeAll(installBrowserStubs);
	afterEach(() => {
		vi.restoreAllMocks();
		unmountShells();
	});

	it('voller Text in title, ohne Meldung kein title; Regionen unverändert', async () => {
		const { sync, target } = await mountShell('flowchart LR\n  A\n  B\n');
		const el = target.querySelector<HTMLElement>('[data-testid="message"]')!;
		expect(el.hasAttribute('title')).toBe(false);
		const long = 'x'.repeat(400);
		vi.spyOn(sync, 'undo').mockRejectedValueOnce(new Error(long));
		button(target, 'Rückgängig').dispatchEvent(
			new MouseEvent('click', { bubbles: true, cancelable: true })
		);
		flushSync();
		await settle();
		expect(el.getAttribute('title')).toBe(`Rückgängig fehlgeschlagen: ${long}`);
		expect(el.querySelector('[role="alert"]')?.textContent?.trim()).toBe(
			`Rückgängig fehlgeschlagen: ${long}`
		);
		expect(el.querySelector('[aria-live="polite"]')).not.toBeNull();
	});
});
