import type { Command, CommandContext } from '../../controllers/commands/history';
import type { LayoutMeta } from '../../model/types';
import { snapIf, type GridSettings } from '../canvas/common/grid';
import {
	connectNodes,
	createNode,
	groupIntoSubgraph,
	renameElement
} from '../canvas/graph/commands';
import { nodeSize } from '../canvas/graph/mapping';
import { FLOW_SHAPES } from '../panels/properties';
import { t } from './i18n.svelte';

type Point = { x: number; y: number };

/** MIME-Typ für Drag-and-Drop aus der Palette. */
export const DRAG_TYPE = 'application/x-mermuid-tool';

export interface Tool {
	readonly id: string;
	readonly label: string;
	readonly kind: 'shape' | 'container' | 'template';
	command(at: Point): Command;
}

/** Schritt eines zusammengesetzten Commands; `made` enthält die bisher vergebenen IDs. */
export type Step = (made: readonly string[]) => Command;

/** Mehrere Commands als ein Undo-Schritt; Folgeschritte sehen die neuen IDs. */
export function composite(label: string, steps: readonly Step[]): Command {
	return {
		label,
		do(doc, ctx) {
			const made: string[] = [];
			const record: CommandContext = {
				newId(prefix) {
					const id = ctx.newId(prefix);
					made.push(id);
					return id;
				}
			};
			return steps.reduce((d, step) => step(made).do(d, record), doc);
		}
	};
}

/** Kette beschrifteter Knoten, nacheinander verbunden. */
function chain(label: string, at: Point, items: readonly [string, string][]): Command {
	const steps: Step[] = [];
	items.forEach(([shape, text], i) => {
		steps.push(() => createNode({ x: at.x + i * 160, y: at.y }, shape));
		steps.push((made) => renameElement(made[made.length - 1], text));
	});
	return composite(label, [
		...steps,
		...items.slice(1).map((_, i): Step => (made) => {
			const nodes = made.filter((id) => id.startsWith('n'));
			return connectNodes(nodes[i], nodes[i + 1]);
		})
	]);
}

/** Beschriftungen als Getter: Lesen in Markup/$derived folgt dem Sprachwechsel. */
export const TOOLS: readonly Tool[] = [
	...FLOW_SHAPES.filter((s) => s.value !== 'default').map((s): Tool => ({
		id: `shape:${s.value}`,
		get label() {
			return s.label;
		},
		kind: 'shape',
		command: (at) => createNode(at, s.value)
	})),
	{
		id: 'container',
		get label() {
			return t('app.palette.container');
		},
		kind: 'container',
		command: (at) =>
			composite(t('app.palette.containerCommand'), [
				() => createNode(at),
				(made) => groupIntoSubgraph(made)
			])
	},
	{
		id: 'template:linear',
		get label() {
			return t('app.palette.linear');
		},
		kind: 'template',
		command: (at) =>
			chain(t('app.palette.linearCommand'), at, [
				['stadium', t('app.palette.start')],
				['square', t('app.palette.step')],
				['stadium', t('app.palette.end')]
			])
	},
	{
		id: 'template:decision',
		get label() {
			return t('app.palette.decision');
		},
		kind: 'template',
		command: (at) =>
			chain(t('app.palette.decisionCommand'), at, [
				['stadium', t('app.palette.start')],
				['diamond', t('app.palette.question')],
				['square', t('app.palette.yes')]
			])
	}
];

/** Palette-Suche: Teilwort im Werkzeugnamen, ohne Groß-/Kleinschreibung; leer = alle. */
export function filterTools(tools: readonly Tool[], query: string): readonly Tool[] {
	const q = query.trim().toLowerCase();
	return q === '' ? tools : tools.filter((t) => t.label.toLowerCase().includes(q));
}

export const toolById = (id: string): Tool | null => TOOLS.find((t) => t.id === id) ?? null;

/** Klick-dann-Klick: erneuter Klick auf das aktive Werkzeug löst es. */
export const armTool = (current: string | null, id: string): string | null =>
	current === id ? null : id;

/** Client-Punkt (Drop/Klick) -> Canvas-Koordinate über Pane-Rechteck und Viewport. */
export function canvasPoint(
	client: Point,
	rect: { left: number; top: number },
	viewport: { x: number; y: number; zoom: number },
	grid: GridSettings
): Point {
	return snapIf(
		{
			x: (client.x - rect.left - viewport.x) / viewport.zoom,
			y: (client.y - rect.top - viewport.y) / viewport.zoom
		},
		grid
	);
}

/** Standardgröße eines neuen Knotens wie `createNode` (einzeilig, Mindestbreite). */
const NEW_NODE = nodeSize([''], () => 0);

/**
 * Client-Punkt für "in der Mitte anlegen" (T129 C2): Mitte des sichtbaren Ausschnitts, um die
 * halbe Standardgröße (bei aktuellem Zoom) versetzt, damit der neue Knoten mittig liegt.
 */
export function centerClient(
	rect: { left: number; top: number; width: number; height: number },
	zoom: number
): Point {
	return {
		x: rect.left + rect.width / 2 - (NEW_NODE.width / 2) * zoom,
		y: rect.top + rect.height / 2 - (NEW_NODE.height / 2) * zoom
	};
}

/** Layout-Umschalter Auto/Manuell; Positionen bleiben erhalten (KONZEPT §5). */
export function layoutModeCommand(mode: LayoutMeta['mode']): Command {
	return {
		label: mode === 'auto' ? t('app.palette.layoutAuto') : t('app.palette.layoutManual'),
		do: (doc) => ({ ...doc, layout: { ...doc.layout, mode }, modelVersion: doc.modelVersion + 1 })
	};
}

/**
 * Palette-Einfügen nacheinander (T123 C4): jeder Aufruf vergleicht die Knoten vor und nach
 * seinem eigenen Befehl und holt seinen ersten neuen Knoten ins Sichtfeld (O-118, O-123).
 * `onadded` ersetzt das Nachführen je Aufruf (T129 C2: Auswahl und Fokus auf den Knoten).
 */
export function placeQueue(
	ids: () => readonly string[],
	reveal: (id: string) => void | Promise<void>
) {
	let last: Promise<void> = Promise.resolve();
	return (run: () => Promise<void>, onadded = reveal): Promise<void> => {
		const next = last.then(async () => {
			const known = new Set(ids());
			await run();
			const added = ids().find((n) => !known.has(n));
			if (added) await onadded(added);
		});
		last = next.catch(() => {});
		return next;
	};
}
