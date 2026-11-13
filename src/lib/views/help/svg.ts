/**
 * Gemeinsame SVG-Einbettung der Views (O-31): Mermaid-SVG aus `renderSvg` wird per `DOMParser`
 * (`image/svg+xml`) gelesen, bei `parsererror` verworfen und per `document.importNode` in den
 * Container übernommen, nie als HTML-Text. Zusätzlich (Tiefenschutz) werden
 * `script`-Elemente und `on*`-Attribute vor der Übernahme entfernt.
 * Eingebettete Vorschau navigiert nie (KONZEPT §10): `<a>` wird zu `<g>` (Attribute außer
 * Verweisen bleiben, Layout unverändert), `href`/`xlink:href` bleiben nur als `#`-Verweis.
 */
import { renderSvg, type RenderResult } from '../../services/render';
import { t } from '../shell/i18n.svelte';

const SVG_NS = 'http://www.w3.org/2000/svg';

/** `<a>` -> `<g>` mit gleichen Kindern und Attributen außer `href`, `xlink:href`, `target`. */
function unlink(a: Element): void {
	const g = a.ownerDocument.createElementNS(SVG_NS, 'g');
	for (const attr of a.attributes) {
		if (attr.localName !== 'href' && attr.localName !== 'target') {
			g.setAttributeNS(attr.namespaceURI, attr.name, attr.value);
		}
	}
	g.append(...a.childNodes);
	a.replaceWith(g);
}

/** Ersetzt den Inhalt von `container` durch das SVG; `false` (Container unverändert) bei Fehler. */
export function insertSvg(container: Element, svg: string): boolean {
	const doc = new DOMParser().parseFromString(svg, 'image/svg+xml');
	const root = doc.documentElement;
	if (doc.getElementsByTagName('parsererror').length > 0) return false;
	if (root.localName !== 'svg' || root.namespaceURI !== SVG_NS) return false;
	for (const script of [...root.getElementsByTagName('script')]) script.remove();
	for (const a of [...root.getElementsByTagNameNS('*', 'a')]) unlink(a);
	for (const el of [root, ...root.getElementsByTagName('*')]) {
		for (const { name, localName, value } of [...el.attributes]) {
			const external = localName === 'href' && !value.trim().startsWith('#');
			if (external || name.toLowerCase().startsWith('on')) el.removeAttribute(name);
		}
	}
	container.replaceChildren(document.importNode(root, true));
	return true;
}

function showError(container: HTMLElement, message: string, line?: number): void {
	const p = document.createElement('p');
	p.className = 'help-error';
	p.setAttribute('role', 'alert');
	const where = line === undefined ? '' : t('help.renderErrorLine', { line });
	p.textContent = t('help.renderError', { where, message });
	container.replaceChildren(p);
}

export interface MermaidView {
	/** Erfüllt, sobald SVG oder Fehlertext steht (oder nach `cancel` nichts mehr geschieht). */
	done: Promise<void>;
	/** Verwirft ein noch ausstehendes Ergebnis (z. B. beim Schließen der Hilfe). */
	cancel: () => void;
}

/** Rendert `code` und zeigt SVG bzw. Fehlertext in `container`. */
export function showMermaid(
	container: HTMLElement,
	code: string,
	render: (code: string) => Promise<RenderResult> = renderSvg
): MermaidView {
	let cancelled = false;
	container.setAttribute('aria-busy', 'true');
	container.textContent = t('help.loading');
	const done = render(code)
		.then(
			(result) => result,
			(e: unknown): RenderResult => ({
				ok: false,
				error: { message: e instanceof Error ? e.message : String(e) }
			})
		)
		.then((result) => {
			if (cancelled) return;
			container.setAttribute('aria-busy', 'false');
			if (!result.ok) showError(container, result.error.message, result.error.line);
			else if (!insertSvg(container, result.svg)) showError(container, t('help.svgUnreadable'));
		});
	return {
		done,
		cancel: () => {
			cancelled = true;
		}
	};
}
