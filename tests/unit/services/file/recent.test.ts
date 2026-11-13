// T132 C2 (F-13, M-15 a): "Zuletzt geöffnet" über FileSystemFileHandle in IndexedDB. Nur Name und
// Handle (kein Pfad), begrenzte Länge, neueste zuerst, Duplikate per `isSameEntry`. Öffnen fragt
// die Berechtigung neu an; IndexedDB-Fehler ohne Absturz.
import { describe, expect, it, vi } from 'vitest';
import {
	createRecent,
	idbBackend,
	MAX_RECENT,
	readRecent,
	type RecentBackend,
	type RecentEntry,
	type RecentHandle
} from '../../../../src/lib/services/file/recent';
import { FileServiceError } from '../../../../src/lib/services/file';

/** Handle-Attrappe; gleiche `id` = gleiche Datei auf der Platte. */
function handle(name: string, id = name, text = 'flowchart TD\n  A\n'): RecentHandle {
	const self: RecentHandle & { id: string } = {
		id,
		name,
		getFile: async () => new File([text], name, { lastModified: 1 }),
		isSameEntry: async (other) => (other as { id?: string }).id === id
	};
	return self;
}

function memory(initial: unknown = undefined): RecentBackend & { value: unknown } {
	const box = {
		value: initial,
		read: async () => box.value,
		write: async (list: RecentEntry[]) => void (box.value = list)
	};
	return box;
}

const names = (list: RecentEntry[]) => list.map((e) => e.name);

describe('createRecent', () => {
	it('neueste zuerst, nur Name und Handle', async () => {
		const backend = memory();
		const recent = createRecent(backend);
		await recent.add(handle('a.mmd'));
		const list = await recent.add(handle('b.mmd'));
		expect(names(list)).toEqual(['b.mmd', 'a.mmd']);
		expect(Object.keys((backend.value as RecentEntry[])[0]).sort()).toEqual(['handle', 'name']);
		expect(names(await recent.list())).toEqual(['b.mmd', 'a.mmd']);
	});

	it('dieselbe Datei (isSameEntry) wird nach vorn gezogen statt doppelt geführt', async () => {
		const recent = createRecent(memory());
		await recent.add(handle('a.mmd'));
		await recent.add(handle('b.mmd'));
		const list = await recent.add(handle('a.mmd'));
		expect(names(list)).toEqual(['a.mmd', 'b.mmd']);
	});

	it('gleicher Name, andere Datei: beide bleiben', async () => {
		const recent = createRecent(memory());
		await recent.add(handle('a.mmd', 'x'));
		const list = await recent.add(handle('a.mmd', 'y'));
		expect(list).toHaveLength(2);
	});

	it('begrenzte Länge: älteste fällt heraus', async () => {
		const recent = createRecent(memory());
		for (let i = 0; i <= MAX_RECENT; i++) await recent.add(handle(`${i}.mmd`));
		const list = await recent.list();
		expect(list).toHaveLength(MAX_RECENT);
		expect(list[0].name).toBe(`${MAX_RECENT}.mmd`);
		expect(names(list)).not.toContain('0.mmd');
	});

	it('Name ohne Pfadanteile', async () => {
		const recent = createRecent(memory());
		const list = await recent.add(handle('C:\\daten\\geheim\\plan.mmd'));
		expect(list[0].name).toBe('plan.mmd');
	});

	it('remove entfernt den Eintrag (auch als Kopie aus der Ablage)', async () => {
		const recent = createRecent(memory());
		await recent.add(handle('a.mmd'));
		await recent.add(handle('b.mmd'));
		const list = await recent.remove(handle('a.mmd'));
		expect(names(list)).toEqual(['b.mmd']);
	});

	it('ungültige Ablage-Daten gelten als leere bzw. gefilterte Liste', async () => {
		expect(await createRecent(memory('kaputt')).list()).toEqual([]);
		const mixed = memory([{ name: 1 }, null, { name: 'ok.mmd', handle: handle('ok.mmd') }]);
		expect(names(await createRecent(mixed).list())).toEqual(['ok.mmd']);
	});

	it('Fehler der Ablage ohne Ausnahme; add liefert trotzdem die neue Liste', async () => {
		const broken: RecentBackend = {
			read: () => Promise.reject(new DOMException('x', 'UnknownError')),
			write: () => Promise.reject(new DOMException('x', 'DataCloneError'))
		};
		const recent = createRecent(broken);
		expect(await recent.list()).toEqual([]);
		expect(names(await recent.add(handle('a.mmd')))).toEqual(['a.mmd']);
		expect(await recent.remove(handle('a.mmd'))).toEqual([]);
	});

	it('werfendes isSameEntry gilt als andere Datei', async () => {
		const recent = createRecent(memory());
		const bad = { ...handle('a.mmd'), isSameEntry: () => Promise.reject(new Error('x')) };
		await recent.add(bad);
		expect(await recent.add(handle('b.mmd'))).toHaveLength(2);
	});

	it('gleichzeitige Aufrufe verlieren keinen Eintrag', async () => {
		const recent = createRecent(memory());
		await Promise.all([recent.add(handle('a.mmd')), recent.add(handle('b.mmd'))]);
		expect(names(await recent.list())).toEqual(['b.mmd', 'a.mmd']);
	});
});

/**
 * Minimale IndexedDB-Attrappe: open/upgrade, ein Store, get/put; Ergebnisse asynchron, Abschluss
 * über `transaction.oncomplete`. `abortWrites`: Schreib-Transaktionen enden mit `onabort`.
 */
function fakeIdb({ abortWrites = false } = {}) {
	const stores = new Map<string, Map<unknown, unknown>>();
	const db = {
		createObjectStore: (name: string) => stores.set(name, new Map()),
		transaction: (name: string, mode: IDBTransactionMode) => {
			const store = stores.get(name);
			if (!store) throw new DOMException('no store', 'NotFoundError');
			const tx: Record<string, unknown> = {};
			const req = <T>(fn: () => T) => {
				const r: Record<string, unknown> = {};
				queueMicrotask(() => {
					if (abortWrites && mode === 'readwrite') {
						tx.error = new DOMException('full', 'QuotaExceededError');
						return (tx.onabort as () => void)();
					}
					r.result = fn();
					(r.onsuccess as (() => void) | undefined)?.();
					queueMicrotask(() => (tx.oncomplete as () => void)());
				});
				return r;
			};
			tx.objectStore = () => ({
				get: (key: unknown) => req(() => store.get(key)),
				put: (value: unknown, key: unknown) => req(() => void store.set(key, value))
			});
			return tx;
		},
		close: vi.fn()
	};
	const factory = {
		open: () => {
			const r: Record<string, unknown> = { result: db };
			queueMicrotask(() => {
				if (stores.size === 0) (r.onupgradeneeded as () => void)();
				(r.onsuccess as () => void)();
			});
			return r;
		}
	};
	return { factory: factory as unknown as IDBFactory, db };
}

describe('idbBackend', () => {
	it('schreibt und liest die Liste über IndexedDB und schließt die Verbindung', async () => {
		const { factory, db } = fakeIdb();
		const recent = createRecent(idbBackend(factory));
		await recent.add(handle('a.mmd'));
		expect(names(await createRecent(idbBackend(factory)).list())).toEqual(['a.mmd']);
		expect(db.close).toHaveBeenCalled();
	});

	it('ohne indexedDB oder mit werfendem open: leere Liste, kein Absturz', async () => {
		expect(await createRecent(idbBackend(undefined)).list()).toEqual([]);
		const throwing = {
			open: () => {
				throw new DOMException('denied', 'SecurityError');
			}
		} as unknown as IDBFactory;
		const recent = createRecent(idbBackend(throwing));
		expect(await recent.list()).toEqual([]);
		expect(names(await recent.add(handle('a.mmd')))).toEqual(['a.mmd']);
	});

	it('abgebrochene Schreib-Transaktion (onabort): kein Absturz, add liefert die Liste', async () => {
		const { factory, db } = fakeIdb({ abortWrites: true });
		const recent = createRecent(idbBackend(factory));
		expect(names(await recent.add(handle('a.mmd')))).toEqual(['a.mmd']);
		expect(await recent.list()).toEqual([]);
		expect(db.close).toHaveBeenCalled();
	});

	it('blockiert (onblocked): leere Liste; spät erfolgreiche Verbindung wird geschlossen', async () => {
		const close = vi.fn();
		const r: Record<string, unknown> = {};
		const blocking = { open: () => r } as unknown as IDBFactory;
		const pending = createRecent(idbBackend(blocking)).list();
		await Promise.resolve();
		(r.onblocked as () => void)();
		expect(await pending).toEqual([]);
		r.result = { close };
		(r.onsuccess as () => void)();
		expect(close).toHaveBeenCalled();
	});

	it('Fehler beim Öffnen der Datenbank (onerror): leere Liste', async () => {
		const failing = {
			open: () => {
				const r: Record<string, unknown> = { error: new DOMException('x', 'UnknownError') };
				queueMicrotask(() => (r.onerror as () => void)());
				return r;
			}
		} as unknown as IDBFactory;
		expect(await createRecent(idbBackend(failing)).list()).toEqual([]);
	});
});

describe('readRecent', () => {
	it('Berechtigung erteilt: liest Datei mit Handle und Stand', async () => {
		const h = { ...handle('a.mmd'), queryPermission: vi.fn(async () => 'granted' as const) };
		const opened = await readRecent(h);
		expect(opened?.name).toBe('a.mmd');
		expect(opened?.handle).toBe(h);
		expect(opened?.stamp).toEqual({ lastModified: 1, size: 17 });
		expect(new TextDecoder().decode(opened!.bytes)).toBe('flowchart TD\n  A\n');
	});

	it('fragt die Berechtigung neu an, wenn sie nicht erteilt ist', async () => {
		const requestPermission = vi.fn(async () => 'granted' as const);
		const h = {
			...handle('a.mmd'),
			queryPermission: async () => 'prompt' as const,
			requestPermission
		};
		expect((await readRecent(h))?.name).toBe('a.mmd');
		expect(requestPermission).toHaveBeenCalledWith({ mode: 'read' });
	});

	it('verweigert: permission-denied, Datei wird nicht gelesen', async () => {
		const getFile = vi.fn();
		const h: RecentHandle = {
			name: 'a.mmd',
			getFile,
			queryPermission: async () => 'prompt',
			requestPermission: async () => 'denied'
		};
		await expect(readRecent(h)).rejects.toMatchObject({ code: 'permission-denied' });
		expect(getFile).not.toHaveBeenCalled();
	});

	it('requestPermission ohne Nutzer-Aktivierung (SecurityError): permission-denied', async () => {
		const h: RecentHandle = {
			...handle('a.mmd'),
			queryPermission: async () => 'prompt',
			requestPermission: () => Promise.reject(new DOMException('x', 'SecurityError'))
		};
		await expect(readRecent(h)).rejects.toMatchObject({ code: 'permission-denied' });
	});

	it('Datei weg (NotFoundError): not-found', async () => {
		const h: RecentHandle = {
			name: 'a.mmd',
			getFile: () => Promise.reject(new DOMException('x', 'NotFoundError'))
		};
		const err = await readRecent(h).catch((e: unknown) => e);
		expect(err).toBeInstanceOf(FileServiceError);
		expect(err).toMatchObject({ code: 'not-found' });
	});

	it('Dateiendung ohne .mmd/.md: null (nicht unterstützt)', async () => {
		expect(await readRecent(handle('bild.png'))).toBeNull();
	});
});
