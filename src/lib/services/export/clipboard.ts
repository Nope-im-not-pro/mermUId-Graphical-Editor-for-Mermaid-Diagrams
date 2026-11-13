/**
 * Bild in die Zwischenablage (T127 C2, F-08) über `navigator.clipboard.write` und
 * `ClipboardItem`. Erkennung je MIME-Typ über `ClipboardItem.supports`, wo vorhanden.
 * Der Blob darf als Promise kommen: `write` läuft dann noch in der Nutzergeste, das Bild wird
 * nachgereicht (Safari/Firefox verlangen die Geste beim Aufruf).
 */
import { msg } from '../i18n';

export type CopyKind = 'png' | 'svg';

export const COPY_TYPES: Readonly<Record<CopyKind, string>> = {
	png: 'image/png',
	svg: 'image/svg+xml'
};

interface ClipboardGlobals {
	navigator?: { clipboard?: { write?: (items: unknown[]) => Promise<void> } };
	ClipboardItem?: {
		new (items: Record<string, Blob | Promise<Blob>>): unknown;
		supports?: (type: string) => boolean;
	};
}

const globals = () => globalThis as unknown as ClipboardGlobals;

/** Browser kann ein Bild dieser Art in die Zwischenablage schreiben. */
export function canCopy(kind: CopyKind): boolean {
	const { navigator, ClipboardItem } = globals();
	if (typeof navigator?.clipboard?.write !== 'function' || typeof ClipboardItem !== 'function') {
		return false;
	}
	if (typeof ClipboardItem.supports !== 'function') return true;
	try {
		return ClipboardItem.supports(COPY_TYPES[kind]) === true;
	} catch {
		return false;
	}
}

/** Schreibt das Bild in die Zwischenablage; wirft ohne Unterstützung oder bei Ablehnung. */
export async function copyBlob(kind: CopyKind, blob: Blob | Promise<Blob>): Promise<void> {
	// app.*-Schlüssel in services: Scope-Trennung W28 (msg/services.ts fremd), Verschiebung nach services.* offen.
	if (!canCopy(kind)) throw new Error(msg('app.export.copyUnsupported'));
	const { navigator, ClipboardItem } = globals();
	await navigator!.clipboard!.write!([new ClipboardItem!({ [COPY_TYPES[kind]]: blob })]);
}
