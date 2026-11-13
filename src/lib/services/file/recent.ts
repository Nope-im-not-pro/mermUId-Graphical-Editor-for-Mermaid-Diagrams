// "Zuletzt geöffnet" (T132 C2, F-13, M-15 a): Liste der zuletzt geöffneten/gespeicherten Dateien
// als FileSystemFileHandle in IndexedDB. Gespeichert werden nur Dateiname und Handle, kein Pfad
// (KONZEPT §10). Neueste zuerst, höchstens `MAX_RECENT`, Duplikate per `isSameEntry`. Fehler der
// Ablage (kein IndexedDB, Quota, DataCloneError) werfen nie; die Liste bleibt dann leer bzw. nur im
// Speicher. Browser-API ohne Svelte (D-16).
import { msg } from '../i18n';
import { baseName, fileKind, toOpened, type FileHandleLike, type OpenedFile } from './browser';
import { FileServiceError } from './text';

/** Ausschnitt von `FileSystemFileHandle` mit Vergleich und Berechtigung (Chromium). */
export interface RecentHandle extends FileHandleLike {
	isSameEntry?(other: RecentHandle): Promise<boolean>;
	queryPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>;
	requestPermission?(descriptor: { mode: 'read' }): Promise<PermissionState>;
}

export interface RecentEntry {
	readonly name: string;
	readonly handle: RecentHandle;
}

export const MAX_RECENT = 5;
const DB_NAME = 'mermuid';
const STORE = 'recent';
const KEY = 'files';

/** Ablage der ganzen Liste (ein Datensatz). */
export interface RecentBackend {
	read(): Promise<unknown>;
	write(list: RecentEntry[]): Promise<void>;
}

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		let blocked = false;
		const request = factory.open(DB_NAME, 1);
		request.onupgradeneeded = () => request.result.createObjectStore(STORE);
		// Nach `blocked` (schon abgelehnt) eine spät erfolgreiche Verbindung gleich wieder schließen.
		request.onsuccess = () => (blocked ? request.result.close() : resolve(request.result));
		request.onerror = () => reject(request.error);
		request.onblocked = () => {
			blocked = true;
			reject(new Error('blocked'));
		};
	});
}

/** Ergebnis erst, wenn die Transaktion abgeschlossen ist; Abbruch/Fehler lehnen ab. */
function complete<T>(tx: IDBTransaction, request: IDBRequest<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		tx.oncomplete = () => resolve(request.result);
		tx.onerror = () => reject(tx.error ?? request.error);
		tx.onabort = () => reject(tx.error ?? new Error('aborted'));
	});
}

/** IndexedDB-Ablage; je Zugriff eine kurze Verbindung (mehrere Tabs blockieren sich nicht). */
export function idbBackend(factory: IDBFactory | undefined = globalThis.indexedDB): RecentBackend {
	async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>) {
		if (!factory) throw new Error('no indexedDB');
		const db = await openDb(factory);
		try {
			const tx = db.transaction(STORE, mode);
			return await complete(tx, fn(tx.objectStore(STORE)));
		} finally {
			db.close();
		}
	}
	return {
		read: () => run('readonly', (s) => s.get(KEY)),
		write: async (list) => void (await run('readwrite', (s) => s.put(list, KEY)))
	};
}

function valid(value: unknown): RecentEntry[] {
	if (!Array.isArray(value)) return [];
	return value.filter(
		(e): e is RecentEntry => typeof e?.name === 'string' && typeof e?.handle?.getFile === 'function'
	);
}

async function same(a: RecentHandle, b: RecentHandle): Promise<boolean> {
	if (a === b) return true;
	try {
		return (await a.isSameEntry?.(b)) ?? false;
	} catch {
		return false;
	}
}

async function without(list: RecentEntry[], handle: RecentHandle): Promise<RecentEntry[]> {
	const keep = await Promise.all(list.map(async (e) => !(await same(e.handle, handle))));
	return list.filter((_, i) => keep[i]);
}

export interface RecentStore {
	list(): Promise<RecentEntry[]>;
	/** Nach vorn setzen (Öffnen/Speichern); liefert die neue Liste, auch wenn Sichern scheitert. */
	add(handle: RecentHandle): Promise<RecentEntry[]>;
	remove(handle: RecentHandle): Promise<RecentEntry[]>;
}

export function createRecent(backend: RecentBackend = idbBackend()): RecentStore {
	/** Aufrufe nacheinander, damit gleichzeitiges Hinzufügen keinen Eintrag verliert. */
	let queue: Promise<unknown> = Promise.resolve();
	const serial = <T>(fn: () => Promise<T>): Promise<T> => {
		const next = queue.then(fn);
		queue = next.catch(() => {});
		return next;
	};
	const load = () => backend.read().then(valid, () => []);
	const store = async (list: RecentEntry[]) => {
		await backend.write(list).catch(() => {});
		return list;
	};
	return {
		list: () => serial(load),
		add: (handle) =>
			serial(async () => {
				const rest = await without(await load(), handle);
				const entry = { name: baseName(handle.name), handle };
				return store([entry, ...rest].slice(0, MAX_RECENT));
			}),
		remove: (handle) => serial(async () => store(await without(await load(), handle)))
	};
}

const denied = () =>
	new FileServiceError(msg('services.file.permissionDenied'), 'permission-denied');

function toOpenError(error: unknown): FileServiceError {
	if (error instanceof FileServiceError) return error;
	const name = (error as { name?: unknown } | null)?.name;
	if (name === 'NotFoundError') {
		return new FileServiceError(msg('services.file.notFound'), 'not-found');
	}
	if (name === 'NotAllowedError' || name === 'SecurityError') return denied();
	return new FileServiceError(msg('services.file.openFailed'), 'open-failed');
}

/**
 * Leserecht prüfen und bei Bedarf neu anfragen. Braucht frische Nutzer-Aktivierung, daher vor
 * jeder Rückfrage aufrufen. Fehler: `FileServiceError` (`permission-denied`, sonst `open-failed`).
 */
export async function permitRecent(handle: RecentHandle): Promise<void> {
	const mode = { mode: 'read' } as const;
	try {
		if (((await handle.queryPermission?.(mode)) ?? 'granted') === 'granted') return;
		if ((await handle.requestPermission?.(mode)) !== 'granted') throw denied();
	} catch (error) {
		throw toOpenError(error);
	}
}

/**
 * Datei eines Listeneintrags lesen: Berechtigung (ohne Rückfrage, wenn schon erteilt), dann Größe,
 * Endung, Name ohne Pfad wie beim Öffnen, mit Handle und Stand. `null` bei nicht unterstützter
 * Endung. Fehler: `FileServiceError` (`permission-denied`, `not-found`, `too-large`, `open-failed`).
 */
export async function readRecent(handle: RecentHandle): Promise<OpenedFile | null> {
	await permitRecent(handle);
	try {
		const file = await handle.getFile();
		return fileKind(baseName(file.name)) ? await toOpened(file, handle) : null;
	} catch (error) {
		throw toOpenError(error);
	}
}
