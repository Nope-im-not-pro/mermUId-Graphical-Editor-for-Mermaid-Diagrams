/**
 * Stil-Auflösung für Knoten und Kanten (V-06, Naht T106 -> T137). Rein, ohne DOM.
 *
 * Werte sind Nutzereingabe: Nur die Allow-Liste kommt durch (Farben hex oder `rgb()`/`rgba()`
 * mit Zahlen, Stärke als Zahl mit optionalem `px`, geklemmt auf 0.5..20, Strichmuster als
 * Ziffernfolge). Alles andere, insbesondere `url(`, `expression` und Anführungszeichen, wird
 * verworfen.
 */
import type { ClassDef, StyleMap } from '../../model/types';

export interface ResolvedStyle {
	fill?: string;
	stroke?: string;
	/** Textfarbe (`color`). */
	color?: string;
	strokeWidth?: number;
	/** Normalisiert, Ziffern durch je ein Leerzeichen getrennt. */
	strokeDasharray?: string;
}

/** Zahl ohne `%` bzw. mit `%` (Kommaform: Farbkomponenten einheitlich, wie CSS). */
const PLAIN = String.raw`(?:\d+(?:\.\d+)?|\.\d+)`;
const PCT = `${PLAIN}%`;
/** Zahl mit optionalem `%` (eine Komponente von `rgb()`/`rgba()`). */
const NUM = `${PLAIN}%?`;
/**
 * Hex mit 3, 4, 6 oder 8 Stellen; `rgb()`/`rgba()` mit 3 oder 4 Komponenten durch Komma getrennt
 * (die drei Farbkomponenten alle Zahl oder alle Prozent) oder mit 3 Komponenten durch Leerzeichen
 * getrennt und optional `/ alpha`. Nur das ASCII-Leerzeichen ist als Trenner zulässig (kein
 * Zeilenumbruch, kein U+2028).
 */
const COLOR = new RegExp(
	'^(?:#[0-9a-f]{3,4}|#[0-9a-f]{6}|#[0-9a-f]{8}' +
		`|rgba?\\( *(?:${PLAIN} *, *${PLAIN} *, *${PLAIN}|${PCT} *, *${PCT} *, *${PCT}) *(?:, *${NUM} *)?\\)` +
		`|rgba?\\( *${NUM} +${NUM} +${NUM} *(?:/ *${NUM} *)?\\))$`,
	'i'
);
const WIDTH = /^(\d+(?:\.\d+)?)(?:px)?$/;
const MIN_WIDTH = 0.5;
const MAX_WIDTH = 20;
const DASH = /^\d+(?:\.\d+)?(?:[\s,]+\d+(?:\.\d+)?)*$/;

/** Farbwert der Allow-Liste (hex, `rgb()`/`rgba()`). */
export function isSafeColor(value: string): boolean {
	return COLOR.test(value);
}

/** Nur zulässige Eigenschaften und Werte einer StyleMap. */
export function safeStyle(style: StyleMap): ResolvedStyle {
	const out: ResolvedStyle = {};
	for (const key of ['fill', 'stroke', 'color'] as const) {
		const v = style[key]?.trim();
		if (v && isSafeColor(v)) out[key] = v;
	}
	const width = WIDTH.exec(style['stroke-width']?.trim() ?? '');
	if (width) out.strokeWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, Number(width[1])));
	const dash = style['stroke-dasharray']?.trim() ?? '';
	if (DASH.test(dash)) out.strokeDasharray = dash.split(/[\s,]+/).join(' ');
	return out;
}

/**
 * Wirksamer Stil: `classDef default` < Klassen in Reihenfolge (spätere gewinnt) < eigener
 * `style` (Kanten: `linkStyle`). Jede Ebene wird vor dem Zusammenführen über die Allow-Liste
 * geprüft, ein verworfener Wert verdeckt also keinen zulässigen Wert einer tieferen Ebene.
 * `withDefault: false` für Container: Mermaid wendet `classDef default` nicht auf Subgraphen an.
 */
export function resolveStyle(
	own: StyleMap,
	classes: readonly string[] = [],
	classDefs: readonly ClassDef[] = [],
	{ withDefault = true }: { withDefault?: boolean } = {}
): ResolvedStyle {
	const byName = new Map(classDefs.map((d) => [d.name, d.style]));
	const base = withDefault ? byName.get('default') : undefined;
	const layers = [base, ...classes.map((c) => byName.get(c)), own];
	return Object.assign({}, ...layers.map((s) => (s ? safeStyle(s) : {})));
}

/** Kanäle 0..1 einer Farbe der Allow-Liste, dazu Alpha 0..1 (fehlt -> 1). */
function channels(color: string): [number, number, number, number] | null {
	const v = color.trim();
	if (!isSafeColor(v)) return null;
	if (v.startsWith('#')) {
		const hex = v.slice(1);
		const short = hex.length <= 4;
		const at = (i: number) =>
			parseInt(short ? hex[i] + hex[i] : hex.slice(i * 2, i * 2 + 2), 16) / 255;
		const alpha = hex.length === 4 || hex.length === 8 ? at(3) : 1;
		return [at(0), at(1), at(2), alpha];
	}
	const parts = v
		.slice(v.indexOf('(') + 1, -1)
		.split(/[ ,/]+/)
		.filter(Boolean);
	const part = (p: string, max: number) =>
		Math.min(1, p.endsWith('%') ? parseFloat(p) / 100 : parseFloat(p) / max);
	const alpha = parts[3] === undefined ? 1 : part(parts[3], 1);
	return [part(parts[0], 255), part(parts[1], 255), part(parts[2], 255), alpha];
}

/** Relative Leuchtdichte nach WCAG 2. */
function luminance([r, g, b]: [number, number, number, number]): number {
	const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
	return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export const DARK_TEXT = '#000000';
export const LIGHT_TEXT = '#ffffff';

/**
 * Lesbare Textfarbe auf `fill`: Schwarz oder Weiß, je nachdem welche den höheren Kontrast
 * (WCAG) ergibt. Unbekanntes Format oder Alpha < 0.5 (Fläche überwiegend durchsichtig, das
 * Theme bestimmt den Untergrund) -> `undefined`.
 */
export function contrastText(fill: string): string | undefined {
	const c = channels(fill);
	if (!c || c[3] < 0.5) return undefined;
	// Kontrast zu Schwarz (L + 0.05) / 0.05 gegen zu Weiß 1.05 / (L + 0.05): Gleichstand bei ~0.179.
	return luminance(c) > 0.179 ? DARK_TEXT : LIGHT_TEXT;
}

/** Textfarbe eines Stils: eigene `color`, sonst aus `fill` abgeleitet, sonst `undefined` (Theme). */
export function textColor(style: ResolvedStyle): string | undefined {
	return style.color ?? (style.fill ? contrastText(style.fill) : undefined);
}
