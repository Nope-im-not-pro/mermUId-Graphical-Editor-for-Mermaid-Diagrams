/**
 * Datei-Zustand der Shell (T21 C3): Name, Art, Handle, Zeilenende, BOM, ggf. Markdown-Hülle und
 * zuletzt gespeicherter Code (dirty/clean). Lesen und Schreiben der Texte über services/file;
 * `.mmd` bleibt beim Laden unverändert, `.md` ersetzt beim Speichern nur den gewählten Block.
 */
import {
	FileServiceError,
	readMarkdown,
	readMmd,
	replaceMermaidBlock,
	writeMmd,
	type FileHandleLike,
	type FileKind,
	type FileStamp,
	type LineEnding,
	type OpenedFile,
	type SaveOptions,
	type SaveResult
} from '../../services/file';
import { t } from './i18n.svelte';

export const NEW_TEXT = 'flowchart TD\n';

export interface FileState {
	name: string;
	kind: FileKind;
	handle: FileHandleLike | null;
	lineEnding: LineEnding;
	/** Gelesene Datei begann mit BOM; Speichern schreibt es wieder (V-04). */
	hadBom: boolean;
	/** Stand beim Öffnen bzw. letzten Speichern; vor dem Schreiben verglichen (changed-on-disk). */
	stamp: FileStamp | null;
	/** Gelesener Markdown-Text bei `.md`, sonst `null`. */
	markdown: string | null;
	/** Index des bearbeiteten Mermaid-Blocks (nur `.md`). */
	block: number;
	/** Code beim letzten Laden oder Speichern. */
	saved: string;
}

export type FileBase = Omit<FileState, 'saved'>;

export type OpenPlan =
	| { type: 'error'; message: string }
	| { type: 'load'; text: string; file: FileBase }
	| {
			type: 'choose';
			blocks: { index: number; label: string }[];
			codes: string[];
			file: FileBase;
	  };

export function newFile(saved: string): FileState {
	return {
		// Standard-Dateiname je Sprache (O-137): DE `diagramm.mmd`, EN `diagram.mmd`.
		name: t('app.file.newName'),
		kind: 'mmd',
		handle: null,
		lineEnding: 'lf',
		hadBom: false,
		stamp: null,
		markdown: null,
		block: 0,
		saved
	};
}

export function isDirty(state: FileState, code: string): boolean {
	return code !== state.saved;
}

/**
 * Tab-Titel (T105 C2, V-11): `<Dateiname>* - mermUId` bei Änderungen, sonst ohne Stern. Ohne
 * geöffnete Datei derselbe Standardname wie in der Toolbar (O-73).
 */
export function tabTitle(state: FileState, dirty: boolean): string {
	return `${state.name}${dirty ? '*' : ''} - mermUId`;
}

/** Keine UTF-8-Datei (V-04): Fehler-Plan statt Laden; andere Fehler bleiben Ausnahmen. */
export function planOpen(opened: OpenedFile): OpenPlan {
	try {
		return planDecoded(opened);
	} catch (error) {
		if (error instanceof FileServiceError) return { type: 'error', message: error.message };
		throw error;
	}
}

function planDecoded(opened: OpenedFile): OpenPlan {
	const base = {
		name: opened.name,
		handle: opened.handle,
		stamp: opened.stamp ?? null,
		block: 0
	};
	if (opened.kind === 'mmd') {
		const { text, lineEnding, hadBom } = readMmd(opened.bytes);
		return {
			type: 'load',
			text,
			file: { ...base, kind: 'mmd', lineEnding, hadBom, markdown: null }
		};
	}
	if (opened.kind !== 'md') {
		return { type: 'error', message: t('app.file.unsupported') };
	}
	const md = readMarkdown(opened.bytes);
	const file: FileBase = {
		...base,
		kind: 'md',
		lineEnding: md.lineEnding,
		hadBom: md.hadBom,
		markdown: md.text
	};
	if (md.selection.count === 0) {
		return { type: 'error', message: t('app.file.noBlock', { name: opened.name }) };
	}
	if (!md.selection.needsSelection) return { type: 'load', text: md.blocks[0].code, file };
	return {
		type: 'choose',
		blocks: md.blocks.map((b) => ({
			index: b.index,
			label: t('app.file.block', { number: b.index + 1, line: b.code.split(/\r?\n/)[0] })
		})),
		codes: md.blocks.map((b) => b.code),
		file
	};
}

export function chooseBlock(
	plan: Extract<OpenPlan, { type: 'choose' }>,
	index: number
): { text: string; file: FileBase } {
	return { text: plan.codes[index], file: { ...plan.file, block: index } };
}

/** Markdown-Text nach Ersetzen des Blocks, ohne BOM. */
function markdownAfter(state: FileState, code: string): string | null {
	return state.markdown === null ? null : replaceMermaidBlock(state.markdown, state.block, code);
}

/** Dateitext zum Speichern des aktuellen Codes, ohne BOM (BOM über `saveOptions`). */
export function saveText(state: FileState, code: string): string {
	return markdownAfter(state, code) ?? writeMmd(code, state.lineEnding);
}

/** Optionen für `saveFile` aus dem Datei-Zustand: Handle, Name, BOM, erwarteter Stand. */
export function saveOptions(
	state: FileState
): Required<Pick<SaveOptions, 'handle' | 'suggestedName' | 'bom' | 'expected'>> {
	return {
		handle: state.handle,
		suggestedName: state.name,
		bom: state.hadBom,
		expected: state.stamp
	};
}

export function afterSave(state: FileState, code: string, result: SaveResult): FileState {
	return {
		...state,
		name: result.name,
		handle: result.handle,
		stamp: result.stamp ?? null,
		markdown: markdownAfter(state, code),
		saved: code
	};
}

export function saveStatus(result: SaveResult): string {
	return result.method === 'download'
		? t('app.file.savedDownload', { name: result.name })
		: t('app.file.saved', { name: result.name });
}
