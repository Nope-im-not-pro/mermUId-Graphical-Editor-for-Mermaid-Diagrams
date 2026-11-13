/**
 * Export-Dialog-Logik (T21 C3, KONZEPT §9, D-04): Optionen, Startwerte nach `defaultSource`,
 * Geometrie für das Editor-SVG, Dateinamen, Copy-as-Markdown mit gespeicherten ID-Zählern.
 * T123 C2: Export-Ablauf (Dialog offen/zu, Ausführung, Meldungen) in `createExporter`.
 * T127 C1 (V-22): Format/Quelle/Maßstab in localStorage, SVG-Titel aus doc.title/Dateinamen.
 * T127 C2 (F-08): SVG/PNG in die Zwischenablage, PNG-Hintergrund (Theme oder freier Wert), Rand.
 * Das Erzeugen selbst läuft über services/export.
 */
import { writable, type Readable } from 'svelte/store';
import { initCounters } from '../../model/ids';
import type { DiagramDocument, Position } from '../../model/types';
import {
	canCopy,
	copyAsMarkdown,
	copyBlob,
	defaultSource,
	exportPng,
	exportSvg,
	isBackgroundColor,
	isMargin,
	marginOf,
	pngBackground,
	type Palette,
	type PngScale,
	type Rasterizer,
	type SvgSource
} from '../../services/export';
import { readMeta, splitMeta } from '../../services/meta';
import type { RenderResult } from '../../services/render';
import type { Rect } from '../canvas/common/grid';
import { textMeasure, toSequence } from '../canvas/sequence/mapping';
import { browserStorage, type StorageAccess } from './confirm';
import { t } from './i18n.svelte';
import { errorPart, fail, known, type MessagePart, type StatusMessage } from './status';

export type ExportFormat = 'svg' | 'png' | 'markdown';
export type EditMode = 'flowchart' | 'sequence' | 'code';

export interface ExportOptions {
	source: SvgSource;
	format: ExportFormat;
	scale: PngScale;
	/** PNG mit Hintergrund statt transparent. */
	background: boolean;
	/** Freier Hintergrundwert (Allow-Liste); fehlend, leer oder ungültig -> Theme-Farbe. */
	color?: string;
	/** PNG-Rand in px (Ganzzahl 0..512); fehlend oder ungültig -> `DEFAULT_MARGIN`. */
	margin?: number;
	/** In die Zwischenablage statt Download (nur SVG/PNG); wird nicht gemerkt. */
	copy?: boolean;
	/** Copy-as-Markdown: Schalter "Layout einbetten". */
	embed: boolean;
	/** Editor-SVG in den Farben des aktiven Themes (mit Hintergrund). */
	theme: boolean;
	/** Editor-SVG nur mit den ausgewählten Elementen (Graph). */
	selection: boolean;
	/** Schalter "Layout einbetten" angeboten; `false` bei sequence (keine Positionen). */
	embedLayout?: boolean;
}

export const EXPORT_KEY = 'mermuid.export';

type ExportChoice = Partial<
	Pick<ExportOptions, 'format' | 'source' | 'scale' | 'background' | 'color' | 'margin'>
>;

const FORMATS: readonly unknown[] = ['svg', 'png', 'markdown'];
const SOURCES: readonly unknown[] = ['editor', 'mermaid'];
const SCALES: readonly unknown[] = [1, 2, 3];

/** Letzte Wahl aus dem Storage; ungültige Werte und Lesefehler werden verworfen. */
export function loadExportChoice(storage: StorageAccess = browserStorage): ExportChoice {
	try {
		const raw: unknown = JSON.parse(storage()?.getItem(EXPORT_KEY) ?? 'null');
		if (typeof raw !== 'object' || raw === null) return {};
		const { format, source, scale, background, color, margin } = raw as Record<string, unknown>;
		return {
			...(FORMATS.includes(format) && { format: format as ExportFormat }),
			...(SOURCES.includes(source) && { source: source as SvgSource }),
			...(SCALES.includes(scale) && { scale: scale as PngScale }),
			...(typeof background === 'boolean' && { background }),
			...(typeof color === 'string' && isBackgroundColor(color) && { color }),
			...(isMargin(margin) && { margin })
		};
	} catch {
		return {};
	}
}

/**
 * Merkt Format/Quelle/Maßstab, Hintergrund, Farbe (nur zulässig, sonst leer) und Rand; ohne
 * Storage still ohne Wirkung. Ohne Editor-SVG (Code-Modus)
 * ist die Quelle erzwungen und die gespeicherte bleibt erhalten (O-140).
 */
export function saveExportChoice(
	{ format, source, scale, background, color, margin }: ExportOptions,
	storage: StorageAccess = browserStorage,
	mode: EditMode = 'flowchart'
): void {
	try {
		const kept = editorAvailable(mode) ? source : loadExportChoice(storage).source;
		const choice = {
			format,
			source: kept,
			scale,
			background,
			color: pngBackground(color) ?? '',
			margin: marginOf(margin)
		};
		storage()?.setItem(EXPORT_KEY, JSON.stringify(choice));
	} catch {
		// Storage gesperrt oder voll: Wahl gilt nur bis zum Neuladen.
	}
}

/** Rückfall, wenn weder freier Wert noch Theme-Farbe zulässig sind. */
export const BACKGROUND = '#ffffff';

/** Editor-SVG bei Graph-Canvas (Geometrie) und Sequenz-Canvas (Szene), nicht im Code-Modus. */
export function editorAvailable(mode: EditMode): boolean {
	return mode === 'flowchart' || mode === 'sequence';
}

/** Auswahl-Export nur im Graph-Canvas. */
export function selectionAvailable(mode: EditMode, selected: number): boolean {
	return mode === 'flowchart' && selected > 0;
}

/** Palette-Feld -> CSS-Variable der Shell (theme.css). */
const THEME_VARS: Record<keyof Palette, string> = {
	nodeFill: '--node',
	nodeStroke: '--node-line',
	containerFill: '--container-fill',
	containerStroke: '--node-line',
	line: '--text-3',
	text: '--text',
	labelBackground: '--surface-2',
	noteFill: '--note-fill',
	background: '--bg'
};

/** Farben des aktiven Themes aus den berechneten CSS-Variablen; Prüfung in `safePalette`. */
export function themePalette(
	style: Pick<CSSStyleDeclaration, 'getPropertyValue'>
): Partial<Palette> {
	return Object.fromEntries(
		Object.entries(THEME_VARS).map(([key, name]) => [key, style.getPropertyValue(name).trim()])
	);
}

export function initialExport(
	doc: DiagramDocument,
	mode: EditMode,
	storage: StorageAccess = browserStorage
): ExportOptions {
	const stored = loadExportChoice(storage);
	const editor = editorAvailable(mode);
	const source = editor ? (stored.source ?? defaultSource(doc)) : 'mermaid';
	return {
		source,
		format: stored.format ?? 'svg',
		scale: stored.scale ?? 1,
		background: stored.background ?? false,
		...(stored.color && { color: stored.color }),
		...(stored.margin !== undefined && { margin: stored.margin }),
		embed: true,
		theme: false,
		selection: false,
		...(doc.diagramType === 'sequence' && { embedLayout: false })
	};
}

export function toGeometry(rects: Readonly<Record<string, Rect>>): Record<string, Position> {
	return Object.fromEntries(
		Object.entries(rects).map(([id, r]) => [id, [r.x, r.y, r.w, r.h] as Position])
	);
}

export function exportName(fileName: string, ext: string): string {
	const base = fileName.replace(/\.[^.]*$/, '') || t('app.export.fileBase');
	return `${base}.${ext}`;
}

/** SVG-Titel (O-140): `doc.title`, sonst Dateiname ohne Endung, sonst Standardtitel der Sprache. */
export function exportTitle(fileName: string, title = ''): string {
	return title || fileName.replace(/\.[^.]*$/, '') || t('app.export.untitled');
}

export function markdownFor(code: string, doc: DiagramDocument, embed: boolean) {
	const stored = readMeta(splitMeta(code).metaLine).loaded?.storedIds ?? {};
	return copyAsMarkdown({ code, doc, counters: initCounters(doc, stored), embed });
}

export interface DownloadEnv {
	document: Document;
	createObjectURL: (blob: Blob) => string;
	revokeObjectURL: (url: string) => void;
}

/** Bietet einen Blob als Download an (eigene Origin, kein Netz-Request). */
export function downloadBlob(blob: Blob, name: string, env: DownloadEnv): void {
	const url = env.createObjectURL(blob);
	const a = env.document.createElement('a');
	a.href = url;
	a.download = name;
	env.document.body.append(a);
	a.click();
	a.remove();
	setTimeout(() => env.revokeObjectURL(url), 0);
}

/** Abhängigkeiten des Export-Ablaufs; alle Werte werden erst beim Export gelesen. */
export interface ExportDeps {
	doc: () => DiagramDocument;
	code: () => string;
	mode: () => EditMode;
	fileName: () => string;
	env: () => DownloadEnv;
	/** Graph-Canvas (Geometrie, Auswahl), sonst `null`. */
	canvas: () => { geometry(): Readonly<Record<string, Rect>>; selection(): string[] } | null;
	/** Farben des aktiven Themes; nur bei Option `theme` gelesen. */
	palette: () => Partial<Palette> | undefined;
	render: (code: string) => Promise<RenderResult>;
	measure: () => (text: string) => number;
	rasterize: () => Rasterizer;
	say: (message: StatusMessage) => void;
	/** Ablage der letzten Wahl; Standard `localStorage`. */
	storage?: StorageAccess;
}

export interface Exporter {
	/** Export-Dialog offen. */
	readonly open: Readable<boolean>;
	show(): void;
	cancel(): void;
	/**
	 * Schließt den Dialog, erzeugt SVG/PNG (Download, mit `copy` Zwischenablage) bzw. Markdown
	 * (Zwischenablage).
	 */
	run(options: ExportOptions): Promise<void>;
}

/** Abbruch mit fertiger Meldung des Dienstes (SVG/PNG gescheitert). */
class ExportFailed extends Error {
	constructor(readonly status: StatusMessage) {
		super(status.key);
	}
}

const COPY_LABELS: Record<'svg' | 'png', MessagePart> = {
	svg: { key: 'app.export.copySvg' },
	png: { key: 'app.export.copyPng' }
};

export function createExporter(deps: ExportDeps): Exporter {
	const open = writable(false);
	const { say } = deps;

	function report(err: unknown, label: MessagePart) {
		if (err instanceof ExportFailed) return say(err.status);
		say(fail({ key: 'app.shell.failed', params: { label, reason: errorPart(err) } }));
	}

	/** SVG- bzw. PNG-Blob; Fehler des Dienstes als `ExportFailed`. */
	async function image(
		options: ExportOptions,
		format: 'svg' | 'png',
		doc: DiagramDocument,
		code: string
	): Promise<Blob> {
		const canvas = deps.canvas();
		const svg = await exportSvg({
			doc,
			code,
			geometry: toGeometry(canvas?.geometry() ?? {}),
			// Szene wie im Sequenz-Canvas (gleiche Textmetrik), damit das SVG dem Canvas entspricht.
			sequence: deps.mode() === 'sequence' ? toSequence(doc, [], textMeasure) : undefined,
			source: options.source,
			title: exportTitle(deps.fileName(), doc.title),
			render: deps.render,
			measure: deps.measure(),
			palette: options.theme ? deps.palette() : undefined,
			only: options.selection ? new Set(canvas?.selection() ?? []) : undefined
		});
		if (!svg.ok) throw new ExportFailed(fail(known(svg.error.message)));
		if (format === 'svg') return new Blob([svg.svg], { type: 'image/svg+xml' });
		const png = await exportPng(svg.svg, deps.rasterize(), {
			scale: options.scale,
			// Freier Wert, sonst Theme-Farbe (`--bg`), sonst Weiß; alle über die Allow-Liste.
			background: options.background
				? pngBackground(options.color, deps.palette()?.background, BACKGROUND)
				: null,
			margin: options.margin
		});
		if (!png.ok) throw new ExportFailed(fail(known(png.error.message)));
		return png.blob;
	}

	/**
	 * Zwischenablage: `write` startet sofort (noch in der Nutzergeste), das Bild folgt als
	 * Promise. Scheitert schon der Export, gilt dessen Meldung statt des Clipboard-Fehlers.
	 */
	async function copy(options: ExportOptions, format: 'svg' | 'png', doc: DiagramDocument) {
		const label = COPY_LABELS[format];
		if (!canCopy(format)) {
			say(
				fail({
					key: 'app.shell.failed',
					params: { label, reason: { key: 'app.export.copyUnsupported' } }
				})
			);
			return;
		}
		const blob = image(options, format, doc, deps.code());
		try {
			await copyBlob(format, blob);
			say({ key: 'app.export.copied', params: { format: format.toUpperCase() }, tone: 'success' });
		} catch (err) {
			report(
				await blob.then(
					() => err,
					(cause: unknown) => cause
				),
				label
			);
		}
	}

	async function run(options: ExportOptions) {
		open.set(false);
		saveExportChoice(options, deps.storage, deps.mode());
		const doc = deps.doc();
		const { format } = options;
		if (options.copy && format !== 'markdown') return copy(options, format, doc);
		const code = deps.code();
		const env = deps.env();
		try {
			if (format === 'markdown') {
				const { markdown, warnings } = markdownFor(code, doc, options.embed);
				await navigator.clipboard.writeText(markdown);
				const more = warnings.map((w) => known(w));
				say({ key: 'app.shell.copied', tone: more.length > 0 ? 'info' : 'success', more });
				return;
			}
			const blob = await image(options, format, doc, code);
			const name = exportName(deps.fileName(), format);
			downloadBlob(blob, name, env);
			say({ key: 'app.shell.exported', params: { name }, tone: 'success' });
		} catch (err) {
			report(err, { key: 'app.export.title' });
		}
	}

	return {
		open: { subscribe: open.subscribe },
		show: () => open.set(true),
		cancel: () => open.set(false),
		run
	};
}
