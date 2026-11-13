/**
 * Typ-Erkennung (T13): erste Anweisung nach Frontmatter, Direktiven, Kommentaren und
 * Leerzeilen wählt den Adapter; unbekannte Typen ergeben den Modus "nur Code".
 */
import type { AdapterType } from './registry';

export type SyncMode = AdapterType | 'code';

export function detectType(text: string): SyncMode {
	const lines = text.split(/\r?\n|\r/);
	let i = 0;
	if (lines[0]?.trim() === '---') {
		const close = lines.findIndex((line, k) => k > 0 && line.trim() === '---');
		if (close < 0) return 'code';
		i = close + 1;
	}
	for (; i < lines.length; i++) {
		const line = lines[i].trim();
		if (line === '' || line.startsWith('%%')) continue;
		if (/^(?:flowchart|graph)(?:\s|;|$)/.test(line)) return 'flowchart';
		if (/^sequenceDiagram(?:\s|;|$)/.test(line)) return 'sequence';
		return 'code';
	}
	return 'code';
}
