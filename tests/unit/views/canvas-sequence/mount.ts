import { flushSync, mount, unmount } from 'svelte';
import SequenceCanvas from '../../../../src/lib/views/canvas/sequence/SequenceCanvas.svelte';
import { makeSync } from './helpers';

const mounted: (() => void)[] = [];

export async function mountSequence(text: string, props: Record<string, unknown> = {}) {
	const sync = await makeSync(text);
	const target = document.createElement('div');
	document.body.append(target);
	const app = mount(SequenceCanvas, { target, props: { sync, ...props } });
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

export async function settle() {
	await new Promise((r) => setTimeout(r, 0));
	flushSync();
}

export function press(el: Element, key: string, init: KeyboardEventInit = {}) {
	el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, ...init }));
	flushSync();
}

export const itemEl = (target: HTMLElement, id: string) =>
	[...target.querySelectorAll<SVGGElement>('[data-id]')].find(
		(el) => el.getAttribute('data-id') === id
	) ?? null;
