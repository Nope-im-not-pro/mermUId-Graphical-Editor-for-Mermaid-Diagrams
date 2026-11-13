// @vitest-environment jsdom
import mermaid from 'mermaid';
import { flushSync, mount, unmount } from 'svelte';
import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import { createSync, type SyncController } from '../../../../src/lib/controllers/sync';
import { updateNode } from '../../../../src/lib/model/operations';
import { commandFor } from '../../../../src/lib/views/panels/properties';
import PropertiesPanel from '../../../../src/lib/views/panels/PropertiesPanel.svelte';
import CodePanel from '../../../../src/lib/views/panels/CodePanel.svelte';
import { BAD, ctx, fakeAdapters, flow, flowOut } from './helpers';

const BASE = 'flowchart TD\n  A[Start]\n  B[Ende]\n  A --> B\n';
const timer = { set: () => 0, clear: () => {} };
const tick = () => new Promise((r) => setTimeout(r, 0));

interface FlowDb {
	getVertices(): Map<string, unknown>;
}

async function vertices(text: string): Promise<string[]> {
	await mermaid.parse(text);
	const db = (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as FlowDb;
	return [...db.getVertices().keys()].sort();
}

describe('click-Feld (Befund 1)', () => {
	const doc = flow(BASE);

	it.each([
		['href "https://x.y"; A --> EVIL'],
		['"u" %% c'],
		['"ht"tp"'],
		['href "a"\nB --> C'],
		['href "a\r"'],
		['a"b"c'],
		['href'],
		['href "u" _evil'],
		['cb()'],
		['call cb("x")'],
		['href "u" "t" "z"']
	])('lehnt %j ab', (input) => {
		expect(commandFor(doc, 'A', 'click', input)).toBeNull();
	});

	it.each([
		['href "https://z"', 'click A href "https://z"'],
		['"https://x.y" "Tip"', 'click A href "https://x.y" "Tip"'],
		['  href  "u"   "t t"  _blank ', 'click A href "u" "t t" _blank'],
		['"u" _top', 'click A href "u" _top'],
		['call cb(1, 2)', 'click A call cb(1, 2)'],
		['call cb() "Tip"', 'click A call cb() "Tip"'],
		['cb "Tip"', 'click A cb "Tip"']
	])(
		'%j wird strukturiert ausgegeben, mermaid und Sync-Pfad ohne Zusatzknoten',
		async (input, line) => {
			const cmd = commandFor(doc, 'A', 'click', input);
			expect(cmd).not.toBeNull();
			const out = flowOut(cmd!.do(doc, ctx));
			expect(out.split('\n')).toContain(`  ${line}`);
			expect(await vertices(out)).toEqual(['A', 'B']);
			const sync = await createSync(out, { timer });
			const state = get(sync);
			expect(state).toMatchObject({ mode: 'flowchart', errors: [], conflict: false });
			const model = get(sync.commands).doc;
			expect(model.nodes.map((n) => n.id).sort()).toEqual(['A', 'B']);
			expect(model.nodes.find((n) => n.id === 'A')?.props.click).toBe(line);
			sync.dispose();
		}
	);
});

describe('Command aus aktuellem Dokument (Befund 3b)', () => {
	it('Stil- und click-Patch behält zwischenzeitliche Änderungen', () => {
		const doc = flow(BASE);
		const style = commandFor(doc, 'A', 'style:fill', '#f00')!;
		const click = commandFor(doc, 'A', 'click', 'href "u"')!;
		const later = updateNode(doc, 'A', { style: { stroke: '#00f' }, props: { x: 1 } });
		const a = click.do(style.do(later, ctx), ctx).nodes.find((n) => n.id === 'A');
		expect(a?.style).toEqual({ stroke: '#00f', fill: '#f00' });
		expect(a?.props).toMatchObject({ x: 1, click: 'click A href "u"' });
	});

	it('Element fehlt beim Ausführen: Dokument unverändert', () => {
		const doc = flow(BASE);
		const cmd = commandFor(doc, 'A', 'label', 'X')!;
		const edge = commandFor(doc, doc.edges[0].id, 'label', 'X')!;
		const empty = { ...doc, nodes: [], edges: [] };
		expect(cmd.do(empty, ctx)).toBe(empty);
		expect(edge.do(empty, ctx)).toBe(empty);
	});
});

let cleanup: (() => void) | null = null;
afterEach(() => {
	cleanup?.();
	cleanup = null;
});

function mountIn<P extends Record<string, unknown>>(component: never, props: P) {
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(component, { target, props }) as Record<string, unknown>;
	return { target, app, drop: () => (unmount(app), target.remove()) };
}

const code = (sync: SyncController) => get(sync).code;

describe('PropertiesPanel (Befund 3)', () => {
	async function setup(text: string) {
		const sync = await createSync(text, { adapters: fakeAdapters, timer });
		const m = mountIn(PropertiesPanel as never, { sync, selected: 'A' });
		cleanup = () => (m.drop(), sync.dispose());
		return { sync, target: m.target };
	}

	const input = (target: HTMLElement, value: string) =>
		[...target.querySelectorAll('input')].find((i) => i.value === value)!;

	it('Ablehnung "nur Code" wird im Panel angezeigt', async () => {
		const { sync, target } = await setup(BASE);
		sync.editCode('pie\n  "a": 1\n');
		const field = input(target, 'Start');
		field.value = 'Neu';
		field.dispatchEvent(new Event('change', { bubbles: true }));
		await tick();
		await tick();
		flushSync();
		expect(target.querySelector('[role="alert"]')?.textContent).toContain('nur Code');
	});

	it('Ausstehender Code-Edit bleibt bei Eigenschaftsänderung erhalten', async () => {
		const { sync, target } = await setup(BASE);
		sync.editCode(`${BASE}  style A stroke:#00f\n`);
		const fill = [...target.querySelectorAll('input')].find((i) =>
			i.closest('label')?.textContent?.includes('Füllfarbe')
		)!;
		expect(fill).toBeDefined();
		fill.value = '#f00';
		fill.dispatchEvent(new Event('change', { bubbles: true }));
		await tick();
		await tick();
		expect(code(sync)).toMatch(/style A (stroke:#00f,fill:#f00|fill:#f00,stroke:#00f)/);
		expect(target.querySelector('[role="alert"]')).toBeNull();
	});
});

describe('CodePanel Diff (Befund 4)', () => {
	it('Diff folgt Code-Änderungen während des Konflikts', async () => {
		const sync = await createSync(BASE, { adapters: fakeAdapters, timer });
		const m = mountIn(CodePanel as never, { sync });
		cleanup = () => (m.drop(), sync.dispose());
		await tick();
		sync.editCode(`${BASE}${BAD}\n`);
		await sync.flush();
		// Konflikt nur bei echter Modell-Änderung (T107/O-71); Position ändert die .del-Zeilen nicht.
		await sync.execute({
			label: 'place',
			do: (d) => ({
				...d,
				layout: {
					...d.layout,
					mode: 'manual',
					positions: { ...d.layout.positions, A: [1, 1, 0, 0] }
				}
			})
		});
		await tick();
		await tick();
		const dels = () =>
			[...m.target.querySelectorAll('.diff .del')].map((e) => e.textContent?.trim());
		expect(dels()).toEqual([`- ${BAD}`]);
		sync.editCode(`${BASE}${BAD}\n  C --> D\n`);
		await sync.flush();
		await tick();
		await tick();
		expect(dels()).toEqual([`- ${BAD}`, '-   C --> D']);
	});
});
