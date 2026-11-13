import type { SyncMode } from '../../controllers/sync';
import type { JumpTarget } from '../panels/errors';
import { t } from './i18n.svelte';
import type { MediaAccess, MediaList } from './theme';

export type SideTab = 'properties' | 'code';

/** Ansichtszustand der Shell; keine Persistenz. */
export interface PanelState {
	readonly tab: SideTab;
	readonly previewOpen: boolean;
}

/** Code-Panel per Default eingeklappt (FA-10), Vorschau offen. */
export const initialPanels = (): PanelState => ({ tab: 'properties', previewOpen: true });

export const selectTab = (s: PanelState, tab: SideTab): PanelState => ({ ...s, tab });

export const toggleCode = (s: PanelState): PanelState =>
	selectTab(s, s.tab === 'code' ? 'properties' : 'code');

export const togglePreview = (s: PanelState): PanelState => ({ ...s, previewOpen: !s.previewOpen });

/** Übrige Typen ("nur Code", MVP-Regel §4): Code und Vorschau sind fest offen. */
export const panelsLocked = (mode: SyncMode): boolean => mode === 'code';

/** Grund für die deaktivierten Umschalter im Modus "nur Code". */
export const lockedReason = (): string => t('app.locked');

/** Übrige Typen ("nur Code", MVP-Regel §4) öffnen als Vorschau plus Code. */
export function forMode(s: PanelState, mode: SyncMode): PanelState {
	return panelsLocked(mode) ? { tab: 'code', previewOpen: true } : s;
}

/** Sprung aus der Fehlerliste: Zeile im Code, Element in den Eigenschaften. */
export const afterJump = (s: PanelState, target: JumpTarget): PanelState =>
	selectTab(s, target.type === 'line' ? 'code' : 'properties');

const TAB_STEP: Record<string, 1 | -1> = { ArrowRight: 1, ArrowLeft: -1 };

/**
 * Tabs-Muster (WAI-ARIA, T129 C2): Pfeil rechts/links zyklisch, Home/End an den Rand; gesperrte
 * Tabs werden übersprungen. Andere Tasten: `null` (unbehandelt).
 */
export function nextTab<T extends string>(
	ids: readonly T[],
	current: T,
	key: string,
	enabled: (id: T) => boolean = () => true
): T | null {
	const open = ids.filter(enabled);
	if (open.length === 0) return null;
	if (key === 'Home') return open[0];
	if (key === 'End') return open[open.length - 1];
	const step = TAB_STEP[key];
	if (!step) return null;
	const i = open.indexOf(current);
	return open[(i + step + open.length) % open.length];
}

/** Einklappbare Leisten der Shell (T129 C1, M-09 a, D6). */
export type Dock = 'palette' | 'inspector';

/**
 * Leisten-Zustand, Sitzungszustand ohne Persistenz wie `PanelState`. Ab 900 px gelten
 * `palette`/`inspector` (eingeklappt oder offen), darunter `drawer` (höchstens eine Schublade).
 */
export interface DockState {
	readonly palette: boolean;
	readonly inspector: boolean;
	readonly drawer: Dock | null;
}

/** Unter dieser Breite (900 px) werden die Leisten zur Schublade. */
export const NARROW_QUERY = '(max-width: 899.98px)';
/** Unter dieser Breite erscheint der Mindestbreiten-Hinweis (D6: 640 px). */
export const MIN_WIDTH = 640;
/** Hinweis-Modus (gleiche Grenze wie die CSS-Regel `.too-narrow` in Shell.svelte). */
export const MIN_QUERY = '(max-width: 639.98px)';

/** Standard wie bisher: beide Leisten offen, keine Schublade. */
export const initialDocks = (): DockState => ({ palette: true, inspector: true, drawer: null });

export const dockOpen = (s: DockState, dock: Dock, narrow: boolean): boolean =>
	narrow ? s.drawer === dock : s[dock];

/** Breit: Leiste ein/aus; schmal: Schublade öffnen (andere schließt) bzw. schließen. */
export function toggleDock(s: DockState, dock: Dock, narrow: boolean): DockState {
	if (narrow) return { ...s, drawer: s.drawer === dock ? null : dock };
	return { ...s, [dock]: !s[dock] };
}

/** Schublade schließen; mit `only` nur, wenn genau diese Leiste offen ist (T129 C2). */
export const closeDrawer = (s: DockState, only?: Dock): DockState =>
	s.drawer === null || (only !== undefined && s.drawer !== only) ? s : { ...s, drawer: null };

function query(media: MediaAccess | undefined, q: string): MediaList | null {
	try {
		return media?.(q) ?? null;
	} catch {
		return null;
	}
}

/**
 * Meldet `true` unter 900 px (bzw. für `q`, z. B. `MIN_QUERY`), sofort und bei Wechsel;
 * ohne matchMedia: breit.
 */
export function watchNarrow(
	media: MediaAccess | undefined,
	onchange: (narrow: boolean) => void,
	q = NARROW_QUERY
): () => void {
	const list = query(media, q);
	if (!list) {
		onchange(false);
		return () => {};
	}
	onchange(list.matches);
	const listener = (e: { matches: boolean }) => onchange(e.matches);
	list.addEventListener('change', listener);
	return () => list.removeEventListener('change', listener);
}
