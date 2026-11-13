/**
 * SVG-Export mit Quellwahl (T20 C1, KONZEPT §6.3, FA-09). Editor-SVG über `editorSvg`,
 * Mermaid-SVG nur über `renderSvg` (T16, O-28). Die Metadaten-Zeile wird vor dem Rendern
 * abgetrennt; Bildexporte enthalten nie Metadaten (§6.2). Kein DOM in dieser Datei.
 */
import { msg } from '../i18n';
import type { DiagramDocument } from '../../model/types';
import { splitMeta } from '../meta';
import { renderSvg, type RenderResult } from '../render';
import { sequenceSvg, type SequenceScene } from './sequence';
import { DEFAULT_TITLE, editorSvg, escapeXml, type EditorSvgOptions, type Geometry } from './svg';

export type SvgSource = 'editor' | 'mermaid';

export type SvgExportResult =
	{ ok: true; svg: string; source: SvgSource } | { ok: false; error: { message: string } };

export interface SvgExportInput extends EditorSvgOptions {
	doc: DiagramDocument;
	/** Aktueller Mermaid-Code, ggf. mit Metadaten-Zeile. */
	code: string;
	geometry: Geometry;
	/** Quelle aus dem Export-Dialog; ohne Angabe `defaultSource(doc)`. */
	source?: SvgSource;
	/** Sequenz-Canvas-Szene; ohne sie kein Editor-SVG für `sequence`. */
	sequence?: SequenceScene;
	/** Injizierbar für Tests; Standard `renderSvg`. */
	render?: (code: string) => Promise<RenderResult>;
}

/** Default-Quelle: manuelles Layout -> Editor-SVG; Auto-Layout und sequence -> Mermaid-SVG. */
export function defaultSource(doc: DiagramDocument): SvgSource {
	return doc.diagramType !== 'sequence' && doc.layout.mode === 'manual' ? 'editor' : 'mermaid';
}

/** Index nach dem Start-Tag `<svg ...>`; Anführungszeichen im Tag werden beachtet. -1 ohne Tag. */
export function openTagEnd(svg: string): number {
	const start = svg.indexOf('<svg');
	if (start === -1) return -1;
	let quote = '';
	for (let i = start + 4; i < svg.length; i++) {
		const c = svg[i];
		if (quote) {
			if (c === quote) quote = '';
		} else if (c === '"' || c === "'") {
			quote = c;
		} else if (c === '>') {
			return i + 1;
		}
	}
	return -1;
}

/** Setzt `<title>` als erstes Kind, sofern dort noch keines steht. */
export function withTitle(svg: string, title: string): string {
	const end = openTagEnd(svg);
	if (end === -1 || /^\s*<title[\s>]/.test(svg.slice(end, end + 64))) return svg;
	return `${svg.slice(0, end)}<title>${escapeXml(title)}</title>${svg.slice(end)}`;
}

/** Attribut im Start-Tag; Werte in Anführungszeichen werden als Ganzes übersprungen. */
const ATTRIBUTE = /([^\s=/>"']+)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>"']+))?/g;

/**
 * Setzt `width`/`height` des Wurzel-`<svg>` aus der viewBox (V-22): Mermaid liefert
 * `width="100%"` ohne Höhe, manche Programme bemessen das falsch. Vorhandene Attribute
 * werden an ihrer Stelle ersetzt, fehlende angehängt; der übrige Tag-Text bleibt unverändert.
 * Ohne gültige viewBox (vier Zahlen, Breite und Höhe > 0) bleibt das SVG unverändert.
 */
export function withSize(svg: string): string {
	const end = openTagEnd(svg);
	if (end === -1) return svg;
	const start = svg.indexOf('<svg') + 4;
	const tag = svg.slice(start, end - 1);
	const attrs = [...tag.matchAll(ATTRIBUTE)];
	const viewBox = attrs.find((a) => a[1] === 'viewBox')?.[2]?.slice(1, -1);
	const box =
		viewBox
			?.trim()
			.split(/[\s,]+/)
			.map(Number) ?? [];
	const [, , w, h] = box;
	if (box.length !== 4 || !box.every(Number.isFinite) || !(w > 0) || !(h > 0)) return svg;
	const size: Record<string, number> = { width: w, height: h };
	let out = tag;
	for (const a of attrs.filter((a) => Object.hasOwn(size, a[1])).reverse()) {
		const at = a.index!;
		out = `${out.slice(0, at)}${a[1]}="${size[a[1]]}"${out.slice(at + a[0].length)}`;
	}
	const close = out.endsWith('/') ? '/' : '';
	const missing = Object.keys(size)
		.filter((name) => !attrs.some((a) => a[1] === name))
		.map((name) => ` ${name}="${size[name]}"`)
		.join('');
	return `${svg.slice(0, start)}${close ? out.slice(0, -1) : out}${missing}${close}>${svg.slice(end)}`;
}

const FOREIGN_OBJECT = /<foreignObject[\s>/]/i;
/**
 * Metadaten-Marke aus Nutzertext als Entity: der Quelltext des Export-SVG enthält kein
 * `@mermuid` (Sperre in `exportPng`), der Text bleibt sichtbar gleich. Keine Sicherheits-
 * maßnahme, da Parser Entities auflösen; externe Ressourcen weist `renderSvg` ab
 * (`hasExternalResource`).
 */
const META_MARK = /@(mermuid)/gi;

/** Exportiert das Diagramm als SVG aus der gewählten bzw. der Default-Quelle. */
export async function exportSvg(input: SvgExportInput): Promise<SvgExportResult> {
	const { doc, code, geometry } = input;
	const source = input.source ?? defaultSource(doc);
	const title = input.title || doc.title || DEFAULT_TITLE;
	if (source === 'editor') {
		if (doc.diagramType === 'sequence') {
			if (input.sequence) {
				return {
					ok: true,
					source,
					svg: sequenceSvg(input.sequence, { title, palette: input.palette })
				};
			}
			return {
				ok: false,
				error: { message: msg('services.export.editorSvgGraphOnly') }
			};
		}
		return { ok: true, source, svg: editorSvg(doc, geometry, { ...input, title }) };
	}
	const result = await (input.render ?? renderSvg)(splitMeta(code).body);
	if (!result.ok) return result;
	if (FOREIGN_OBJECT.test(result.svg)) {
		return { ok: false, error: { message: msg('services.export.foreignObject') } };
	}
	const svg = withTitle(withSize(result.svg), title).replace(META_MARK, '&#64;$1');
	return { ok: true, source, svg };
}
