import { describe, expect, it } from 'vitest';
import {
	createHistory,
	execute,
	type Command
} from '../../../../src/lib/controllers/commands/history';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import {
	armTool,
	canvasPoint,
	composite,
	DRAG_TYPE,
	layoutModeCommand,
	TOOLS,
	toolById
} from '../../../../src/lib/views/shell/palette';
import { parseOk } from '../canvas/helpers';

const empty = () => parseOk('flowchart LR\n');
const grid = { size: 8, snap: true };
const apply = (d: DiagramDocument, c: Command) => execute(createHistory(d), c);

describe('canvasPoint', () => {
	it('rechnet Client-Punkt über Pane-Rechteck und Viewport in Canvas-Koordinaten', () => {
		const p = canvasPoint(
			{ x: 250, y: 130 },
			{ left: 50, top: 30 },
			{ x: 20, y: -20, zoom: 2 },
			{ ...grid, snap: false }
		);
		expect(p).toEqual({ x: 90, y: 60 });
	});

	it('rastet bei Snap auf das Raster', () => {
		expect(
			canvasPoint({ x: 13, y: 21 }, { left: 0, top: 0 }, { x: 0, y: 0, zoom: 1 }, grid)
		).toEqual({ x: 16, y: 24 });
	});
});

describe('Werkzeuge', () => {
	it('alle flowchart-Formen außer Standard, Container und Vorlagen mit Label', () => {
		const shapes = TOOLS.filter((t) => t.kind === 'shape');
		expect(shapes.map((t) => t.id)).toContain('shape:diamond');
		expect(shapes.some((t) => t.id === 'shape:default')).toBe(false);
		expect(TOOLS.filter((t) => t.kind === 'container')).toHaveLength(1);
		expect(TOOLS.filter((t) => t.kind === 'template').length).toBeGreaterThanOrEqual(2);
		expect(TOOLS.every((t) => t.label.length > 0)).toBe(true);
		expect(DRAG_TYPE).toBe('application/x-mermuid-tool');
		expect(toolById('fehlt')).toBeNull();
	});

	it('Form-Werkzeug legt Knoten mit Form an der Position an (Modus manual)', () => {
		const manual = empty();
		const start = { ...manual, layout: { ...manual.layout, mode: 'manual' as const } };
		const { doc } = apply(start, toolById('shape:diamond')!.command({ x: 8, y: 16 }));
		expect(doc.nodes).toHaveLength(1);
		expect(doc.nodes[0].shape).toBe('diamond');
		expect(doc.layout.positions[doc.nodes[0].id]).toEqual([8, 16, 80, 42]);
	});

	it('Form-Werkzeug im Auto-Layout legt Knoten ohne Position an (O-48)', () => {
		const { doc } = apply(empty(), toolById('shape:diamond')!.command({ x: 8, y: 16 }));
		expect(doc.nodes).toHaveLength(1);
		expect(doc.nodes[0].shape).toBe('diamond');
		expect(doc.layout.mode).toBe('auto');
		expect(doc.layout.positions[doc.nodes[0].id]).toBeUndefined();
	});

	it('Container-Werkzeug legt Subgraph mit einem Knoten als ein Schritt an', () => {
		const { doc } = apply(empty(), toolById('container')!.command({ x: 0, y: 0 }));
		expect(doc.containers).toHaveLength(1);
		expect(doc.nodes[0].parentId).toBe(doc.containers[0].id);
	});

	it('Starter-Vorlagen erzeugen verbundene, beschriftete Knoten', () => {
		for (const tool of TOOLS.filter((t) => t.kind === 'template')) {
			const { doc } = apply(empty(), tool.command({ x: 100, y: 100 }));
			expect(doc.nodes.length).toBeGreaterThanOrEqual(3);
			expect(doc.edges.length).toBe(doc.nodes.length - 1);
			expect(doc.nodes.every((n) => n.label !== n.id)).toBe(true);
		}
		const { doc } = apply(empty(), toolById('template:decision')!.command({ x: 0, y: 0 }));
		expect(doc.nodes.some((n) => n.shape === 'diamond')).toBe(true);
	});

	it('composite übergibt die neu vergebenen IDs an Folgeschritte', () => {
		const seen: string[][] = [];
		const cmd = composite('x', [
			() => toolById('shape:square')!.command({ x: 0, y: 0 }),
			(made) => (seen.push([...made]), { label: 'n', do: (d) => d })
		]);
		apply(empty(), cmd);
		expect(seen).toEqual([['n1']]);
	});
});

describe('armTool / layoutModeCommand', () => {
	it('Klick-dann-Klick: zweiter Klick auf dasselbe Werkzeug löst', () => {
		expect(armTool(null, 'container')).toBe('container');
		expect(armTool('container', 'container')).toBeNull();
		expect(armTool('container', 'shape:circle')).toBe('shape:circle');
	});

	it('Layout-Modus wechselt ohne Positionsverlust', () => {
		const start = apply(empty(), toolById('shape:square')!.command({ x: 8, y: 8 })).doc;
		const auto = apply(start, layoutModeCommand('auto')).doc;
		expect(auto.layout.mode).toBe('auto');
		expect(auto.layout.positions).toEqual(start.layout.positions);
		expect(apply(auto, layoutModeCommand('manual')).doc.layout.mode).toBe('manual');
	});
});
