/**
 * Rückfrage-Dialog der Shell (T123 C2, V-24): höchstens eine offene Rückfrage; eine weitere
 * während der offenen erhält sofort `null` (keine Warteschlange). Die Komponente zeigt
 * `current` an und meldet die Antwort über `answer`.
 */
import type { DialogRequest } from './Dialog.svelte';

export type DialogAnswer = { value: string | null; remember: boolean };

export interface DialogEntry {
	readonly request: DialogRequest;
}

export interface Dialogs {
	/** Offene Rückfrage, sonst `null`; je `ask` ein neuer Eintrag (Schlüssel für `{#key}`). */
	readonly current: DialogEntry | null;
	/** Nicht-blockierende Rückfrage; Antwort `null` bei Esc oder Klick neben den Dialog. */
	ask(request: DialogRequest): Promise<DialogAnswer>;
	answer(value: string | null, remember: boolean): void;
}

export function createDialogs(): Dialogs {
	let open = $state.raw<{ request: DialogRequest; resolve: (a: DialogAnswer) => void } | null>(
		null
	);

	function ask(request: DialogRequest): Promise<DialogAnswer> {
		if (open) return Promise.resolve({ value: null, remember: false });
		return new Promise((resolve) => (open = { request, resolve }));
	}

	function answer(value: string | null, remember: boolean) {
		const entry = open;
		open = null;
		entry?.resolve({ value, remember });
	}

	return {
		get current() {
			return open;
		},
		ask,
		answer
	};
}
