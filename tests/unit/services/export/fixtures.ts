import type {
	Container,
	DiagramDocument,
	DiagramEdge,
	DiagramNode
} from '../../../../src/lib/model/types';

/** Deterministische Textmetrik: 7 px je Zeichen. */
export const measure = (s: string): number => s.length * 7;

export function node(id: string, label = id, shape = 'square', parentId: string | null = null) {
	const n: DiagramNode = {
		id,
		kind: 'node',
		label,
		shape,
		cssClasses: [],
		style: {},
		props: {},
		parentId,
		sourceText: ''
	};
	return n;
}

export function edge(
	id: string,
	sourceId: string,
	targetId: string,
	extra: Partial<DiagramEdge> = {}
): DiagramEdge {
	return {
		id,
		kind: 'edge',
		sourceId,
		targetId,
		label: '',
		lineStyle: 'solid',
		arrowHead: 'arrow',
		style: {},
		props: {},
		parentId: null,
		sourceText: '',
		...extra
	};
}

export function container(id: string, label = id, parentId: string | null = null): Container {
	return {
		id,
		kind: 'subgraph',
		label,
		direction: '',
		parentId,
		sections: [],
		props: {},
		sourceText: ''
	};
}

export function doc(parts: Partial<DiagramDocument> = {}): DiagramDocument {
	return {
		id: 'd1',
		diagramType: 'flowchart',
		title: '',
		header: { frontmatter: '', directives: [] },
		order: [],
		nodes: [],
		edges: [],
		containers: [],
		classDefs: [],
		rawBlocks: [],
		comments: [],
		layout: { mode: 'manual', engine: 'dagre', positions: {}, gridSize: 10, snap: false },
		modelVersion: 1,
		...parts
	};
}
