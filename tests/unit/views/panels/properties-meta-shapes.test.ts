// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { FLOW_SHAPES, commandFor, panelFor } from '../../../../src/lib/views/panels/properties';
import { TOOLS } from '../../../../src/lib/views/shell/palette';
import { ctx, flow, flowOut } from './helpers';

// T138 C2 I2, Befund 1: Formwechsel per Eigenschaften auch zu/von den `@{ shape }`-Formen (F-07).

const META = ['doc', 'delay', 'sl-rect', 'h-cyl', 'lin-cyl'];

function setShape(text: string, shape: string): string {
	const doc = flow(text);
	const cmd = commandFor(doc, 'A', 'shape', shape);
	if (!cmd) throw new Error(`kein Command für ${shape}`);
	return flowOut(cmd.do(doc, ctx));
}

describe('Eigenschaften: neue Formen', () => {
	it('Auswahlfeld enthält die fünf Formen genau einmal', () => {
		const values = FLOW_SHAPES.map((o) => o.value);
		for (const m of META) expect(values.filter((v) => v === m)).toHaveLength(1);
	});

	it('Klammer -> doc -> square, jeweils gültiges mermaid', async () => {
		const a = setShape('flowchart LR\n  A[Start]\n', 'doc');
		expect(a).toContain('A@{ shape: doc, label: "Start" }');
		await expect(mermaid.parse(a)).resolves.toBeTruthy();
		const b = setShape(a, 'square');
		expect(b).toContain('A[Start]');
		expect(b).not.toContain('@{');
		await expect(mermaid.parse(b)).resolves.toBeTruthy();
	});

	it.each(META)('Klammer -> %s ergibt gültiges mermaid', async (shape) => {
		const out = setShape('flowchart LR\n  A[Start]\n', shape);
		await expect(mermaid.parse(out)).resolves.toBeTruthy();
	});

	it('Auswahlfeld zeigt für doc-Knoten den Eintrag doc', () => {
		const p = panelFor(flow('flowchart LR\n  A@{ shape: doc, label: "x" }\n'), 'A');
		const field = p?.fields.find((f) => f.key === 'shape');
		expect(field?.value).toBe('doc');
		expect(field?.options?.some((o) => o.value === 'doc' && o.label.length > 0)).toBe(true);
	});

	it('Palette: keine doppelten Werkzeuge, fünf Formen enthalten', () => {
		const ids = TOOLS.map((t) => t.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const m of META) expect(ids).toContain(`shape:${m}`);
	});
});
