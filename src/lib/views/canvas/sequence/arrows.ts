/**
 * Pfeil-Token der Sequenz-Nachrichten (SUBSET.md) mit Linienstil und Spitze. Eigene Tabelle der
 * View-Schicht, deckungsgleich mit der Syntax des Adapters (Test über Parse aller Token).
 */
import { t } from '../../shell/i18n.svelte';
import { SEQ_ARROW_OPTIONS } from '../../panels/properties';

export interface ArrowStyle {
	lineStyle: string;
	arrowHead: string;
}

const TABLE: Record<string, ArrowStyle> = {};
const put = (token: string, lineStyle: string, arrowHead: string) =>
	(TABLE[token] = { lineStyle, arrowHead });

for (const [token, head] of [
	['->', 'none'],
	['->>', 'arrow'],
	['-x', 'cross'],
	['-)', 'open']
] as const) {
	put(token, 'solid', head);
	put(`-${token}`, 'dotted', head);
}
put('<<->>', 'solid', 'both');
put('<<-->>', 'dotted', 'both');
for (const token of ['-|\\', '-|/', '-\\\\', '-//', '/|-', '\\|-', '//-', '\\\\-']) {
	put(token, 'solid', 'half');
	put(token.startsWith('-') ? `-${token}` : `${token}-`, 'dotted', 'half');
}

export const ARROW_TOKENS: readonly string[] = Object.keys(TABLE);

export function arrowStyle(token: string): ArrowStyle {
	const style = TABLE[token];
	if (!style) throw new Error(t('canvas.err.unknownArrow', { token }));
	return { ...style };
}

/** Lokalisierte Bezeichnung mit Token in Klammern; steht `(token` schon im Text, bleibt er (V-16). */
export function withToken(label: string, token: string): string {
	return label.includes(`(${token}`) ? label : `${label} (${token})`;
}

/**
 * Anzeigetext eines Pfeil-Tokens, Bezeichnung aus dem Eigenschaften-Panel. Halbpfeile setzen das
 * eigene Token in den Panel-Schlüssel (die Panel-Option trägt bei gestrichelten das durchgezogene).
 */
export function arrowLabel(token: string): string {
	const style = TABLE[token];
	if (style?.arrowHead === 'half') {
		const key =
			style.lineStyle === 'dotted' ? 'panels.seqArrow.halfDotted' : 'panels.seqArrow.half';
		return t(key, { token: `(${token})` });
	}
	const label = SEQ_ARROW_OPTIONS.find((o) => o.value === token)?.label;
	return label ? withToken(label, token) : token;
}
