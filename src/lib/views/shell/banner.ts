import type { SyncState } from '../../controllers/sync';
import type { BannerInset } from './Banner.svelte';
import { t } from './i18n.svelte';

export type BannerAction = 'keepGraphic' | 'keepCode' | 'diff';

/** Zeilen-/Spalten-Link des ersten Fehlers: `message` = `before` + `text` + `after`. */
export interface BannerLink {
	readonly before: string;
	readonly text: string;
	readonly after: string;
	readonly line: number;
	readonly column: number;
}

export interface Banner {
	/** `conflict`: Wahl ausstehend; `error`: nur Parse-Fehler, reiner Hinweis (O-44). */
	readonly kind: 'conflict' | 'error';
	readonly label: string;
	readonly message: string;
	readonly link: BannerLink | null;
	readonly actions: readonly { readonly id: BannerAction; readonly label: string }[];
}

const actions = (): Banner['actions'] => [
	{ id: 'keepGraphic', label: t('app.banner.keepGraphic') },
	{ id: 'keepCode', label: t('app.banner.keepCode') },
	{ id: 'diff', label: t('app.banner.diff') }
];

/**
 * Nicht-modales Banner: Konflikt mit Wahlknöpfen, sonst bei Parse-Fehler ein Hinweis ohne
 * Wahlknöpfe; im Modus "nur Code" keins.
 */
export function bannerFor(s: Pick<SyncState, 'mode' | 'conflict' | 'errors'>): Banner | null {
	if (s.mode === 'code') return null;
	const first = s.errors[0];
	if (!s.conflict && !first) return null;
	const kind = s.conflict ? 'conflict' : 'error';
	const label = s.conflict ? t('app.banner.label') : t('banner.errorLabel');
	const choices = s.conflict ? actions() : [];
	if (!first)
		return { kind, label, message: t('app.banner.conflict'), link: null, actions: choices };
	const link: BannerLink = {
		before: t('app.banner.before'),
		text: t('app.banner.position', { line: first.line, column: first.column }),
		after: t('app.banner.after', { message: first.message }),
		line: first.line,
		column: first.column
	};
	return { kind, label, message: link.before + link.text + link.after, link, actions: choices };
}

/** Bedienelemente der Fläche, die der Fehlerhinweis meidet (O-58, T101 C3). */
export type Avoid = { top: Element[]; left: Element[]; right: Element[] };
export const GAP = 8;
/** Unterhalb davon gelten nur Ränder: der Zeilen-Link bleibt sichtbar (Überdeckung hingenommen). */
export const MIN_BANNER = 220;

/**
 * Sequenz: unterhalb der Werkzeugleiste. Graph (unten): rechts vom Panel unten links (Controls;
 * Rohblöcke liegen seit O-141 oben links), links von Vorschau-Karte und Live-Status unten rechts.
 */
export function insetFor(box: HTMLElement, avoid: Avoid, isGraph: boolean): BannerInset {
	const b = box.getBoundingClientRect();
	// Leere Elemente (z. B. Live-Status ohne Text) verdecken nichts.
	const extent = (els: Element[], size: (r: DOMRect) => number) =>
		Math.max(
			0,
			...els
				.map((el) => el.getBoundingClientRect())
				.filter((r) => r.width > 0 && r.height > 0)
				.map(size)
		) + GAP;
	if (!isGraph) return { top: extent(avoid.top, (r) => r.bottom - b.top) };
	const left = extent(avoid.left, (r) => r.right - b.left);
	const right = extent(avoid.right, (r) => b.right - r.left);
	return b.width - left - right < MIN_BANNER ? { left: GAP, right: GAP } : { left, right };
}

/**
 * Abstände des Fehlerhinweises in `box` (Canvas-Fläche) laufend nachführen: sofort und bei jeder
 * Größenänderung der Fläche oder eines gemiedenen Elements. Liefert die Abmeldung.
 */
export function watchInset(
	box: HTMLElement,
	isGraph: boolean,
	set: (inset: BannerInset) => void
): () => void {
	const avoid: Avoid = isGraph
		? {
				top: [],
				left: [...box.querySelectorAll('.svelte-flow__panel.bottom.left')],
				right: [
					...box.querySelectorAll('.graph-canvas > .status'),
					...(box.parentElement?.querySelectorAll(':scope > .preview') ?? [])
				]
			}
		: { top: [...box.querySelectorAll('.sequence-canvas > .toolbar')], left: [], right: [] };
	const update = () => set(insetFor(box, avoid, isGraph));
	update();
	const observer = new ResizeObserver(update);
	for (const el of [box, ...avoid.top, ...avoid.left, ...avoid.right]) observer.observe(el);
	return () => observer.disconnect();
}
