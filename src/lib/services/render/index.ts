/**
 * Mermaid-Render-Service (T16). Einziger Aufrufer von `mermaid.initialize` und `mermaid.render`
 * (O-20). DOM-Zugriff nach Ausnahme D-16, kein Svelte-Import, kein View-Zustand.
 *
 * mermaid wird nur dynamisch über den Paket-Einstieg `mermaid` (= `dist/mermaid.core.mjs`,
 * N-01) geladen; die Diagramm-Module lädt mermaid danach selbst lazy pro Diagrammtyp [A9].
 */
import { msg } from '../i18n';
import type { MermaidConfig } from 'mermaid';
import { blocksTheme, filterMermaidConfig, isAllowedLinkScheme } from '../security';
import { originLine } from './lines';

export interface RenderError {
	message: string;
	line?: number;
	column?: number;
}

export type RenderResult = { ok: true; svg: string } | { ok: false; error: RenderError };

/** Präfix der Render-IDs; mermaid legt `d<id>` (bzw. `i<id>`) als Container in `body` an. */
export const RENDER_ID_PREFIX = 'mermuid-render-';

/**
 * Schlüssel, die zusätzlich zu `secure` aus `filterMermaidConfig` gesperrt werden. mermaid
 * entfernt `secure`-Schlüssel auf jeder Ebene von Direktive und Frontmatter-`config`; ohne
 * `htmlLabels` könnte Nutzer-Code `htmlLabels: true` setzen und `foreignObject` erzeugen.
 * `themeCSS`, `fontFamily` und `altFontFamily` landen ungeprüft im `<style>` des SVG (mermaid
 * `sanitize` entfernt nur `<`, `>` und `url(data:`), damit wären externe `url(...)` möglich.
 * `theme` bleibt offen: mermaid wendet ein Frontmatter-/Direktiven-Theme selbst an und berechnet
 * dabei `themeVariables` neu (O-167). Nur ein nicht erlaubter wirksamer Wert sperrt `theme` für
 * diesen Render (`mermaid.parse` + `blocksTheme`, O-174, Fallback default).
 */
const EXTRA_SECURE_KEYS = ['htmlLabels', 'themeCSS', 'fontFamily', 'altFontFamily'];

const FOREIGN_OBJECT = /<foreignObject[\s>/]/i;

const XLINK_NS = 'http://www.w3.org/1999/xlink';

/** Lokale Bildquelle: nur eingebettete `data:image/...`-URLs. */
const LOCAL_IMAGE = /^data:image\//i;
/** CSS-Funktionen bzw. At-Regeln, die ohne `url(` laden. */
const CSS_LOADER = /@import|(?:^|[^\w-])(?:-webkit-)?(?:image|image-set|src)\(/;

type Mermaid = (typeof import('mermaid'))['default'];

interface MermaidError {
	message?: unknown;
	hash?: { loc?: { first_line?: number; first_column?: number } };
}

/**
 * Site-Config für `mermaid.initialize`: Ausgabe von `filterMermaidConfig` (O-13), `secure` um
 * `EXTRA_SECURE_KEYS` ergänzt; `startOnLoad: false` verhindert `mermaid.run()` beim `load`-Event.
 */
export function renderConfig(): Record<string, unknown> {
	const config = filterMermaidConfig({});
	const secure = Array.isArray(config.secure) ? (config.secure as string[]) : [];
	return {
		...config,
		startOnLoad: false,
		secure: [...new Set([...secure, ...EXTRA_SECURE_KEYS])]
	};
}

let loading: Promise<Mermaid> | null = null;
/** Ob `theme` zuletzt per `initialize` gesperrt wurde (O-167). */
let themeLocked = false;
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

function loadMermaid(): Promise<Mermaid> {
	loading ??= import('mermaid')
		.then(({ default: mermaid }) => {
			mermaid.initialize(renderConfig() as MermaidConfig);
			themeLocked = false;
			return mermaid;
		})
		.catch((e: unknown) => {
			loading = null;
			throw e;
		});
	return loading;
}

/**
 * Sperrt oder öffnet `theme` per `initialize`, nur bei Wechsel (O-167). Gesperrt steht `theme` in
 * `secure`: mermaid verwirft dann Frontmatter- und Direktiven-Theme, Fallback default.
 */
function lockTheme(mermaid: Mermaid, locked: boolean): void {
	if (locked === themeLocked) return;
	const config = renderConfig();
	const secure = [...(config.secure as string[]), 'theme'];
	mermaid.initialize((locked ? { ...config, secure } : config) as MermaidConfig);
	themeLocked = locked;
}

/** Entfernt Render-Container (`d<id>`, `i<id>`) direkt unter `body`, nie eingefügte SVGs. */
function removeContainers(): void {
	const selector = [`d${RENDER_ID_PREFIX}`, `i${RENDER_ID_PREFIX}`]
		.map((prefix) => `:scope > [id^="${prefix}"]`)
		.join(', ');
	for (const el of document.body.querySelectorAll(selector)) el.remove();
}

/**
 * Löst CSS-Escapes (`\\75 rl(`) auf, damit Muster greifen. Kommentare werden bewusst nicht
 * entfernt (fail-closed, E1): ob `/*` einen Kommentar beginnt, hängt vom CSS-Tokenizer ab (nicht
 * in Escapes, Strings und unquotierten url-Token); jede Nachbildung zeigte Lücken, durch die ein
 * scheinbarer Kommentar ein echtes `url(` verdeckte. Ein echter Kommentar mit `url(` oder
 * `@import` wird daher abgewiesen; mermaid-Themes und `classDef`/`style` erzeugen keine solchen.
 */
function normalizeCss(css: string): string {
	return css
		.replace(/\\(?:([0-9a-f]{1,6})[ \t\n\r\f]?|\r\n|\n|(.))/gi, (_m, hex?: string, ch?: string) =>
			hex ? String.fromCodePoint(Math.min(parseInt(hex, 16), 0x10ffff) || 0xfffd) : (ch ?? '')
		)
		.toLowerCase();
}

/**
 * CSS darf nur auf Fragmente im selben Dokument verweisen (`url(#id)`). Ziele werden von Hand in
 * einem Durchlauf gelesen statt per Regex mit offener Zielklasse: diese prüfte bei `url(` ohne
 * Abschluss an jeder Fundstelle den ganzen Rest (quadratisch, E2). Hier endet jedes `url(` am
 * ersten `'`, `"` oder `)`; die Suche geht hinter diesem Ende weiter oder bricht ab, jedes Zeichen
 * wird also höchstens einmal gelesen. Ein `url(` ohne lesbares Ende oder ohne `#`-Ziel: false.
 * Vor `#` nur CSS-Whitespace (P3, E3): U+00A0 oder U+3000 machen das Ziel zur relativen URL. In
 * Quotes bleibt CSS-Whitespace erlaubt, der URL-Parser entfernt ihn (mermaid: `\20#x` -> `" #x"`).
 */
function isLocalCss(css: string, stylesheet: boolean): boolean {
	const normalized = normalizeCss(css);
	if (stylesheet && CSS_LOADER.test(normalized)) return false;
	const skipSpace = (j: number) => {
		while (j < normalized.length && ' \t\n\r\f'.includes(normalized[j])) j++;
		return j;
	};
	let i = normalized.indexOf('url(');
	while (i !== -1) {
		let j = skipSpace(i + 4);
		const quote = normalized[j] === '"' || normalized[j] === "'" ? normalized[j++] : '';
		if (quote) j = skipSpace(j);
		if (normalized[j] !== '#') return false;
		while (j < normalized.length && !`'")`.includes(normalized[j])) j++;
		if (quote) {
			if (normalized[j] !== quote) return false;
			j = skipSpace(j + 1);
		}
		if (normalized[j] !== ')') return false;
		i = normalized.indexOf('url(', j + 1);
	}
	return true;
}

function isLocalHref(element: Element, value: string): boolean {
	const target = value.trim();
	if (target.startsWith('#')) return true;
	const name = element.localName.toLowerCase();
	if (name === 'a') return isAllowedLinkScheme(target);
	return name === 'image' && LOCAL_IMAGE.test(target);
}

/**
 * Browser-mermaid serialisiert `xlink:href` (http(s)-click) ohne `xmlns:xlink`; als
 * `image/svg+xml` ist das nicht wohlgeformt. Ergänzt die Deklaration am Wurzel-`<svg>`.
 */
function declareXlink(svg: string): string {
	const root = /^<svg\b[^>]*>/.exec(svg)?.[0];
	if (!root || !svg.includes('xlink:') || /\sxmlns:xlink\s*=/.test(root)) return svg;
	return `<svg xmlns:xlink="${XLINK_NS}"${svg.slice(4)}`;
}

/**
 * Prüft das fertige SVG wie ein Browser es liest (Entities decodiert): `href` nur als Fragment,
 * an `<a>` nur http(s), an `<image>` zusätzlich `data:image`; `url(...)` in Attributen und
 * `<style>` nur auf `#id`; keine ladenden CSS-Funktionen. Der Parse-Dokument lädt nichts.
 */
function hasExternalResource(svg: string): boolean {
	const doc = new DOMParser().parseFromString(svg, 'text/html');
	for (const element of doc.body.querySelectorAll('*')) {
		if (element.localName.toLowerCase() === 'style') {
			if (!isLocalCss(element.textContent ?? '', true)) return true;
		}
		for (const { localName, name, value } of element.attributes) {
			if (name.startsWith('xmlns')) continue;
			if (localName === 'href' || name.endsWith(':href')) {
				if (!isLocalHref(element, value)) return true;
			} else if (!isLocalCss(value, name === 'style')) {
				return true;
			}
		}
	}
	return false;
}

/**
 * Ersetzt `Image` während `mermaid.render`: Knoten mit `img:` laden über `new Image()` schon
 * beim Rendern. Eine Vorprüfung des Codes wäre umgehbar (YAML-Schreibweisen der Shape-Daten,
 * Escapes); das Abfangen der Zuweisung `src` greift unabhängig von der Schreibweise und bevor
 * der Browser lädt. Rückgabe stellt das Original wieder her.
 */
function guardImages(): () => void {
	const scope = globalThis as { Image?: typeof Image };
	const original = scope.Image;
	const src = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
	if (typeof original !== 'function' || !src?.get || !src.set) return () => undefined;
	const { get, set } = src;
	// `Image` beachtet `new.target` nicht (auch im Browser), daher Instanz-Eigenschaft statt Unterklasse.
	scope.Image = function GuardedImage(width?: number, height?: number): HTMLImageElement {
		const image = new original(width, height);
		Object.defineProperty(image, 'src', {
			configurable: true,
			get: () => get.call(image) as string,
			set: (value: unknown) => {
				if (!LOCAL_IMAGE.test(String(value).trim()))
					throw new Error(msg('services.render.externalImage'));
				set.call(image, value);
			}
		});
		return image;
	} as unknown as typeof Image;
	return () => {
		scope.Image = original;
	};
}

function maxTextSize(): number {
	const value = renderConfig().maxTextSize;
	return typeof value === 'number' ? value : 0;
}

function toError(code: string, e: unknown): RenderError {
	const err = (typeof e === 'object' && e !== null ? e : {}) as MermaidError;
	const message = typeof err.message === 'string' ? err.message : String(e);
	const loc = err.hash?.loc;
	const reported = loc?.first_line ?? Number(/on line (\d+)/.exec(message)?.[1] ?? NaN);
	if (!Number.isInteger(reported)) return { message };
	return { message, line: originLine(code, reported), column: (loc?.first_column ?? 0) + 1 };
}

async function renderNow(code: string): Promise<RenderResult> {
	const limit = maxTextSize();
	if (code.length > limit) {
		return {
			ok: false,
			error: { message: msg('services.render.tooLong', { length: code.length, limit }) }
		};
	}
	const id = `${RENDER_ID_PREFIX}${++counter}`;
	try {
		const mermaid = await loadMermaid();
		// Gesperrt entfernt mermaid `theme` auch aus dem parse-Ergebnis: erst entsperrt lesen.
		lockTheme(mermaid, false);
		lockTheme(mermaid, blocksTheme(await mermaid.parse(code, { suppressErrors: true })));
		removeContainers();
		const restoreImage = guardImages();
		let svg: string;
		try {
			({ svg } = await mermaid.render(id, code));
		} finally {
			restoreImage();
		}
		svg = declareXlink(svg);
		if (FOREIGN_OBJECT.test(svg)) {
			return {
				ok: false,
				error: { message: msg('services.render.foreignObject') }
			};
		}
		if (hasExternalResource(svg))
			return { ok: false, error: { message: msg('services.render.externalResource') } };
		return { ok: true, svg };
	} catch (e) {
		return { ok: false, error: toError(code, e) };
	} finally {
		removeContainers();
	}
}

/**
 * Rendert Mermaid-Code zu einem SVG-String (strict, dagre, ohne `foreignObject` und ohne externe
 * Ressourcen) oder liefert
 * einen Fehler mit Zeile/Spalte. Aufrufe laufen nacheinander, da mermaid globalen Zustand hat.
 */
export function renderSvg(code: string): Promise<RenderResult> {
	const run = queue.then(() => renderNow(code));
	queue = run.catch(() => undefined);
	return run;
}
