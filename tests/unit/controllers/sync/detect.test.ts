import { describe, expect, it } from 'vitest';
import { detectType } from '../../../../src/lib/controllers/sync';

describe('detectType', () => {
	it.each([
		['flowchart LR\n', 'flowchart'],
		['graph TD\n  A\n', 'flowchart'],
		['graph', 'flowchart'],
		['  flowchart;A', 'flowchart'],
		['sequenceDiagram\n', 'sequence'],
		['%% Kommentar\n\n%%{init: {}}%%\r\nsequenceDiagram\r\n', 'sequence'],
		['---\ntitle: x\n---\nflowchart LR\n', 'flowchart'],
		['---\ntitle: x\nflowchart LR\n', 'code'],
		['flowchartX\n', 'code'],
		['classDiagram\n', 'code'],
		['', 'code'],
		['%% nur Kommentar\n', 'code']
	])('%j -> %s', (text, mode) => {
		expect(detectType(text)).toBe(mode);
	});
});
