/**
 * Statusmeldung der Shell (T123 C4, V-24; T114): Erfolg verschwindet nach `SUCCESS_MS` oder
 * sobald sich der Code gegenüber dem Stand beim Setzen ändert; Fehler und Hinweise bleiben.
 * Im Komponenten-Init anlegen (Effekte).
 */
import { untrack } from 'svelte';
import type { StatusMessage } from './status';

/** Erfolgsmeldungen verschwinden nach dieser Zeit (T114). */
export const SUCCESS_MS = 4000;

export interface Messages {
	readonly current: StatusMessage | null;
	say(next: StatusMessage | null): void;
}

export function createMessages(code: () => string): Messages {
	let message = $state.raw<StatusMessage | null>(null);
	/** Code-Stand beim Setzen der Meldung; eine spätere Änderung blendet Erfolg aus. */
	let messageCode: string | null = null;

	$effect(() => {
		const shown = message;
		if (shown?.tone !== 'success') return;
		const id = setTimeout(() => {
			if (message === shown) message = null;
		}, SUCCESS_MS);
		return () => clearTimeout(id);
	});

	$effect(() => {
		const now = code();
		if (now !== messageCode && untrack(() => message?.tone === 'success')) message = null;
	});

	return {
		get current() {
			return message;
		},
		say(next) {
			message = next;
			messageCode = untrack(code);
		}
	};
}
