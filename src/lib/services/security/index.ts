// Security-Service (KONZEPT §10). DOM-Zugriff erlaubt (D-16 a / O-09), kein Svelte-Import,
// kein Mermaid-Import.
import DOMPurify from 'dompurify';

/** `secure`-Liste aus mermaid 12.2.0 (z_INFOS/VERIFIKATION_VERSIONEN.md §3). */
export const MERMAID_SECURE_KEYS: readonly string[] = [
	'secure',
	'securityLevel',
	'startOnLoad',
	'maxTextSize',
	'suppressErrorRendering',
	'maxEdges'
];

/**
 * Zusätzlich gesperrt: mermaid `sanitize` entfernt aus Direktive und Frontmatter nur
 * `secure`-Schlüssel; `htmlLabels: true` erzeugt `foreignObject`, `themeCSS`, `fontFamily` und
 * `altFontFamily` landen ungeprüft im `<style>` des SVG (externe `url(...)`).
 */
const APP_SECURE_KEYS = ['layout', 'htmlLabels', 'themeCSS', 'fontFamily', 'altFontFamily'];

type Check = (value: unknown) => boolean;

const isBoolean: Check = (value) => typeof value === 'boolean';
const oneOf =
	(values: readonly string[]): Check =>
	(value) =>
		typeof value === 'string' && values.includes(value);
/** Endliche Zahl im Bereich [min, max]; schließt NaN und Infinity aus. */
const inRange =
	(min: number, max: number): Check =>
	(value) =>
		typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;

/** Theme-Allow-Liste (T06-Stand; neo/redux bewusst nicht, Fallback default: O-13, O-167, F-09). */
export const MERMAID_THEMES: readonly string[] = ['default', 'neutral', 'dark', 'forest', 'base'];
const THEMES = MERMAID_THEMES;
/** Enums laut mermaid 12.2.0 `config.type.d.ts`. */
const CURVES = [
	'basis',
	'bumpX',
	'bumpY',
	'cardinal',
	'catmullRom',
	'linear',
	'monotoneX',
	'monotoneY',
	'natural',
	'step',
	'stepAfter',
	'stepBefore',
	'rounded'
];
const MESSAGE_ALIGNS = ['left', 'center', 'right'];
const FLOWCHART_KEYS: Record<string, Check> = {
	curve: oneOf(CURVES),
	nodeSpacing: inRange(0, 1000),
	rankSpacing: inRange(0, 1000),
	padding: inRange(0, 200)
};
const SEQUENCE_KEYS: Record<string, Check> = {
	mirrorActors: isBoolean,
	showSequenceNumbers: isBoolean,
	wrap: isBoolean,
	actorMargin: inRange(0, 1000),
	messageAlign: oneOf(MESSAGE_ALIGNS)
};

/** App-Allow-Liste für Nutzer-Konfiguration (`%%{init}%%`, Frontmatter). */
export const APP_CONFIG_ALLOW_LIST: readonly string[] = ['theme', 'flowchart', 'sequence'];

const MAX_SANITIZE_ROUNDS = 5;

function toText(input: string): string {
	const fragment = DOMPurify.sanitize(input, {
		ALLOWED_TAGS: [],
		ALLOWED_ATTR: [],
		KEEP_CONTENT: true,
		RETURN_DOM_FRAGMENT: true
	});
	return fragment.textContent ?? '';
}

/**
 * Liefert reinen Text ohne Tags und Attribute. Entities werden decodiert; ergibt das neues
 * Markup (Entity-Umgehung), wird erneut bereinigt, bis das Ergebnis stabil ist. Wird es nach
 * `MAX_SANITIZE_ROUNDS` nicht stabil (tief verschachtelte Kodierung), liefert die Funktion `''`.
 *
 * Achtung: Das Mehrfach-Decodieren verändert literale Entities (`a &amp;lt; b` wird `a < b`).
 * Nur an der Anzeige-Grenze nutzen, nie auf Modell-Labels oder `sourceText` anwenden, sonst
 * bricht der Round-Trip.
 */
export function sanitizeLabel(text: string): string {
	let current = toText(text);
	for (let i = 0; i < MAX_SANITIZE_ROUNDS; i++) {
		const next = toText(current);
		if (next === current) return current;
		current = next;
	}
	return '';
}

function decodeEntities(value: string): string {
	const textarea = document.createElement('textarea');
	textarea.innerHTML = value;
	return textarea.value;
}

function isHttpUrl(value: string): boolean {
	try {
		const { protocol } = new URL(value);
		return protocol === 'http:' || protocol === 'https:';
	} catch {
		return false;
	}
}

/** Nur absolute `http`/`https`-URLs; roh und nach Entity-Decodierung geprüft. */
export function isAllowedLinkScheme(url: string): boolean {
	if (typeof url !== 'string') return false;
	return isHttpUrl(url) && isHttpUrl(decodeEntities(url));
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(source: unknown, keys: Record<string, Check>): Record<string, unknown> {
	const out: Record<string, unknown> = {};
	if (!isPlainObject(source)) return out;
	for (const [key, check] of Object.entries(keys)) {
		if (Object.hasOwn(source, key) && check(source[key])) out[key] = source[key];
	}
	return out;
}

/**
 * Filtert Nutzer-Konfiguration auf die App-Allow-Liste und erzwingt Sicherheitswerte.
 * `layout` ist fest `dagre` und steht in `secure`, damit Frontmatter und `%%{init}%%` ELK
 * nicht aktivieren können (N-01).
 * Rein funktional: Eingabe bleibt unverändert, nur eigene Schlüssel aus festen Listen werden
 * gelesen (kein `__proto__`/`constructor`).
 */
export function filterMermaidConfig(init: unknown): Record<string, unknown> {
	const source = isPlainObject(init) ? init : {};
	const out: Record<string, unknown> = {};
	if (Object.hasOwn(source, 'theme') && oneOf(THEMES)(source.theme)) {
		out.theme = source.theme;
	}
	out.flowchart = { ...pick(source.flowchart, FLOWCHART_KEYS), htmlLabels: false };
	out.sequence = pick(source.sequence, SEQUENCE_KEYS);
	out.securityLevel = 'strict';
	out.startOnLoad = false;
	out.htmlLabels = false;
	out.maxEdges = 1000;
	out.maxTextSize = 200000;
	out.layout = 'dagre';
	out.secure = [...new Set([...MERMAID_SECURE_KEYS, ...APP_SECURE_KEYS])];
	return out;
}

/**
 * Ob `theme` für diesen Render gesperrt wird (F-09, O-167, O-174). Eingabe ist das Ergebnis von
 * `mermaid.parse(code, { suppressErrors: true })`: dessen `config` ist Frontmatter plus
 * Direktiven, wie mermaid sie anwendet. Kein Theme oder ein Allow-Listen-Wert: `false`, mermaid
 * wendet ihn selbst an (samt `themeVariables`). Jeder andere Wert oder ein unklares Ergebnis
 * (`false`, kein Objekt): `true` (fail-closed).
 */
export function blocksTheme(parsed: unknown): boolean {
	if (!isPlainObject(parsed) || !isPlainObject(parsed.config)) return true;
	const { config } = parsed;
	return Object.hasOwn(config, 'theme') && !oneOf(THEMES)(config.theme);
}
