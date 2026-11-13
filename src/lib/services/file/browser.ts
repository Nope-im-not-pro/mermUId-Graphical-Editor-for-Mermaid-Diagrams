// Datei-Service, Browser-I/O (O-18, D-16 a): File System Access API per Feature-Erkennung,
// sonst Upload/Download-Fallback [A4]; Drag-and-Drop-Leser. Browser-APIs sind über `FileEnv`
// injizierbar. Kein Svelte-Import, kein View-Zustand. Ergebnisse und Meldungen enthalten nie
// Pfade, nur den Dateinamen (KONZEPT §10).
import { msg } from '../i18n';
import { encodeUtf8, FileServiceError } from './text';

export type FileKind = 'mmd' | 'md';

/** Minimaler Ausschnitt von `FileSystemFileHandle`. */
export interface FileHandleLike {
	readonly name: string;
	getFile(): Promise<File>;
	createWritable?(): Promise<{
		write(data: Uint8Array | Blob | string): Promise<void>;
		close(): Promise<void>;
		abort?(reason?: unknown): Promise<void>;
	}>;
}

/** Stand einer Datei auf der Platte; Abweichung vor dem Schreiben heißt: extern geändert. */
export interface FileStamp {
	lastModified: number;
	size: number;
}

interface PickerType {
	description: string;
	accept: Record<string, string[]>;
}

export interface FileEnv {
	showOpenFilePicker?: (options: {
		multiple?: boolean;
		types?: PickerType[];
	}) => Promise<FileHandleLike[]>;
	showSaveFilePicker?: (options: {
		suggestedName?: string;
		types?: PickerType[];
	}) => Promise<FileHandleLike>;
	document: Document;
	createObjectURL: (blob: Blob) => string;
	revokeObjectURL: (url: string) => void;
}

/** Gelesene Datei; `handle` ist nur über die File System Access API gesetzt. */
export interface OpenedFile {
	name: string;
	kind: FileKind | null;
	bytes: Uint8Array;
	handle: FileHandleLike | null;
	/** Stand beim Lesen; Vergleichswert für das nächste Speichern über `handle`. */
	stamp?: FileStamp;
}

export interface SaveResult {
	method: 'handle' | 'picker' | 'download';
	name: string;
	handle: FileHandleLike | null;
	/** Stand nach dem Schreiben über ein Handle; fehlt beim Download. */
	stamp?: FileStamp;
}

/**
 * Größte lesbare Datei in Byte (V-30), geprüft über `file.size` vor `arrayBuffer()`.
 * Herleitung: Render-Limit der App `maxTextSize` 200000 Zeichen (services/security; mermaid-Default
 * 50000), gezählt in UTF-16-Codeeinheiten. UTF-8 braucht höchstens 3 Byte je Codeeinheit (astrale
 * Zeichen: 4 Byte für 2 Einheiten) = 600000 Byte. Aufgerundet auf 1 MiB als Spielraum für die
 * Markdown-Hülle einer `.md`; die Hülle selbst wird bewusst nur durch diese Grenze begrenzt (eine
 * `.md` mit viel Prosa um einen kleinen Block ist bis 1 MiB lesbar, darüber nicht).
 */
export const MAX_FILE_BYTES = 1024 * 1024;

/** Lesbare Größenangabe der Grenze für Meldungen (1 MiB -> "1 MB"). */
const MAX_FILE_LABEL = `${MAX_FILE_BYTES / (1024 * 1024)} MB`;

const ACCEPT = '.mmd,.md';
const pickerTypes = (): PickerType[] => [
	{ description: msg('services.file.pickerDescription'), accept: { 'text/plain': ['.mmd', '.md'] } }
];

/** Umgebung aus `globalThis`; Picker nur, wenn der Browser sie anbietet. */
export function browserEnv(): FileEnv {
	const g = globalThis as unknown as Partial<FileEnv>;
	return {
		showOpenFilePicker: g.showOpenFilePicker?.bind(globalThis),
		showSaveFilePicker: g.showSaveFilePicker?.bind(globalThis),
		document: globalThis.document,
		createObjectURL: (blob) => URL.createObjectURL(blob),
		revokeObjectURL: (url) => URL.revokeObjectURL(url)
	};
}

export function hasFileSystemAccess(env: FileEnv): boolean {
	return (
		typeof env.showOpenFilePicker === 'function' && typeof env.showSaveFilePicker === 'function'
	);
}

/** Nur der Dateiname, ohne Pfadanteile. */
export function baseName(name: string): string {
	return name.slice(Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\')) + 1);
}

export function fileKind(name: string): FileKind | null {
	const ext = /\.([^./\\]+)$/.exec(name)?.[1].toLowerCase();
	return ext === 'mmd' || ext === 'md' ? ext : null;
}

function isAbort(error: unknown): boolean {
	return (error as { name?: unknown } | null)?.name === 'AbortError';
}

/** Fehler des Dienstes unverändert weiterreichen, alles andere als `fallback`. */
function toServiceError(error: unknown, fallback: () => FileServiceError): FileServiceError {
	return error instanceof FileServiceError ? error : fallback();
}

const openFailed = () => new FileServiceError(msg('services.file.openFailed'), 'open-failed');

const stampOf = (file: File): FileStamp => ({ lastModified: file.lastModified, size: file.size });

/** Datei lesen (Größengrenze, Name ohne Pfad, Stand); Fehler außer `too-large` roh. */
export async function toOpened(file: File, handle: FileHandleLike | null): Promise<OpenedFile> {
	if (file.size > MAX_FILE_BYTES) {
		throw new FileServiceError(msg('services.file.tooLarge', { max: MAX_FILE_LABEL }), 'too-large');
	}
	const name = baseName(file.name);
	const bytes = new Uint8Array(await file.arrayBuffer());
	return { name, kind: fileKind(name), bytes, handle, stamp: stampOf(file) };
}

/** Wartet auf die Auswahl im `<input type=file>`; `null` bei Abbruch. */
function pickWithInput(doc: Document): Promise<File | null> {
	return new Promise((resolve) => {
		const input = doc.createElement('input');
		input.type = 'file';
		input.accept = ACCEPT;
		input.addEventListener('change', () => resolve(input.files?.[0] ?? null), { once: true });
		input.addEventListener('cancel', () => resolve(null), { once: true });
		input.click();
	});
}

/**
 * Öffnet eine Datei über den Nutzer-Dialog. `null` bei Abbruch (ohne Fehlermeldung).
 * Andere Fehler: `FileServiceError` ohne Pfad.
 */
export async function openFile(env: FileEnv = browserEnv()): Promise<OpenedFile | null> {
	try {
		if (env.showOpenFilePicker) {
			const [handle] = await env.showOpenFilePicker({ multiple: false, types: pickerTypes() });
			return handle ? await toOpened(await handle.getFile(), handle) : null;
		}
		const file = await pickWithInput(env.document);
		return file ? await toOpened(file, null) : null;
	} catch (error) {
		if (isAbort(error)) return null;
		throw toServiceError(error, openFailed);
	}
}

const saveFailed = () => new FileServiceError(msg('services.file.saveFailed'), 'save-failed');

/** Speicherfehler des Browsers mit eigener Meldung; alles andere ist `save-failed`. */
const SAVE_ERRORS = {
	NotAllowedError: ['permission-denied', 'services.file.permissionDenied'],
	NotFoundError: ['not-found', 'services.file.notFound'],
	QuotaExceededError: ['quota', 'services.file.quota']
} as const;

function toSaveError(error: unknown): FileServiceError {
	if (error instanceof FileServiceError) return error;
	const name = (error as { name?: unknown } | null)?.name;
	const known = typeof name === 'string' && Object.hasOwn(SAVE_ERRORS, name);
	if (!known) return saveFailed();
	const [code, key] = SAVE_ERRORS[name as keyof typeof SAVE_ERRORS];
	return new FileServiceError(msg(key), code);
}

/**
 * Schreibt über das Handle. Mit `expected` wird vorher der Stand verglichen: Abweichung ergibt
 * `changed-on-disk` ohne Schreiben (Naht T105). Eine externe Änderung zwischen Vergleich und
 * `createWritable()` ist nicht erkennbar (TOCTOU-Fenster, API ohne atomares Prüfen-und-Schreiben).
 * Schlägt Schreiben fehl, verwirft `abort()` den Schreibvorgang, statt eine halb geschriebene Datei
 * zu hinterlassen. Liefert den neuen Stand; ist er nach erfolgreichem Schreiben nicht lesbar,
 * `undefined` (nächstes Speichern ohne Vergleich).
 */
async function writeHandle(
	handle: FileHandleLike,
	data: Uint8Array,
	expected: FileStamp | null
): Promise<FileStamp | undefined> {
	if (!handle.createWritable) throw saveFailed();
	if (expected) {
		const now = stampOf(await handle.getFile());
		if (now.lastModified !== expected.lastModified || now.size !== expected.size) {
			throw new FileServiceError(msg('services.file.changedOnDisk'), 'changed-on-disk');
		}
	}
	const writable = await handle.createWritable();
	try {
		await writable.write(data);
		await writable.close();
	} catch (error) {
		await writable.abort?.().catch(() => {});
		throw error;
	}
	return handle.getFile().then(stampOf, () => undefined);
}

function download(env: FileEnv, data: Uint8Array, name: string): void {
	const type = fileKind(name) === 'md' ? 'text/markdown' : 'text/plain';
	const url = env.createObjectURL(new Blob([data as BlobPart], { type: `${type};charset=utf-8` }));
	const a = env.document.createElement('a');
	a.href = url;
	a.download = name;
	a.rel = 'noopener';
	a.style.display = 'none';
	env.document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => env.revokeObjectURL(url), 0);
}

export interface SaveOptions {
	/** Handle aus `openFile` oder einem früheren Speichern: direktes Wiederspeichern. */
	handle?: FileHandleLike | null;
	/** Vorschlag für Picker bzw. Download-Name; Pfadanteile werden entfernt. */
	suggestedName?: string;
	/** BOM schreiben (gelesene Datei hatte eines, V-04); ohne Angabe keins. */
	bom?: boolean;
	/** Stand beim Öffnen bzw. letzten Speichern; nur mit `handle` geprüft. */
	expected?: FileStamp | null;
	env?: FileEnv;
}

/**
 * Speichert `text` als UTF-8: über vorhandenes Handle, sonst Save-Picker, sonst Download. BOM nur
 * mit Option `bom`; ein führendes U+FEFF in `text` wird entfernt. `null` bei Abbruch (ohne
 * Fehlermeldung). Andere Fehler: `FileServiceError` mit Code (`changed-on-disk`,
 * `permission-denied`, `not-found`, `quota`, sonst `save-failed`).
 */
export async function saveFile(
	text: string,
	options: SaveOptions = {}
): Promise<SaveResult | null> {
	const env = options.env ?? browserEnv();
	// Standardname je Sprache (O-137). app.*-Schlüssel in services: Scope-Trennung W28
	// (msg/services.ts fremd), Verschiebung nach services.* offen.
	const fallback = msg('app.file.newName');
	const name = baseName(options.suggestedName ?? fallback) || fallback;
	const data = encodeUtf8(text, options.bom ?? false);
	try {
		if (options.handle) {
			const stamp = await writeHandle(options.handle, data, options.expected ?? null);
			return { method: 'handle', name: options.handle.name, handle: options.handle, stamp };
		}
		if (env.showSaveFilePicker) {
			const handle = await env.showSaveFilePicker({ suggestedName: name, types: pickerTypes() });
			const stamp = await writeHandle(handle, data, null);
			return { method: 'picker', name: handle.name, handle, stamp };
		}
		download(env, data, name);
		return { method: 'download', name, handle: null };
	} catch (error) {
		if (isAbort(error)) return null;
		throw toSaveError(error);
	}
}

/** Liest die erste `.mmd`/`.md`-Datei aus einem Drop. `null`, wenn keine passt. */
export async function readDroppedFile(
	dataTransfer: Pick<DataTransfer, 'files'> | null
): Promise<OpenedFile | null> {
	const files = Array.from(dataTransfer?.files ?? []);
	const file = files.find((f) => fileKind(f.name) !== null);
	if (!file) return null;
	try {
		return await toOpened(file, null);
	} catch (error) {
		throw toServiceError(error, openFailed);
	}
}
