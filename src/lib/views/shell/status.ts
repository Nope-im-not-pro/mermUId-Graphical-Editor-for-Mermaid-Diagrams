import type { SyncMode, SyncState } from '../../controllers/sync';
import type { LayoutMeta } from '../../model/types';
import { FileServiceError, MAX_FILE_BYTES, type FileErrorCode } from '../../services/file';
import { DICTIONARIES, LOCALES, translate, type MessageKey } from '../../services/i18n';
import { t } from './i18n.svelte';

type StatusInput = Pick<SyncState, 'mode' | 'pending' | 'conflict' | 'errors'>;

export interface Cursor {
	readonly line: number;
	readonly column: number;
}

export function parserStatus(s: StatusInput): string {
	if (s.mode === 'code') return t('app.status.parserCode');
	return s.errors.length > 0
		? t('app.status.parserError', { line: s.errors[0].line })
		: t('app.status.parserOk');
}

export function syncStatus(s: StatusInput): string {
	if (s.conflict) return t('app.status.syncConflict');
	if (s.pending) return t('app.status.syncPending');
	if (s.mode === 'code') return t('app.status.syncCode');
	if (s.errors.length > 0) return t('status.syncError');
	return t('app.status.syncOk');
}

/** Live-Eintrag der Statuszeile: Endzustand für die Region, `pending` = sichtbarer Zwischentext. */
export interface LiveItem {
	readonly settled: string;
	readonly pending?: string;
}

/**
 * Parser/Sync für die Live-Region: Sync-Endzustand ohne "ausstehend" in aktueller Sprache
 * (T114 I3); der Zwischentext steht nur in `pending` und wird außerhalb der Region gezeigt.
 */
export function liveStatus(s: StatusInput): LiveItem[] {
	const now = syncStatus(s);
	const settled = syncStatus({ ...s, pending: false });
	return [{ settled: parserStatus(s) }, now === settled ? { settled } : { settled, pending: now }];
}

export function layoutStatus(mode: SyncMode, layout: LayoutMeta['mode']): string {
	if (mode === 'sequence') return t('app.status.layoutSequence');
	if (mode === 'code') return t('app.status.layoutMermaid');
	return layout === 'manual' ? t('app.status.layoutManual') : t('app.status.layoutAuto');
}

export const cursorStatus = (c: Cursor | null): string =>
	c ? t('app.status.cursor', { line: c.line, column: c.column }) : t('app.status.cursorNone');

/** Erstes Schlüsselwort nach Kommentaren, Direktiven und Frontmatter. */
export function diagramKeyword(code: string): string {
	let front = false;
	for (const raw of code.split('\n')) {
		const line = raw.trim();
		if (line === '---') {
			front = !front;
			continue;
		}
		if (front || line === '' || line.startsWith('%%')) continue;
		return line.split(/\s+/)[0];
	}
	return '';
}

export function typeLabel(mode: SyncMode, code: string): string {
	if (mode === 'flowchart') return 'flowchart';
	if (mode === 'sequence') return 'sequenceDiagram';
	return t('app.status.codeOnly', { type: diagramKeyword(code) || t('app.status.typeUnknown') });
}

/** Art der Meldung: Fehler als `role="alert"`, Erfolg verschwindet von selbst (T114, V-19). */
export type Tone = 'info' | 'success' | 'error';

/** Parameterwert: Text/Zahl oder ein Teil, der bei der Anzeige mitübersetzt wird. */
export type PartParams = Readonly<Record<string, string | number | MessagePart>>;

export interface MessagePart {
	readonly key: MessageKey;
	readonly params?: PartParams;
}

/** Meldung als Schlüssel; `more` hängt Teile an ("<Grund> <Fehlschlag>"). Text erst bei Anzeige. */
export interface StatusMessage extends MessagePart {
	readonly tone: Tone;
	readonly more?: readonly MessagePart[];
}

/** Fehlermeldung aus einem Teil (Shell, Datei-Sitzung, Export; T123 C4). */
export const fail = (part: MessagePart): StatusMessage => ({ ...part, tone: 'error' });

/** Fremder Text ohne Schlüssel (z. B. Ablehnungsgrund aus dem Controller): bleibt unübersetzt. */
export const plain = (text: string): MessagePart => ({ key: 'app.status.text', params: { text } });

function partText(part: MessagePart): string {
	if (!part.params) return t(part.key);
	const params = Object.fromEntries(
		Object.entries(part.params).map(([k, v]) => [k, typeof v === 'object' ? partText(v) : v])
	);
	return t(part.key, params);
}

/** Anzeigetext in der aktuellen Sprache (reaktiv über `t`). */
export function messageText(m: StatusMessage | null): string {
	return m ? [m, ...(m.more ?? [])].map(partText).join(' ') : '';
}

const flat = (params?: PartParams) =>
	params &&
	Object.fromEntries(
		Object.entries(params).filter((e): e is [string, string | number] => typeof e[1] !== 'object')
	);

const matches = (text: string, part: MessagePart) =>
	LOCALES.some((l) => translate(l, part.key, flat(part.params)) === text);

let unique: readonly MessageKey[] | null = null;

/** Parameterlose Schlüssel, deren Text in jeder Sprache nur ihnen gehört (einmal berechnet). */
function uniqueKeys(): readonly MessageKey[] {
	if (unique) return unique;
	const keys = (Object.keys(DICTIONARIES.de) as MessageKey[]).filter(
		(k) => !DICTIONARIES.de[k].includes('{')
	);
	const shared = new Set<MessageKey>();
	for (const l of LOCALES) {
		const owner = new Map<string, MessageKey>();
		for (const k of keys) {
			const other = owner.get(DICTIONARIES[l][k]);
			if (other) shared.add(other).add(k);
			else owner.set(DICTIONARIES[l][k], k);
		}
	}
	return (unique = keys.filter((k) => !shared.has(k)));
}

/**
 * Text eines Dienstes zurück auf seinen Schlüssel: erst die Kandidaten (mit Parametern), dann
 * jeder eindeutige parameterlose Schlüssel, dessen Text in einer Sprache gleich ist; sonst
 * `plain` (z. B. DE "Hinweis" gehört zwei Schlüsseln).
 */
export function known(text: string, candidates: readonly MessagePart[] = []): MessagePart {
	const hit = candidates.find((c) => matches(text, c));
	if (hit) return hit;
	const key = uniqueKeys().find((k) => matches(text, { key: k }));
	return key ? { key } : plain(text);
}

/** `FileServiceError.code` -> Schlüssel (Dienste liefern nur Text, O-75/T114). */
const FILE_KEYS: Record<FileErrorCode, MessagePart> = {
	'open-failed': { key: 'services.file.openFailed' },
	'save-failed': { key: 'services.file.saveFailed' },
	'not-utf8': { key: 'services.file.notUtf8' },
	'too-large': {
		key: 'services.file.tooLarge',
		params: { max: `${MAX_FILE_BYTES / (1024 * 1024)} MB` }
	},
	'changed-on-disk': { key: 'services.file.changedOnDisk' },
	'permission-denied': { key: 'services.file.permissionDenied' },
	'not-found': { key: 'services.file.notFound' },
	quota: { key: 'services.file.quota' }
};

/** Fehler als Meldungsteil; nur Dienst-Texte werden Schlüssel, fremder Text bleibt Text. */
export function errorPart(err: unknown): MessagePart {
	const text = err instanceof Error ? err.message : String(err);
	return known(text, err instanceof FileServiceError ? [FILE_KEYS[err.code]] : []);
}
