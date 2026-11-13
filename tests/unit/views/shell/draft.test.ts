// @vitest-environment jsdom
// T132 C1 (F-13): Entwurf (Code, Dateiname) verzögert in localStorage, nach Speichern gelöscht,
// beim Start "wiederherstellen?"; kein Dateipfad/Handle im Speicher; Speicherfehler ohne Absturz.
import { flushSync } from 'svelte';
import { writable } from 'svelte/store';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { SyncController } from '../../../../src/lib/controllers/sync';
import {
	createRecent,
	type FileEnv,
	type RecentBackend,
	type RecentEntry,
	type RecentHandle
} from '../../../../src/lib/services/file';
import {
	createDraftKeeper,
	DRAFT_DELAY,
	DRAFT_KEY,
	readDraft,
	removeDraft,
	writeDraft
} from '../../../../src/lib/views/shell/draft';
import { createFileSession } from '../../../../src/lib/views/shell/fileSession.svelte';
import { installBrowserStubs } from '../canvas/helpers';
import { button, createFake, mountShell, settle, unmountShells } from './helpers';

beforeAll(installBrowserStubs);
afterEach(() => {
	vi.useRealTimers();
	unmountShells();
});

/** Speicher im Speicher; `removeItem` optional wie bei den Shell-Test-Attrappen. */
function memory(initial: Record<string, string> = {}, withRemove = true) {
	const data = new Map(Object.entries(initial));
	const store = {
		getItem: (k: string) => data.get(k) ?? null,
		setItem: (k: string, v: string) => void data.set(k, v),
		...(withRemove ? { removeItem: (k: string) => void data.delete(k) } : {})
	};
	return { data, storage: () => store };
}

const CODE = 'flowchart TD\n  A --> B\n';
const stored = (code: string, name: string) => JSON.stringify({ code, name });

describe('readDraft / writeDraft / removeDraft', () => {
	it('schreibt nur Code und Dateinamen (kein Pfad, kein Handle)', () => {
		const { data, storage } = memory();
		expect(writeDraft(storage, { code: CODE, name: 'C:\\x\\geheim\\plan.mmd' })).toBe(true);
		const raw = JSON.parse(data.get(DRAFT_KEY)!);
		expect(Object.keys(raw).sort()).toEqual(['code', 'name']);
		expect(raw.name).toBe('plan.mmd');
		expect(readDraft(storage)).toEqual({ code: CODE, name: 'plan.mmd' });
	});

	it('ungültige oder leere Einträge gelten als kein Entwurf', () => {
		for (const value of ['{', '42', '{"code":1,"name":"a"}', stored('  \n', 'a.mmd'), '']) {
			expect(readDraft(memory({ [DRAFT_KEY]: value }).storage)).toBeNull();
		}
		expect(readDraft(() => null)).toBeNull();
	});

	it('werfender Speicher (Zugriff, Quota) ohne Ausnahme', () => {
		const throwing = () => {
			throw new DOMException('denied', 'SecurityError');
		};
		const full = () => ({
			getItem: () => null,
			setItem: () => {
				throw new DOMException('full', 'QuotaExceededError');
			},
			removeItem: () => {
				throw new Error('x');
			}
		});
		expect(readDraft(throwing)).toBeNull();
		expect(writeDraft(throwing, { code: CODE, name: 'a.mmd' })).toBe(false);
		expect(writeDraft(full, { code: CODE, name: 'a.mmd' })).toBe(false);
		expect(removeDraft(throwing)).toBe(false);
		expect(removeDraft(full)).toBe(false);
	});

	it('ohne removeItem wird der Eintrag geleert', () => {
		const { data, storage } = memory({ [DRAFT_KEY]: stored(CODE, 'a.mmd') }, false);
		expect(removeDraft(storage)).toBe(true);
		expect(readDraft(storage)).toBeNull();
		expect(data.get(DRAFT_KEY)).toBe('');
	});
});

describe('createDraftKeeper', () => {
	it('sichert verzögert und nur den letzten Stand', () => {
		vi.useFakeTimers();
		const { storage } = memory();
		const setItem = vi.spyOn(storage(), 'setItem');
		const keeper = createDraftKeeper(storage);
		keeper.update({ code: 'flowchart TD\n  A\n', name: 'a.mmd', dirty: true });
		vi.advanceTimersByTime(DRAFT_DELAY - 1);
		keeper.update({ code: CODE, name: 'a.mmd', dirty: true });
		vi.advanceTimersByTime(DRAFT_DELAY - 1);
		expect(readDraft(storage)).toBeNull();
		vi.advanceTimersByTime(1);
		expect(readDraft(storage)).toEqual({ code: CODE, name: 'a.mmd' });
		expect(setItem).toHaveBeenCalledTimes(1);
	});

	it('unveränderter oder leerer Stand erzeugt keinen Entwurf', () => {
		vi.useFakeTimers();
		const { data, storage } = memory();
		const keeper = createDraftKeeper(storage);
		keeper.update({ code: CODE, name: 'a.mmd', dirty: false });
		keeper.update({ code: '   \n', name: 'a.mmd', dirty: true });
		vi.advanceTimersByTime(DRAFT_DELAY * 2);
		expect(data.has(DRAFT_KEY)).toBe(false);
	});

	it('nach Speichern (sauber) wird der Entwurf gelöscht; Fremdentwurf bleibt bis zur Änderung', () => {
		vi.useFakeTimers();
		const { data, storage } = memory({ [DRAFT_KEY]: stored('alt', 'alt.mmd') });
		const keeper = createDraftKeeper(storage);
		// Start ohne eigene Änderung: vorhandener Entwurf bleibt (z. B. Esc auf der Rückfrage).
		keeper.update({ code: CODE, name: 'a.mmd', dirty: false });
		expect(data.has(DRAFT_KEY)).toBe(true);
		keeper.update({ code: CODE, name: 'a.mmd', dirty: true });
		vi.advanceTimersByTime(DRAFT_DELAY);
		expect(readDraft(storage)?.code).toBe(CODE);
		keeper.update({ code: CODE, name: 'a.mmd', dirty: false });
		expect(data.has(DRAFT_KEY)).toBe(false);
	});

	it('sauber vor Ablauf der Verzögerung: nichts geschrieben', () => {
		vi.useFakeTimers();
		const { data, storage } = memory();
		const keeper = createDraftKeeper(storage);
		keeper.update({ code: CODE, name: 'a.mmd', dirty: true });
		keeper.update({ code: CODE, name: 'a.mmd', dirty: false });
		vi.advanceTimersByTime(DRAFT_DELAY);
		expect(data.has(DRAFT_KEY)).toBe(false);
	});

	it('flush schreibt sofort, dispose verwirft den ausstehenden Stand, clear löscht', () => {
		vi.useFakeTimers();
		const { data, storage } = memory();
		const keeper = createDraftKeeper(storage);
		keeper.update({ code: CODE, name: 'a.mmd', dirty: true });
		keeper.flush();
		expect(readDraft(storage)?.code).toBe(CODE);
		keeper.update({ code: 'flowchart LR\n  X\n', name: 'a.mmd', dirty: true });
		keeper.dispose();
		vi.advanceTimersByTime(DRAFT_DELAY);
		expect(readDraft(storage)?.code).toBe(CODE);
		keeper.clear();
		expect(data.has(DRAFT_KEY)).toBe(false);
	});

	it('Quota-Fehler beim Sichern ohne Absturz', () => {
		vi.useFakeTimers();
		const full = () => ({
			getItem: () => null,
			setItem: () => {
				throw new DOMException('full', 'QuotaExceededError');
			}
		});
		const keeper = createDraftKeeper(full);
		keeper.update({ code: CODE, name: 'a.mmd', dirty: true });
		expect(() => vi.advanceTimersByTime(DRAFT_DELAY)).not.toThrow();
		expect(() => keeper.update({ code: CODE, name: 'a.mmd', dirty: false })).not.toThrow();
	});
});

describe('FileSession.restore', () => {
	function session() {
		let code = 'flowchart TD\n';
		const said: unknown[] = [];
		const s = createFileSession({
			code: () => code,
			initial: code,
			create: async (text) => {
				code = text;
				return Object.assign(writable({ code: text }), {
					dispose: () => {}
				}) as unknown as SyncController;
			},
			env: () => ({}) as FileEnv,
			ask: async () => ({ value: null }),
			say: (m) => said.push(m),
			reset: () => {}
		});
		return { s, said };
	}

	it('lädt Code und Namen als ungespeicherte neue Datei ohne Handle', async () => {
		const { s, said } = session();
		await s.restore({ code: CODE, name: 'plan.mmd' });
		expect(s.file.name).toBe('plan.mmd');
		expect(s.file.handle).toBeNull();
		expect(s.file.kind).toBe('mmd');
		expect(s.dirty).toBe(true);
		expect(said.at(-1)).toEqual({
			key: 'app.shell.draftRestored',
			params: { name: 'plan.mmd' },
			tone: 'success'
		});
	});

	it('Markdown-Name wird zu .mmd (Hülle nicht im Entwurf)', async () => {
		const { s } = session();
		await s.restore({ code: CODE, name: 'notizen.md' });
		expect(s.file.name).toBe('notizen.mmd');
	});
});

// Erster Shell-Mount je Datei dauert unter Volllast (40 Dateien parallel) über 5 s.
describe('Shell: Rückfrage beim Start', { timeout: 20000 }, () => {
	const dialog = (target: HTMLElement) => target.querySelector('[role="dialog"]');

	it('ohne Entwurf keine Rückfrage', async () => {
		const { target } = await mountShell(CODE, { storage: memory().storage });
		await settle();
		expect(dialog(target)).toBeNull();
	});

	it('Wiederherstellen lädt den Entwurf', async () => {
		const { storage } = memory({ [DRAFT_KEY]: stored('flowchart LR\n  X\n', 'plan.mmd') });
		const created: string[] = [];
		const create = (text: string) => {
			created.push(text);
			return createFake(text);
		};
		const { target } = await mountShell(CODE, { storage, create });
		await settle();
		expect(dialog(target)?.textContent).toContain('plan.mmd');
		button(target, 'Wiederherstellen').click();
		flushSync();
		await settle();
		expect(dialog(target)).toBeNull();
		expect(created).toEqual(['flowchart LR\n  X\n']);
		expect(target.querySelector('[data-testid="file"]')?.textContent).toContain('plan.mmd');
		expect(document.title).toBe('plan.mmd* - mermUId');
	});

	it('Verwerfen löscht den Entwurf und behält das Dokument', async () => {
		const { data, storage } = memory({ [DRAFT_KEY]: stored('flowchart LR\n  X\n', 'plan.mmd') });
		const { target } = await mountShell(CODE, { storage });
		await settle();
		button(target, 'Verwerfen').click();
		flushSync();
		await settle();
		expect(dialog(target)).toBeNull();
		expect(data.has(DRAFT_KEY)).toBe(false);
		expect(document.title).toBe('diagramm.mmd - mermUId');
	});

	it('Esc behält den Entwurf und das Dokument', async () => {
		const draft = stored('flowchart LR\n  X\n', 'plan.mmd');
		const { data, storage } = memory({ [DRAFT_KEY]: draft });
		const { target } = await mountShell(CODE, { storage });
		await settle();
		dialog(target)!.dispatchEvent(
			new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true })
		);
		flushSync();
		await settle();
		expect(dialog(target)).toBeNull();
		expect(data.get(DRAFT_KEY)).toBe(draft);
		expect(document.title).toBe('diagramm.mmd - mermUId');
	});

	it('werfender Speicher: Start ohne Rückfrage und ohne Absturz', async () => {
		const storage = () => {
			throw new DOMException('denied', 'SecurityError');
		};
		const { target } = await mountShell(CODE, { storage });
		await settle();
		expect(dialog(target)).toBeNull();
	});
});

// T132 C2 (F-13, M-15 a): "Zuletzt geöffnet" über Handles; Liste nur mit File System Access.
/** Handle-Attrappe; `permission` steuert query/requestPermission, `gone` simuliert Datei weg. */
function recentHandle(name: string, text = 'flowchart LR\n  R\n', permission = 'granted') {
	const requests: unknown[] = [];
	const h: RecentHandle & { gone?: boolean } = {
		name,
		getFile: async () => {
			if (h.gone) throw new DOMException('weg', 'NotFoundError');
			return new File([text], name);
		},
		isSameEntry: async (other) => other === h,
		queryPermission: async () => (permission === 'granted' ? 'granted' : 'prompt'),
		requestPermission: async (d) => {
			requests.push(d);
			return permission as PermissionState;
		}
	};
	return { h, requests };
}

function recentMemory(list: RecentEntry[] = []) {
	const box: RecentBackend & { value: unknown } = {
		value: list,
		read: async () => box.value,
		write: async (next) => void (box.value = next)
	};
	return box;
}

describe('FileSession.openRecent', () => {
	function session(answer: string | null = 'discard', start = 'flowchart TD\n') {
		let code = start;
		const said: unknown[] = [];
		const asked: unknown[] = [];
		const s = createFileSession({
			code: () => code,
			initial: 'flowchart TD\n',
			create: async (text) => {
				code = text;
				return Object.assign(writable({ code: text }), {
					dispose: () => {}
				}) as unknown as SyncController;
			},
			env: () => ({}) as FileEnv,
			ask: async (r) => {
				asked.push(r);
				return { value: answer };
			},
			say: (m) => said.push(m),
			reset: () => {}
		});
		return { s, said, asked, edit: (next: string) => (code = next), code: () => code };
	}

	/** Datei auf der "Platte" mit schreibbarem Handle; jedes Schreiben ändert den Stand. */
	function diskHandle(name: string, text: string) {
		const disk = { text, modified: 1 };
		const h: RecentHandle = {
			name,
			getFile: async () => new File([disk.text], name, { lastModified: disk.modified }),
			createWritable: async () => {
				let next = '';
				return {
					write: async (data) => void (next += new TextDecoder().decode(data as Uint8Array)),
					close: async () => void Object.assign(disk, { text: next, modified: disk.modified + 1 })
				};
			},
			isSameEntry: async (other) => other === h,
			queryPermission: async () => 'granted'
		};
		return { h, disk };
	}

	it('erteilte Berechtigung: lädt Datei mit Handle', async () => {
		const { s, said, asked } = session();
		const { h } = recentHandle('r.mmd');
		await s.openRecent({ name: 'r.mmd', handle: h });
		expect(s.file.name).toBe('r.mmd');
		expect(s.file.handle).toBe(h);
		expect(s.dirty).toBe(false);
		expect(asked).toEqual([]);
		expect(said.at(-1)).toEqual({
			key: 'app.shell.opened',
			params: { name: 'r.mmd' },
			tone: 'success'
		});
	});

	it('fragt die Berechtigung neu an; verweigert -> Meldung mit Name, nichts geladen', async () => {
		const { s, said } = session();
		const { h, requests } = recentHandle('r.mmd', undefined, 'denied');
		await s.openRecent({ name: 'r.mmd', handle: h });
		expect(requests).toEqual([{ mode: 'read' }]);
		expect(s.file.handle).toBeNull();
		expect(said.at(-1)).toEqual({
			key: 'app.recent.denied',
			params: { name: 'r.mmd' },
			tone: 'error'
		});
	});

	it('Datei weg -> Meldung mit Name', async () => {
		const { s, said } = session();
		const { h } = recentHandle('r.mmd');
		h.gone = true;
		await s.openRecent({ name: 'r.mmd', handle: h });
		expect(said.at(-1)).toEqual({
			key: 'app.recent.missing',
			params: { name: 'r.mmd' },
			tone: 'error'
		});
	});

	it('Dirty-Schutz: Rückfrage wie beim Öffnen, Abbrechen lädt nichts', async () => {
		const { s, asked } = session('cancel', 'flowchart TD\n  geändert\n');
		const { h } = recentHandle('r.mmd');
		await s.openRecent({ name: 'r.mmd', handle: h });
		expect(asked).toHaveLength(1);
		expect(s.file.handle).toBeNull();
		expect(s.dirty).toBe(true);
	});

	it('Dirty-Schutz: Speichern derselben Datei lädt den gespeicherten Stand', async () => {
		const { s, asked, edit, code } = session('save');
		const { h, disk } = diskHandle('r.mmd', 'flowchart LR\n  R\n');
		await s.openRecent({ name: 'r.mmd', handle: h });
		const edited = 'flowchart LR\n  R --> S\n';
		edit(edited);
		expect(s.dirty).toBe(true);
		await s.openRecent({ name: 'r.mmd', handle: h });
		expect(asked).toHaveLength(1);
		expect(disk.text).toBe(edited);
		expect(code()).toBe(edited);
		expect(s.file.saved).toBe(edited);
		expect(s.file.stamp).toEqual({ lastModified: disk.modified, size: edited.length });
		expect(s.dirty).toBe(false);
	});

	it('Berechtigung vor der Rückfrage (Nutzer-Geste), Lesen erst danach', async () => {
		const { s, asked } = session('discard', 'flowchart TD\n  geändert\n');
		const { h } = recentHandle('r.mmd');
		const seen: string[] = [];
		const at = (step: string) => seen.push(`${step}@${asked.length}`);
		const spied: RecentHandle = {
			...h,
			queryPermission: async () => (at('query'), 'prompt'),
			requestPermission: async () => (at('request'), 'granted'),
			getFile: async () => (at('read'), h.getFile())
		};
		await s.openRecent({ name: 'r.mmd', handle: spied });
		expect(seen.slice(0, 2)).toEqual(['query@0', 'request@0']);
		expect(seen).toContain('read@1');
		expect(seen).not.toContain('read@0');
	});

	it('Dirty-Schutz: Verwerfen lädt die Datei', async () => {
		const { s, asked } = session('discard', 'flowchart TD\n  geändert\n');
		const { h } = recentHandle('r.mmd');
		await s.openRecent({ name: 'r.mmd', handle: h });
		expect(asked).toHaveLength(1);
		expect(s.file.handle).toBe(h);
	});
});

describe('Shell: Zuletzt geöffnet', { timeout: 20000 }, () => {
	const list = (target: HTMLElement) => target.querySelector('nav[aria-label="Zuletzt geöffnet"]');
	const fsaEnv = (picked: RecentHandle): FileEnv => ({
		document,
		createObjectURL: () => 'blob:x',
		revokeObjectURL: () => {},
		showOpenFilePicker: async () => [picked],
		showSaveFilePicker: async () => picked
	});

	it('ohne File System Access nicht gerendert, auch mit gespeicherten Einträgen', async () => {
		const { h } = recentHandle('r.mmd');
		const recent = createRecent(recentMemory([{ name: 'r.mmd', handle: h }]));
		const env: FileEnv = { document, createObjectURL: () => '', revokeObjectURL: () => {} };
		const { target } = await mountShell(CODE, { recent, fileEnv: env, storage: memory().storage });
		await settle();
		expect(list(target)).toBeNull();
	});

	it('mit File System Access: gespeicherte Einträge sichtbar, Klick öffnet', async () => {
		const { h } = recentHandle('r.mmd');
		const backend = recentMemory([{ name: 'r.mmd', handle: h }]);
		const { target } = await mountShell(CODE, {
			recent: createRecent(backend),
			fileEnv: fsaEnv(h),
			storage: memory().storage
		});
		await settle();
		expect(list(target)?.textContent).toContain('r.mmd');
		button(target, 'r.mmd').click();
		await settle();
		await settle();
		expect(target.querySelector('[data-testid="file"]')?.textContent).toContain('r.mmd');
		expect(document.title).toBe('r.mmd - mermUId');
	});

	it('Öffnen über den Picker setzt die Datei nach vorn; × entfernt den Eintrag', async () => {
		const old = recentHandle('alt.mmd').h;
		const { h } = recentHandle('neu.mmd');
		const backend = recentMemory([{ name: 'alt.mmd', handle: old }]);
		const { target } = await mountShell(CODE, {
			recent: createRecent(backend),
			fileEnv: fsaEnv(h),
			storage: memory().storage
		});
		await settle();
		button(target, 'Öffnen').click();
		await settle();
		await settle();
		const names = () =>
			[...list(target)!.querySelectorAll('button.open')].map((b) => b.textContent);
		expect(names()).toEqual(['neu.mmd', 'alt.mmd']);
		button(target, 'alt.mmd aus der Liste entfernen').click();
		await settle();
		expect(names()).toEqual(['neu.mmd']);
		expect((backend.value as RecentEntry[]).map((e) => e.name)).toEqual(['neu.mmd']);
	});

	it('× hält den Fokus: nächster bzw. vorheriger Eintrag, leere Liste -> Öffnen', async () => {
		const [a, b, c] = ['a.mmd', 'b.mmd', 'c.mmd'].map((n) => recentHandle(n).h);
		const backend = recentMemory([a, b, c].map((h) => ({ name: h.name, handle: h })));
		const { target } = await mountShell(CODE, {
			recent: createRecent(backend),
			fileEnv: fsaEnv(a),
			storage: memory().storage
		});
		await settle();
		const remove = (name: string) => button(target, `${name} aus der Liste entfernen`);
		remove('b.mmd').focus();
		remove('b.mmd').click();
		await settle();
		expect(document.activeElement).toBe(remove('c.mmd'));
		remove('c.mmd').click();
		await settle();
		expect(document.activeElement).toBe(remove('a.mmd'));
		remove('a.mmd').click();
		await settle();
		expect(list(target)).toBeNull();
		expect(document.activeElement).toBe(button(target, 'Öffnen'));
	});

	it('IndexedDB-Fehler: Start ohne Liste und ohne Absturz', async () => {
		const { h } = recentHandle('r.mmd');
		const broken: RecentBackend = {
			read: () => Promise.reject(new DOMException('x', 'InvalidStateError')),
			write: () => Promise.reject(new DOMException('x', 'QuotaExceededError'))
		};
		const { target } = await mountShell(CODE, {
			recent: createRecent(broken),
			fileEnv: fsaEnv(h),
			storage: memory().storage
		});
		await settle();
		expect(list(target)).toBeNull();
	});
});
