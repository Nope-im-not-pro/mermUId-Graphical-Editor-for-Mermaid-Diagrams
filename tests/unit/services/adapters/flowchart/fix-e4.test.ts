// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import { updateNode } from '../../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

interface FlowDb {
	getVertices(): Map<string, { classes: string[]; styles: string[]; text?: string }>;
	getSubGraphs(): { id: string; nodes: string[] }[];
	getClasses(): Map<string, unknown>;
}

async function db(text: string): Promise<FlowDb> {
	await mermaid.parse(text);
	return (await mermaid.mermaidAPI.getDiagramFromText(text)).db as unknown as FlowDb;
}

const props = (doc: DiagramDocument) =>
	doc.nodes.map((n) => ({
		id: n.id,
		label: n.label,
		shape: n.shape,
		parentId: n.parentId,
		classes: [...n.cssClasses].sort(),
		style: n.style,
		click: n.props.click
	}));
const boxes = (doc: DiagramDocument) => doc.containers.map((c) => `${c.id}:${c.parentId}`).sort();

/** Fixpunkt ab der ersten Ausgabe; Re-Parse erhält Knoten-Eigenschaften, keine Dubletten. */
async function stable(edited: DiagramDocument): Promise<string> {
	const out = serialize(edited);
	const again = parseOk(out);
	expect(serialize(again)).toBe(out);
	expect(serialize(parseOk(serialize(again)))).toBe(out);
	expect(props(again)).toEqual(props(edited));
	expect(boxes(again)).toEqual(boxes(edited));
	for (const line of out.split('\n').filter((l) => /^(style|class|click) /.test(l)))
		expect(out.split('\n').filter((l) => l === line)).toHaveLength(1);
	const flow = await db(out);
	expect(
		flow
			.getSubGraphs()
			.map((s) => s.id)
			.sort()
	).toEqual(edited.containers.map((c) => c.id).sort());
	const vertices = flow.getVertices();
	expect([...vertices.keys()].sort()).toEqual(edited.nodes.map((n) => n.id).sort());
	for (const n of edited.nodes) {
		const v = vertices.get(n.id)!;
		// `clickable` setzt mermaid selbst für Knoten mit click.
		const classes = v.classes.filter((c) => c !== 'clickable');
		expect([n.id, classes.sort()]).toEqual([n.id, [...n.cssClasses].sort()]);
		expect(v.styles.length > 0).toBe(Object.keys(n.style).length > 0);
	}
	return out;
}

const SUB_T = 'subgraph T\nC\nend\n';

describe('Container-ID-Knoten mit class/style/click: kein Wachstum (P2 E4)', () => {
	it.each([
		['style in U', `flowchart TD\nsubgraph U\nT\nstyle T fill:#f00\nend\n${SUB_T}`],
		['style oben', `flowchart TD\nsubgraph U\nT\nend\n${SUB_T}style T fill:#f00\n`],
		['class oben', `flowchart TD\nsubgraph U\nT\nend\n${SUB_T}class T foo\n`],
		['::: in U', `flowchart TD\nsubgraph U\nT:::foo\nend\n${SUB_T}`],
		['click in U', `flowchart TD\nsubgraph U\nT\nclick T href "https://x.test"\nend\n${SUB_T}`],
		[
			'Kante, style und class',
			`flowchart TD\nsubgraph U\nA --> T\nend\n${SUB_T}style T fill:#f00\nclass T foo\n`
		]
	])('%s: unverändert byte-gleich und stabil', async (_n, text) => {
		expect(await stable(parseOk(text))).toBe(text);
	});

	it.each<[string, string, Parameters<typeof updateNode>[2]]>([
		[
			'Label',
			`flowchart TD\nsubgraph U\nT\nstyle T fill:#f00\nend\n${SUB_T}`,
			{ label: 'neu', shape: 'square' }
		],
		['Klasse', `flowchart TD\nsubgraph U\nT:::foo\nend\n${SUB_T}`, { cssClasses: ['bar'] }],
		[
			'Style',
			`flowchart TD\nsubgraph U\nT\nend\n${SUB_T}style T fill:#f00\n`,
			{ style: { fill: '#0f0' } }
		]
	])(
		'%s am Container-ID-Knoten: genau einmal geschrieben, Re-Parse erhält es',
		async (_n, text, patch) => {
			const edited = updateNode(parseOk(text), 'T', patch);
			const out = await stable(edited);
			expect(out.match(/^subgraph T$/gm)).toHaveLength(1);
			expect(out.match(/^(style|class) T /gm)?.length ?? 0).toBeLessThanOrEqual(1);
		}
	);
});

describe('Einrückung: Container enthält gleichnamigen Knoten (P2 E4)', () => {
	it('kein Stack-Überlauf, byte-gleich und stabil', async () => {
		const text = 'flowchart TD\nsubgraph T\nT\nC\nend\n';
		const out = serialize(parseOk(text));
		expect(out).toBe(text);
		expect(serialize(parseOk(out))).toBe(out);
		const flow = await db(out);
		expect(flow.getSubGraphs().find((s) => s.id === 'T')?.nodes).toEqual(['C']);
	});
});

describe('Knoten vor gleichnamigem Subgraphen (P3 E4, Grenze)', () => {
	it('stabil, Knoten steht nach dem Subgraphen', () => {
		const out = serialize(parseOk('flowchart TD\nT\nsubgraph T\nC\nend\n'));
		expect(out).toBe('flowchart TD\nsubgraph T\nC\nend\nT\n');
		expect(serialize(parseOk(out))).toBe(out);
	});
});
