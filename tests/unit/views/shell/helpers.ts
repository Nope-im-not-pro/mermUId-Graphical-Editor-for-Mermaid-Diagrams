import { flushSync, mount, unmount } from 'svelte';
import { vi } from 'vitest';
import { createSync, type SyncController } from '../../../../src/lib/controllers/sync';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import type { RenderResult } from '../../../../src/lib/services/render';
import Shell from '../../../../src/lib/views/shell/Shell.svelte';
import { DRAFT_KEY } from '../../../../src/lib/views/shell/draft';
import { EXPORT_KEY } from '../../../../src/lib/views/shell/exporting';
import { fakeAdapters } from '../../controllers/sync/helpers';
import { measure } from '../canvas/helpers';

export const timer = { set: () => 0, clear: () => {} };
const mounted: (() => void)[] = [];

export const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><text>Vorschau</text></svg>';

export const createFake = (text: string) => createSync(text, { adapters: fakeAdapters, timer });

export async function mountShell(text: string, extra: Record<string, unknown> = {}) {
	const sync = await createFake(text);
	const render = vi.fn(async (): Promise<RenderResult> => ({ ok: true, svg: SVG }));
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(Shell, {
		target,
		props: { sync, render, measure, create: createFake, language: 'de-DE', ...extra }
	});
	flushSync();
	mounted.push(() => {
		unmount(app);
		target.remove();
		sync.dispose();
	});
	return { sync, target, render };
}

export function unmountShells() {
	while (mounted.length > 0) mounted.pop()!();
	// T127 C1: gemerkte Export-Wahl darf nicht in den nächsten Test durchschlagen.
	localStorage.removeItem(EXPORT_KEY);
	// T132 C1 (O-164): Entwurf aus einem Test darf keine Start-Rückfrage im nächsten auslösen.
	localStorage.removeItem(DRAFT_KEY);
}

export function button(target: HTMLElement, label: string): HTMLButtonElement {
	const b = [...target.querySelectorAll('button')].find(
		(el) => el.getAttribute('aria-label') === label || el.textContent?.trim() === label
	);
	if (!b) throw new Error(`Button fehlt: ${label}`);
	return b;
}

export function docOf(sync: SyncController): DiagramDocument {
	let doc!: DiagramDocument;
	sync.commands.subscribe((s) => (doc = s.doc))();
	return doc;
}

export async function settle() {
	for (let i = 0; i < 3; i++) {
		await new Promise((r) => setTimeout(r, 0));
		flushSync();
	}
}
