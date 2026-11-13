/**
 * Copy-as-Markdown (T20 C2, KONZEPT §6.3): aktueller Code als ```mermaid-Block, Metadaten-Zeile
 * nach Schalter "Layout einbetten" über services/meta, Fence über services/file. Rein, kein
 * DOM; das Schreiben in die Zwischenablage ist Sache der View.
 */
import type { IdCounters } from '../../model/ids';
import type { DiagramDocument } from '../../model/types';
import { replaceMermaidBlock } from '../file/markdown';
import { joinMeta, readMeta, splitMeta, writeMeta } from '../meta';

export interface CopyMarkdownInput {
	code: string;
	doc: DiagramDocument;
	counters: IdCounters;
	/** Schalter "Layout einbetten". */
	embed: boolean;
}

export function copyAsMarkdown({ code, doc, counters, embed }: CopyMarkdownInput): {
	markdown: string;
	warnings: string[];
} {
	const split = splitMeta(code);
	const read = readMeta(split.metaLine);
	const written = writeMeta({ loaded: read.loaded, doc, counters, embed });
	const text = joinMeta({ ...split, metaLine: written.metaLine });
	const markdown = replaceMermaidBlock('```mermaid\n```\n', 0, text.replace(/(?:\r?\n)+$/, ''));
	return { markdown, warnings: [...read.warnings, ...written.warnings] };
}
