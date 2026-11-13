// T123 C4 (Review C3): Palette-Einfügen - jeder Drop holt seinen eigenen neuen Knoten in den Blick.
import { describe, expect, it, vi } from 'vitest';
import { placeQueue } from '../../../../src/lib/views/shell/palette';

/** Befehl, der erst auf Freigabe einen Knoten anlegt (zwei Drops überlappen sich). */
function delayed(nodes: string[], id: string) {
	let release!: () => void;
	const gate = new Promise<void>((r) => (release = r));
	const run = vi.fn(async () => {
		await gate;
		nodes.push(id);
	});
	return { run, release };
}

describe('placeQueue', () => {
	it('zwei schnelle Drops: jeder zeigt seinen eigenen neuen Knoten', async () => {
		const nodes = ['A'];
		const reveal = vi.fn();
		const place = placeQueue(() => nodes, reveal);
		const first = delayed(nodes, 'N1');
		const second = delayed(nodes, 'N2');
		const done = [place(first.run), place(second.run)];
		await Promise.resolve();
		expect(second.run).not.toHaveBeenCalled();
		first.release();
		second.release();
		await Promise.all(done);
		expect(reveal.mock.calls).toEqual([['N1'], ['N2']]);
	});

	it('ohne neuen Knoten kein reveal; Fehler hält die Folge nicht an', async () => {
		const nodes = ['A'];
		const reveal = vi.fn();
		const place = placeQueue(() => nodes, reveal);
		await place(async () => {});
		await expect(
			place(async () => {
				throw new Error('kaputt');
			})
		).rejects.toThrow('kaputt');
		await place(async () => void nodes.push('B'));
		expect(reveal.mock.calls).toEqual([['B']]);
	});
});
