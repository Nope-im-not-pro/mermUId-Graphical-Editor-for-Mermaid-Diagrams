/** Zoom-Grenzen des Canvas: 25 bis 400 %. */
export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 4;

/** Faktor je Zoom-Schritt (wie `GraphFlow` `zoomBy`). */
export const ZOOM_STEP = 1.2;

export function clampZoom(zoom: number): number {
	return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}

export function zoomPercent(zoom: number): string {
	return `${Math.round(clampZoom(zoom) * 100)} %`;
}

type Size = { width: number; height: number };

/** Abschlag beim Einpassen: Rand, damit Rundung keinen Rest-Scroll erzeugt. */
export const FIT_MARGIN = 0.95;

/** Zoom, der den Inhalt ganz in den Rahmen bringt (mit Rand); ohne messbare Größen 100 %. */
export function fitZoom(content: Size, frame: Size): number {
	if (!(content.width > 0 && content.height > 0 && frame.width > 0 && frame.height > 0)) return 1;
	return clampZoom(
		Math.min(frame.width / content.width, frame.height / content.height) * FIT_MARGIN
	);
}

/** Scroll-Lage nach Zoomwechsel, die die Mitte des Ausschnitts festhält (je Achse, nie negativ). */
export function zoomScroll(scroll: number, frame: number, from: number, to: number): number {
	return Math.max(0, ((scroll + frame / 2) / from) * to - frame / 2);
}

/**
 * Eingabe-Belegung von Svelte Flow (FA-03, FA-05): Shift, Strg und Meta fügen per Klick
 * hinzu, Links-Drag auf leerer Fläche zieht das Lasso, Pan per mittlerer Maustaste,
 * Leertaste plus Drag und Scroll (Strg-Rad bzw. Pinch zoomt).
 */
export const FLOW_INPUT = {
	multiSelectionKey: ['Shift', 'Control', 'Meta'],
	selectionOnDrag: true,
	panOnDrag: [1],
	panActivationKey: ' ',
	panOnScroll: true
};
