/**
 * Übersetzung der Model-Fehlercodes (T128 C3): `ModelError` -> `services.model.<code>` in der
 * aktuellen Sprache; andere Fehler liefern ihre `message` unverändert.
 */
import { ModelError } from '../../model/errors';
import { msg, type MessageKey } from '../../services/i18n';

/** Anzeigetext eines Fehlers. */
export function describeError(e: unknown): string {
	if (e instanceof ModelError) {
		const key: MessageKey = `services.model.${e.code}`;
		return msg(key, { ...e.params });
	}
	return e instanceof Error ? e.message : String(e);
}

/** `ModelError` als `Error` mit übersetzter `message` (Ursache in `cause`), sonst `e` selbst. */
export function localize(e: unknown): unknown {
	return e instanceof ModelError ? new Error(describeError(e), { cause: e }) : e;
}
