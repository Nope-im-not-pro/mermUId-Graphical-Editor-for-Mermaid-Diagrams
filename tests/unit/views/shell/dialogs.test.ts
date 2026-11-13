// T123 C2 (V-24): Dialog-Rückfrage als eigenes Modul, ohne Komponente geprüft.
import { describe, expect, it } from 'vitest';
import type { DialogRequest } from '../../../../src/lib/views/shell/Dialog.svelte';
import { createDialogs } from '../../../../src/lib/views/shell/dialogs.svelte';

const request = (title: string): DialogRequest => ({
	title,
	text: 'Text',
	actions: [
		{ label: 'Ja', value: 'yes' },
		{ label: 'Nein', value: 'no' }
	]
});

describe('createDialogs', () => {
	it('Start: keine offene Rückfrage', () => {
		expect(createDialogs().current).toBeNull();
	});

	it('ask öffnet die Rückfrage, answer löst sie mit Wert und Merken auf', async () => {
		const dialogs = createDialogs();
		const req = request('A');
		const reply = dialogs.ask(req);
		expect(dialogs.current?.request).toBe(req);
		dialogs.answer('yes', true);
		expect(dialogs.current).toBeNull();
		expect(await reply).toEqual({ value: 'yes', remember: true });
	});

	it('Esc/Abbruch: answer(null) liefert value null', async () => {
		const dialogs = createDialogs();
		const reply = dialogs.ask(request('A'));
		dialogs.answer(null, false);
		expect(await reply).toEqual({ value: null, remember: false });
	});

	it('zweite Rückfrage bei offener: sofort null, die offene bleibt', async () => {
		const dialogs = createDialogs();
		const first = request('A');
		const reply = dialogs.ask(first);
		const entry = dialogs.current;
		expect(await dialogs.ask(request('B'))).toEqual({ value: null, remember: false });
		expect(dialogs.current).toBe(entry);
		expect(dialogs.current?.request).toBe(first);
		dialogs.answer('no', false);
		expect(await reply).toEqual({ value: 'no', remember: false });
	});

	it('answer ohne offene Rückfrage: nichts passiert', () => {
		const dialogs = createDialogs();
		expect(() => dialogs.answer('yes', false)).not.toThrow();
		expect(dialogs.current).toBeNull();
	});

	it('jede neue Rückfrage ist ein neuer Eintrag (auch bei gleicher Anfrage)', async () => {
		const dialogs = createDialogs();
		const req = request('A');
		const first = dialogs.ask(req);
		const entry = dialogs.current;
		dialogs.answer('yes', false);
		await first;
		void dialogs.ask(req);
		expect(dialogs.current).not.toBeNull();
		expect(dialogs.current).not.toBe(entry);
	});

	it('ask/answer ohne Objektbindung nutzbar (Übergabe an createFileSession)', async () => {
		const { ask, answer } = createDialogs();
		const reply = ask(request('A'));
		answer('yes', false);
		expect((await reply).value).toBe('yes');
	});
});
