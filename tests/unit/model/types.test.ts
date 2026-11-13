import { describe, expect, expectTypeOf, it } from 'vitest';
import type {
	Container,
	DiagramAdapter,
	DiagramDocument,
	DiagramEdge,
	DiagramNode,
	ParseResult,
	ParseError
} from '../../../src/lib/model/types';
import { emptyDoc } from './fixtures';

describe('Modell-Typen (KONZEPT §8)', () => {
	it('DiagramDocument enthält genau die Felder aus §8', () => {
		expectTypeOf<keyof DiagramDocument>().toEqualTypeOf<
			| 'id'
			| 'diagramType'
			| 'title'
			| 'header'
			| 'order'
			| 'nodes'
			| 'edges'
			| 'containers'
			| 'classDefs'
			| 'rawBlocks'
			| 'comments'
			| 'layout'
			| 'modelVersion'
		>();
		expectTypeOf<DiagramDocument['layout']['positions']>().toEqualTypeOf<
			Record<string, [number, number, number, number]>
		>();
	});

	it('DiagramNode, DiagramEdge und Container enthalten genau die Felder aus §8', () => {
		expectTypeOf<keyof DiagramNode>().toEqualTypeOf<
			| 'id'
			| 'kind'
			| 'label'
			| 'shape'
			| 'cssClasses'
			| 'style'
			| 'props'
			| 'parentId'
			| 'sourceText'
		>();
		expectTypeOf<keyof DiagramEdge>().toEqualTypeOf<
			| 'id'
			| 'kind'
			| 'sourceId'
			| 'targetId'
			| 'label'
			| 'lineStyle'
			| 'arrowHead'
			| 'style'
			| 'props'
			| 'parentId'
			| 'sourceText'
		>();
		expectTypeOf<keyof Container>().toEqualTypeOf<
			'id' | 'kind' | 'label' | 'direction' | 'parentId' | 'sections' | 'props' | 'sourceText'
		>();
	});

	it('DiagramAdapter mit ParseResult als diskriminierte Union', () => {
		const adapter: DiagramAdapter = {
			type: 'flowchart',
			parse: (text): ParseResult =>
				text === ''
					? { ok: false, errors: [{ line: 1, column: 1, message: 'leer' }] }
					: { ok: true, doc: emptyDoc() },
			serialize: (doc) => doc.diagramType
		};
		const bad = adapter.parse('');
		expect(bad.ok).toBe(false);
		if (!bad.ok) expectTypeOf(bad.errors).toEqualTypeOf<ParseError[]>();
		const good = adapter.parse('flowchart TD');
		if (good.ok) expectTypeOf(good.doc).toEqualTypeOf<DiagramDocument>();
		expect(adapter.serialize(emptyDoc())).toBe('flowchart');
	});
});
