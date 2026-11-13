// T127 C2 (F-08): Bild in die Zwischenablage über ClipboardItem; Clipboard gemockt.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { canCopy, copyBlob } from '../../../../src/lib/services/export/clipboard';

/** Attrappe für ClipboardItem: merkt die übergebenen Daten. */
function fakeItem(supports?: (type: string) => boolean) {
	class Item {
		constructor(readonly items: Record<string, Blob | Promise<Blob>>) {}
		static supports = supports;
	}
	if (!supports) delete (Item as { supports?: unknown }).supports;
	return Item;
}

function stub(write: ((items: unknown[]) => Promise<void>) | undefined, item: unknown) {
	vi.stubGlobal('navigator', { clipboard: write ? { write } : {} });
	vi.stubGlobal('ClipboardItem', item);
}

const png = new Blob(['png'], { type: 'image/png' });

afterEach(() => vi.unstubAllGlobals());

describe('canCopy', () => {
	it('write und ClipboardItem vorhanden, ohne supports: beide Arten', () => {
		stub(async () => {}, fakeItem());
		expect(canCopy('png')).toBe(true);
		expect(canCopy('svg')).toBe(true);
	});

	it('ClipboardItem.supports entscheidet je MIME-Typ', () => {
		const supports = vi.fn((type: string) => type === 'image/png');
		stub(async () => {}, fakeItem(supports));
		expect(canCopy('png')).toBe(true);
		expect(canCopy('svg')).toBe(false);
		expect(supports.mock.calls).toEqual([['image/png'], ['image/svg+xml']]);
	});

	it('nicht unterstützt: ohne clipboard.write, ohne ClipboardItem, supports wirft', () => {
		stub(undefined, fakeItem());
		expect(canCopy('png')).toBe(false);
		stub(async () => {}, undefined);
		expect(canCopy('png')).toBe(false);
		vi.stubGlobal('navigator', undefined);
		expect(canCopy('svg')).toBe(false);
		stub(
			async () => {},
			fakeItem(() => {
				throw new Error('kaputt');
			})
		);
		expect(canCopy('png')).toBe(false);
	});
});

describe('copyBlob', () => {
	it('schreibt ein ClipboardItem mit dem MIME-Typ der Art', async () => {
		const write = vi.fn<(items: unknown[]) => Promise<void>>(async () => {});
		stub(write, fakeItem());
		await copyBlob('png', png);
		expect(write).toHaveBeenCalledTimes(1);
		const [items] = write.mock.calls[0];
		expect(items).toHaveLength(1);
		expect((items[0] as { items: unknown }).items).toEqual({ 'image/png': png });
	});

	it('Promise eines Blobs geht unverändert ins ClipboardItem (Nutzergeste bleibt erhalten)', async () => {
		const write = vi.fn<(items: unknown[]) => Promise<void>>(async () => {});
		stub(write, fakeItem());
		const pending = Promise.resolve(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
		const done = copyBlob('svg', pending);
		// write läuft synchron im Aufruf, nicht erst nach dem Blob.
		expect(write).toHaveBeenCalledTimes(1);
		await done;
		expect((write.mock.calls[0][0][0] as { items: unknown }).items).toEqual({
			'image/svg+xml': pending
		});
	});

	it('write wirft: Fehler wird weitergereicht', async () => {
		stub(async () => Promise.reject(new DOMException('verweigert', 'NotAllowedError')), fakeItem());
		await expect(copyBlob('png', png)).rejects.toThrow('verweigert');
	});

	it('nicht unterstützt: Fehler ohne write-Aufruf', async () => {
		const write = vi.fn(async () => {});
		stub(
			write,
			fakeItem(() => false)
		);
		await expect(copyBlob('svg', png)).rejects.toThrow();
		expect(write).not.toHaveBeenCalled();
	});
});
