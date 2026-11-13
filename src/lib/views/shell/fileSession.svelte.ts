/**
 * Datei-Sitzung der Shell (T123 C1, V-24): Datei-Zustand, eigener Sync-Controller nach
 * Neu/Öffnen, Dirty-Status sowie die Abläufe Neu, Öffnen, Drop, Speichern (inkl. Speichern unter
 * bei extern geänderter Datei bzw. totem Handle) und die Ungespeichert-Rückfrage (V-03).
 * Rückfragen (`ask` aus `dialogs.svelte.ts`, T123 C2), Meldungen und das Zurücksetzen des
 * UI-Zustands kommen über `deps` von der Komponente. Teilen per Link (T136 C2, F-11): Link
 * kopieren und Laden eines Teilen-Fragments über die Prüfpfade des Datei-Öffnens.
 */
import { tick } from 'svelte';
import { get } from 'svelte/store';
import type { SyncController } from '../../controllers/sync';
import {
	decodeShareFragment,
	encodeShareFragment,
	FileServiceError,
	MAX_SHARE_CODE_BYTES,
	MAX_SHARE_FRAGMENT_LENGTH,
	openFile,
	permitRecent,
	readDroppedFile,
	readRecent,
	saveFile,
	toOpened,
	type FileEnv,
	type RecentEntry,
	type SaveOptions,
	type SaveResult,
	type ShareErrorCode
} from '../../services/file';
import type { MessageKey } from '../../services/i18n';
import type { DialogRequest } from './Dialog.svelte';
import type { Draft } from './draft';
import {
	afterSave,
	chooseBlock,
	isDirty,
	newFile,
	planOpen,
	saveOptions,
	saveText,
	type FileBase,
	type FileState,
	type OpenPlan
} from './file';
import { t } from './i18n.svelte';
import { errorPart, fail, known, type MessagePart, type StatusMessage } from './status';

export interface FileSessionDeps {
	/** Code des aktiven Controllers; reaktiv gelesen (`dirty`). */
	code: () => string;
	/** Code beim Start (Stand "gespeichert" der ungeöffneten Datei). */
	initial: string;
	/** Neuer Sync-Controller für Neu/Öffnen. */
	create: (text: string) => Promise<SyncController>;
	env: () => FileEnv;
	/** Nicht-blockierende Rückfrage; `value` `null` bei Esc/Abbruch. */
	ask: (request: DialogRequest) => Promise<{ value: string | null }>;
	say: (message: StatusMessage | null) => void;
	/** Vor dem Wechsel auf einen geladenen Controller: Auswahl, Werkzeug usw. zurücksetzen. */
	reset: () => void;
}

export type GuardResult = 'clean' | 'saved' | 'discard' | null;

export interface FileSession {
	readonly file: FileState;
	/** Nach Neu/Öffnen geladener Controller, sonst `null` (der übergebene bleibt aktiv). */
	readonly controller: SyncController | null;
	readonly dirty: boolean;
	/** Neu-Dialog offen (Vorlagenwahl ausstehend). */
	readonly picking: boolean;
	guard(): Promise<GuardResult>;
	save(): Promise<boolean>;
	open(): Promise<void>;
	newDiagram(): Promise<void>;
	/** Antwort des Neu-Dialogs: Vorlagen-Code oder `null` (Abbruch). */
	closeNew(code: string | null): void;
	/** Gedroppte Datei laden (nach Ungespeichert-Rückfrage). */
	openDropped(transfer: Pick<DataTransfer, 'files'> | null): Promise<void>;
	/** Eintrag aus "Zuletzt geöffnet" (T132 C2) laden (nach Ungespeichert-Rückfrage). */
	openRecent(entry: RecentEntry): Promise<void>;
	/** Entwurf (T132 C1) als ungespeicherte neue Datei laden, ohne Ungespeichert-Rückfrage. */
	restore(draft: Draft): Promise<void>;
	/** Aktuellen Code als Link `<base>#<fragment>` über `copy` in die Zwischenablage (T136 C2). */
	copyLink(base: string, copy: (text: string) => Promise<void>): Promise<void>;
	/**
	 * Teilen-Fragment nach Rückfrage und Ungespeichert-Rückfrage laden (T136 C2). `keptDraft`:
	 * ein beim Start behaltener Entwurf wird beim Laden ersetzt; die Rückfrage sagt das.
	 */
	openShared(fragment: string, keptDraft?: boolean): Promise<void>;
	dispose(): void;
}

const opened = (name: string): StatusMessage => ({
	key: 'app.shell.opened',
	params: { name },
	tone: 'success'
});

/** Meldung je Fehlercode beim Öffnen aus "Zuletzt geöffnet" (T132 C2); nennt das Entfernen. */
const RECENT_FAILED: Partial<Record<string, MessageKey>> = {
	'permission-denied': 'app.recent.denied',
	'not-found': 'app.recent.missing'
};

const KB = MAX_SHARE_CODE_BYTES / 1024;

/** Meldung je Fehlercode beim Kodieren (T136 C2); andere Codes kommen dort nicht vor. */
function copyFailure(error: ShareErrorCode): MessagePart {
	if (error === 'too-long')
		return { key: 'app.share.copyTooLong', params: { max: MAX_SHARE_FRAGMENT_LENGTH } };
	if (error === 'too-large') return { key: 'app.share.copyTooLarge', params: { max: KB } };
	return { key: 'app.share.copyUnavailable' };
}

/** Meldung je Fehlercode beim Dekodieren (T136 C2); Formfehler fasst eine Meldung zusammen. */
function openFailure(error: ShareErrorCode): MessagePart {
	switch (error) {
		case 'too-long':
			return { key: 'app.share.openTooLong', params: { max: MAX_SHARE_FRAGMENT_LENGTH } };
		case 'too-large':
			return { key: 'app.share.openTooLarge', params: { max: KB } };
		case 'unsupported-version':
			return { key: 'app.share.openVersion' };
		case 'unavailable':
			return { key: 'app.share.openUnavailable' };
		default:
			return { key: 'app.share.openInvalid' };
	}
}

/**
 * Basis des Teilen-Links: Adresse ohne Query und Fragment (Schema, Host, Pfad). Aus `href`
 * statt `origin + pathname`, weil `origin` bei `file://` (Ein-Ordner-Paket) `"null"` ist.
 */
export function shareBase(href: string): string {
	// Query und Fragment beginnen am ersten `?` bzw. `#` (im Pfad stehen beide nur kodiert).
	return href.replace(/[?#].*$/s, '');
}

/** Adresse und Zwischenablage für Teilen per Link (T136 C2); Tests injizieren eine Attrappe. */
export interface ShareAccess {
	/** Aktuelles Fragment samt `#` (leer ohne Fragment). */
	hash: () => string;
	/** Fragment aus der Adresszeile entfernen, ohne neuen Verlaufseintrag und ohne Request. */
	clear: () => void;
	/** Basis des Links (`shareBase`). */
	base: () => string;
	copy: (text: string) => Promise<void>;
}

export function browserShare(): ShareAccess {
	return {
		hash: () => globalThis.location?.hash ?? '',
		// `history.state` bleibt erhalten (Verlaufsdaten des SvelteKit-Routers).
		clear: () => history.replaceState(history.state, '', location.pathname + location.search),
		base: () => shareBase(location.href),
		// Ohne Clipboard-API (unsicherer Kontext) wirft der Zugriff; `copyLink` meldet das.
		copy: (text) => navigator.clipboard.writeText(text)
	};
}

/** Toter Handle (V-11): Datei verschoben/gelöscht bzw. Schreibrecht entzogen. */
const DEAD_HANDLE = new Set(['not-found', 'permission-denied']);

export function createFileSession(deps: FileSessionDeps): FileSession {
	const { ask, say } = deps;
	let file = $state.raw(newFile(deps.initial));
	let swapped = $state<SyncController | null>(null);
	/** Offener Neu-Dialog (T105 C1): Antwort ist der Vorlagen-Code oder `null` (Abbruch). */
	let newPick = $state.raw<((code: string | null) => void) | null>(null);
	/** Laufender Speichervorgang; währenddessen liefert `save()` dieselbe Promise. */
	let saving: Promise<boolean> | null = null;

	const dirtyNow = () => isDirty(file, deps.code());

	/**
	 * Ungespeicherte Änderungen vor Neu/Öffnen/Drop klären (V-03): Speichern (primär, fokussiert)
	 * setzt die Aktion nur bei Erfolg fort; Verwerfen fährt fort; Abbrechen/Esc bricht ab.
	 * Läuft bei ungespeicherten Änderungen schon ein Speichern, wird ohne Rückfrage darauf
	 * gewartet; misslingt es, Abbruch. `null` = abbrechen; `saved`: vorher gespeichert.
	 */
	async function guard(): Promise<GuardResult> {
		if (!dirtyNow()) return 'clean';
		if (saving && !(await saving)) return null;
		if (!dirtyNow()) return 'saved';
		const reply = await ask({
			title: t('app.shell.unsavedTitle'),
			text: t('app.shell.unsavedText'),
			actions: [
				{ label: t('app.shell.save'), value: 'save', primary: true },
				{ label: t('app.shell.discard'), value: 'discard' },
				{ label: t('app.shell.cancel'), value: 'cancel' }
			]
		});
		if (reply.value === 'save') return (await save()) ? 'saved' : null;
		return reply.value === 'discard' ? 'discard' : null;
	}

	/** `saved`: Stand "gespeichert"; ohne Angabe der geladene Code (sauber). */
	async function load(text: string, base: FileBase, status: StatusMessage, saved?: string) {
		let next: SyncController;
		try {
			next = await deps.create(text);
		} catch (err) {
			const reason = errorPart(err);
			say(fail({ key: 'app.shell.failed', params: { label: { key: 'app.shell.load' }, reason } }));
			return;
		}
		const old = swapped;
		swapped = next;
		deps.reset();
		file = { ...base, saved: saved ?? get(next).code };
		say(status);
		await tick();
		old?.dispose();
	}

	/** Erst die Ungespeichert-Rückfrage (T101), dann Typ- und Vorlagenwahl (T105 C1, V-14). */
	async function newDiagram() {
		if (!(await guard()) || newPick) return;
		const code = await new Promise<string | null>((resolve) => (newPick = resolve));
		if (code !== null)
			await load(code, newFile(code), { key: 'app.shell.newDiagram', tone: 'success' });
	}

	function closeNew(code: string | null) {
		const pick = newPick;
		newPick = null;
		pick?.(code);
	}

	/** `name`: Name der gewählten Datei (Fehlertext aus `planOpen` zurück auf den Schlüssel). */
	async function applyPlan(plan: OpenPlan, name: string) {
		if (plan.type === 'error') {
			say(fail(known(plan.message, [{ key: 'app.file.noBlock', params: { name } }])));
			return;
		}
		if (plan.type === 'load') return load(plan.text, plan.file, opened(plan.file.name));
		const reply = await ask({
			title: t('app.shell.chooseTitle'),
			text: t('app.shell.chooseText', { name: plan.file.name }),
			actions: [
				...plan.blocks.map((b) => ({ label: b.label, value: String(b.index) })),
				{ label: t('app.shell.cancel'), value: 'cancel' }
			]
		});
		if (reply.value === null || reply.value === 'cancel') return;
		const picked = chooseBlock(plan, Number(reply.value));
		await load(picked.text, picked.file, opened(picked.file.name));
	}

	async function open() {
		const cleared = await guard();
		if (!cleared) return;
		try {
			const picked = await openFile(deps.env());
			if (picked) await applyPlan(planOpen(picked), picked.name);
		} catch (err) {
			// Nach dem Speichern ist die Nutzer-Aktivierung verbraucht: der Picker scheitert
			// (SecurityError/NotAllowedError, im Dienst `open-failed`).
			const blocked =
				cleared === 'saved' && err instanceof FileServiceError && err.code === 'open-failed';
			say(blocked ? { key: 'app.shell.reopen', tone: 'info' } : fail(errorPart(err)));
		}
	}

	/** Drop einer .mmd/.md-Datei; Dateiliste vor der Rückfrage lesen. */
	async function openDropped(transfer: Pick<DataTransfer, 'files'> | null) {
		let dropped;
		try {
			dropped = await readDroppedFile(transfer);
		} catch (err) {
			say(fail(errorPart(err)));
			return;
		}
		if (!dropped) {
			say(fail({ key: 'app.file.unsupported' }));
			return;
		}
		if (await guard()) await applyPlan(planOpen(dropped), dropped.name);
	}

	/**
	 * Erst die Berechtigung (braucht die frische Nutzer-Aktivierung des Klicks; nach Speichern in
	 * der Rückfrage wäre sie verbraucht), dann Ungespeichert-Rückfrage wie beim normalen Öffnen,
	 * erst danach lesen: Speichern auf dieselbe Datei lädt so den gespeicherten Stand und Stempel.
	 */
	async function openRecent(entry: RecentEntry) {
		const failed = (err: unknown) => {
			const key = err instanceof FileServiceError ? RECENT_FAILED[err.code] : undefined;
			say(fail(key ? { key, params: { name: entry.name } } : errorPart(err)));
		};
		try {
			await permitRecent(entry.handle);
		} catch (err) {
			failed(err);
			return;
		}
		if (!(await guard())) return;
		let picked;
		try {
			picked = await readRecent(entry.handle);
		} catch (err) {
			failed(err);
			return;
		}
		if (!picked) {
			say(fail({ key: 'app.file.unsupported' }));
			return;
		}
		await applyPlan(planOpen(picked), picked.name);
	}

	/**
	 * Entwurf ohne Handle und ohne Markdown-Hülle: bleibt ungespeichert (`saved` leer), damit
	 * Rückfrage, Tab-Stern und Entwurfs-Sicherung greifen. `.md` wird zu `.mmd`, damit Speichern
	 * keine Markdown-Datei mit reinem Mermaid-Code überschreibt.
	 */
	async function restore(draft: Draft) {
		const name = draft.name.replace(/\.(md|markdown)$/i, '.mmd') || t('app.file.newName');
		const status: StatusMessage = {
			key: 'app.shell.draftRestored',
			params: { name },
			tone: 'success'
		};
		await load(draft.code, { ...newFile(''), name }, status, '');
	}

	/**
	 * Teilen per Link (T136 C2): nur der kopierte Text trägt das Fragment; kein Request, keine
	 * Änderung der Adresszeile. Fehler (zu groß/zu lang/keine Stream-API, Zwischenablage) als Meldung.
	 */
	async function copyLink(base: string, copy: (text: string) => Promise<void>) {
		const encoded = await encodeShareFragment(deps.code());
		if (!encoded.ok) {
			say(fail(copyFailure(encoded.error)));
			return;
		}
		try {
			await copy(`${base}#${encoded.fragment}`);
		} catch {
			say(fail({ key: 'app.share.copyFailed' }));
			return;
		}
		say({ key: 'app.share.copied', tone: 'success' });
	}

	/**
	 * Start mit Teilen-Fragment (T136 C2). Reihenfolge: Rückfrage (fremder Inhalt) -> Dekodieren
	 * (Fehler: Meldung, kein Laden, keine weitere Rückfrage) -> Ungespeichert-Rückfrage -> Prüfpfade
	 * des Datei-Öffnens (`toOpened`: Größe; `planOpen`: UTF-8, NUL, BOM, Zeilenende) wie bei einer
	 * `.mmd`. Name neutral (`app.share.fileName`), weil das Fragment keinen Dateinamen trägt und
	 * keiner ausgedacht werden soll; ohne Handle und Stand. Ungespeichert (`saved` leer) wie ein
	 * Entwurf: der Inhalt existiert nach dem Entfernen des Fragments nirgends lokal, also greifen
	 * Tab-Stern, Schließen-Warnung und Entwurfs-Sicherung.
	 */
	async function openShared(fragment: string, keptDraft = false) {
		const text = t('app.share.openText');
		const reply = await ask({
			title: t('app.share.openTitle'),
			text: keptDraft ? `${text} ${t('app.share.openDraft')}` : text,
			actions: [
				{ label: t('app.share.load'), value: 'load', primary: true },
				{ label: t('app.shell.cancel'), value: 'cancel' }
			]
		});
		if (reply.value !== 'load') return;
		const decoded = await decodeShareFragment(fragment);
		if (!decoded.ok) {
			say(fail(openFailure(decoded.error)));
			return;
		}
		if (!(await guard())) return;
		const name = t('app.share.fileName');
		let plan: OpenPlan;
		try {
			plan = planOpen(await toOpened(new File([decoded.text], name), null));
		} catch (err) {
			say(fail(errorPart(err)));
			return;
		}
		// `.mmd` ergibt nur `load` oder `error` (keine Blockwahl).
		if (plan.type !== 'load') {
			say(fail(plan.type === 'error' ? known(plan.message) : { key: 'app.file.unsupported' }));
			return;
		}
		const status: StatusMessage = { key: 'app.share.loaded', params: { name }, tone: 'success' };
		await load(plan.text, { ...plan.file, stamp: null }, status, '');
	}

	/**
	 * `true` nur, wenn gespeichert wurde (nicht bei Abbruch im Datei-Dialog oder Fehler). Ein
	 * zweiter Aufruf während des Schreibens startet keinen zweiten Vorgang.
	 */
	function save(): Promise<boolean> {
		saving ??= write().finally(() => (saving = null));
		return saving;
	}

	/**
	 * Schreibt mit BOM und erwartetem Stand (O-57). `changed-on-disk` fragt Speichern unter
	 * (primär) / Überschreiben / Abbrechen (T105 C3); toter Handle weicht ohne Rückfrage auf
	 * Save-Picker bzw. Download aus. `true` nur, wenn am Ende geschrieben wurde.
	 */
	async function write(): Promise<boolean> {
		const code = deps.code();
		const target = file;
		const text = saveText(target, code);
		const options = { ...saveOptions(target), env: deps.env() };
		try {
			const result = await saveFile(text, options).catch((err) =>
				retry(err, text, options, target.name)
			);
			if (!result) return false;
			// Inzwischen eine andere Datei geladen: weder Stand noch Meldung überschreiben.
			if (file !== target) return true;
			file = afterSave(target, code, result);
			const key = result.method === 'download' ? 'app.file.savedDownload' : 'app.file.saved';
			say({ key, params: { name: result.name }, tone: 'success' });
			return true;
		} catch (err) {
			say(fail(errorPart(err)));
			return false;
		}
	}

	/** Zweiter Versuch nach Schreibfehler über ein Handle; andere Fehler werden weitergeworfen. */
	async function retry(
		err: unknown,
		text: string,
		options: SaveOptions,
		name: string
	): Promise<SaveResult | null> {
		if (!(err instanceof FileServiceError) || !options.handle) throw err;
		const saveAs = { ...options, handle: null, expected: null };
		if (DEAD_HANDLE.has(err.code)) {
			// Grund bleibt nach Picker-Abbruch stehen; scheitert der Picker (z. B. `SecurityError`
			// ohne User-Activation), nennt die Meldung Grund und Fehlschlag (zwei Schlüssel).
			say(fail(errorPart(err)));
			return saveFile(text, saveAs).catch((next) => {
				if (!(next instanceof FileServiceError)) throw next;
				say({ ...fail(errorPart(err)), more: [errorPart(next)] });
				return null;
			});
		}
		if (err.code !== 'changed-on-disk') throw err;
		// Statuszeile nennt den Grund; bleibt nach Abbrechen stehen (nichts gespeichert).
		say(fail(errorPart(err)));
		const choice = await askChanged(name);
		if (choice === null) return null;
		return saveFile(text, choice === 'overwrite' ? { ...options, expected: null } : saveAs);
	}

	/** Rückfrage bei extern geänderter Datei; Enter = Speichern unter, Esc = Abbrechen (`null`). */
	async function askChanged(name: string): Promise<'overwrite' | 'save-as' | null> {
		const reply = await ask({
			title: t('app.shell.changedTitle'),
			text: t('app.shell.changedText', { name }),
			actions: [
				{ label: t('app.shell.saveAs'), value: 'save-as', primary: true },
				{ label: t('app.shell.overwrite'), value: 'overwrite' },
				{ label: t('app.shell.cancel'), value: 'cancel' }
			]
		});
		return reply.value === 'overwrite' || reply.value === 'save-as' ? reply.value : null;
	}

	return {
		get file() {
			return file;
		},
		get controller() {
			return swapped;
		},
		get dirty() {
			return dirtyNow();
		},
		get picking() {
			return newPick !== null;
		},
		guard,
		save,
		open,
		newDiagram,
		closeNew,
		openDropped,
		openRecent,
		restore,
		copyLink,
		openShared,
		dispose: () => swapped?.dispose()
	};
}
