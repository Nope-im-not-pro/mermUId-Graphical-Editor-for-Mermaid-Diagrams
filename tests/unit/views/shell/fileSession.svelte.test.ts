// @vitest-environment jsdom
// T123 C2: Reaktivität der Datei-Sitzung und des Dialogzustands (Runes; Nachzug Review C1).
import { flushSync } from 'svelte';
import { writable } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import type { SyncController } from '../../../../src/lib/controllers/sync';
import type { FileEnv, FileHandleLike } from '../../../../src/lib/services/file';
import { createDialogs } from '../../../../src/lib/views/shell/dialogs.svelte';
import { createFileSession } from '../../../../src/lib/views/shell/fileSession.svelte';

const START = 'flowchart TD\n  A\n';

function target(name: string) {
	let file = new File([''], name, { lastModified: 1 });
	return {
		name,
		getFile: async () => file,
		createWritable: async () => ({
			write: async (data: Uint8Array | Blob | string) => {
				const text = typeof data === 'string' ? data : new TextDecoder().decode(data as Uint8Array);
				file = new File([text], name, { lastModified: 2 });
			},
			close: async () => {}
		})
	} satisfies FileHandleLike;
}

describe('createFileSession: Reaktivität', () => {
	it('dirty und file lösen Effekte nach Bearbeiten und Speichern neu aus', async () => {
		let code = $state(START);
		const handle = target('r.mmd');
		const env: FileEnv = {
			document: {} as Document,
			createObjectURL: () => '',
			revokeObjectURL: () => {},
			showSaveFilePicker: async () => handle
		};
		const session = createFileSession({
			code: () => code,
			initial: START,
			create: async (text) => writable({ code: text }) as unknown as SyncController,
			env: () => env,
			ask: async () => ({ value: null }),
			say: () => {},
			reset: () => {}
		});
		const dirty: boolean[] = [];
		const names: string[] = [];
		const stop = $effect.root(() => {
			$effect(() => {
				dirty.push(session.dirty);
			});
			$effect(() => {
				names.push(session.file.name);
			});
		});
		flushSync();
		expect(dirty).toEqual([false]);
		expect(names).toEqual(['diagramm.mmd']);

		code = 'flowchart TD\n  B\n';
		flushSync();
		expect(dirty).toEqual([false, true]);

		expect(await session.save()).toBe(true);
		flushSync();
		expect(dirty.at(-1)).toBe(false);
		expect(names).toEqual(['diagramm.mmd', 'r.mmd']);
		stop();
	});
});

describe('createDialogs: Reaktivität', () => {
	it('current löst Effekte bei ask und answer aus', async () => {
		const dialogs = createDialogs();
		const seen: (string | null)[] = [];
		const stop = $effect.root(() => {
			$effect(() => {
				seen.push(dialogs.current?.request.title ?? null);
			});
		});
		flushSync();
		const reply = dialogs.ask({ title: 'Frage', text: '', actions: [] });
		flushSync();
		dialogs.answer('ok', false);
		flushSync();
		expect(seen).toEqual([null, 'Frage', null]);
		expect(await reply).toEqual({ value: 'ok', remember: false });
		stop();
	});
});
