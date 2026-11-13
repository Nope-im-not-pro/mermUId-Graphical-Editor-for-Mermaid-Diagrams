import { flushSync, mount, unmount } from 'svelte';
import { createSync, type SyncController } from '../../../../src/lib/controllers/sync';
import GraphCanvas from '../../../../src/lib/views/canvas/graph/GraphCanvas.svelte';
import { fakeAdapters } from '../../controllers/sync/helpers';
import { flowchartAdapter } from '../../../../src/lib/services/adapters/flowchart';
import type { DiagramDocument } from '../../../../src/lib/model/types';

/** Textbreite der Tests: 8 px je Zeichen (ersetzt Canvas `measureText`). */
export const measure = (s: string) => s.length * 8;

export function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

export const SAMPLE = [
	'flowchart LR',
	'  A[Start<br>zwei] --> B{Frage}',
	'  subgraph S1 [Gruppe]',
	'    C --> D',
	'  end',
	'  S1 --> A',
	'  accTitle: Titel',
	''
].join('\n');

/** Fehlende Browser-APIs unter jsdom (nur im Test, O-26). */
export function installBrowserStubs() {
	const g = globalThis as Record<string, unknown>;
	g.ResizeObserver ??= class {
		observe() {}
		unobserve() {}
		disconnect() {}
	};
	window.matchMedia ??= (query: string) =>
		({
			matches: false,
			media: query,
			addEventListener() {},
			removeEventListener() {}
		}) as unknown as MediaQueryList;
	document.elementFromPoint ??= () => null;
	g.DOMMatrixReadOnly ??= class {
		m22 = 1;
		constructor(transform?: string) {
			const scale = /scale\(([\d.]+)\)/.exec(transform ?? '');
			if (scale) this.m22 = Number(scale[1]);
		}
	};
}

const timer = { set: () => 0, clear: () => {} };
const mounted: (() => void)[] = [];

/** Graph-Canvas mit echtem Sync-Controller (Attrappen-Validierung) einhängen. */
export async function mountCanvas(text: string, props: Record<string, unknown> = {}) {
	const sync = await createSync(text, { adapters: fakeAdapters, timer });
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(GraphCanvas, { target, props: { sync, measure, ...props } });
	flushSync();
	mounted.push(() => {
		unmount(app);
		target.remove();
		sync.dispose();
	});
	return { sync, target };
}

export function unmountAll() {
	while (mounted.length > 0) mounted.pop()!();
}

export const nodeEl = (target: HTMLElement, id: string) =>
	target.querySelector<HTMLElement>(`.svelte-flow__node[data-id="${id}"]`);

export function docOf(sync: SyncController): DiagramDocument {
	let doc!: DiagramDocument;
	sync.commands.subscribe((s) => (doc = s.doc))();
	return doc;
}

/** Wartet auf asynchrone Commands des Sync-Controllers. */
export async function settle() {
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}
