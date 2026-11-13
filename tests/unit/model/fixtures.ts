import type {
	Container,
	DiagramDocument,
	DiagramEdge,
	DiagramNode
} from '../../../src/lib/model/types';

export function node(id: string, extra: Partial<DiagramNode> = {}): DiagramNode {
	return {
		id,
		kind: 'node',
		label: id,
		shape: 'rect',
		cssClasses: [],
		style: {},
		props: {},
		parentId: null,
		sourceText: `${id}[${id}]`,
		...extra
	};
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
		sourceText: `${sourceId} --> ${targetId}`,
		...extra
	};
}

export function container(id: string, extra: Partial<Container> = {}): Container {
	return {
		id,
		kind: 'subgraph',
		label: id,
		direction: '',
		parentId: null,
		sections: [{ label: '', memberIds: [] }],
		props: {},
		sourceText: `subgraph ${id}`,
		...extra
	};
}

export function emptyDoc(extra: Partial<DiagramDocument> = {}): DiagramDocument {
	return {
		id: 'doc',
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
		layout: { mode: 'auto', engine: 'dagre', positions: {}, gridSize: 10, snap: false },
		modelVersion: 0,
		...extra
	};
}

/** n1 -> n2 -> n3 (e1, e2), Container c1 mit n3 und e2, Position fuer n1 und e1. */
export function sampleDoc(): DiagramDocument {
	return emptyDoc({
		order: ['n1', 'n2', 'e1', 'c1'],
		nodes: [node('n1'), node('n2'), node('n3', { parentId: 'c1' })],
		edges: [edge('e1', 'n1', 'n2'), edge('e2', 'n2', 'n3', { parentId: 'c1' })],
		containers: [container('c1', { sections: [{ label: '', memberIds: ['n3', 'e2'] }] })],
		layout: {
			mode: 'manual',
			engine: 'dagre',
			positions: { n1: [0, 0, 10, 10], e1: [1, 1, 1, 1], n3: [5, 5, 10, 10] },
			gridSize: 10,
			snap: true
		}
	});
}

export function deepFreeze<T>(value: T): T {
	if (value && typeof value === 'object') {
		for (const key of Object.keys(value)) {
			deepFreeze((value as Record<string, unknown>)[key]);
		}
		Object.freeze(value);
	}
	return value;
}
