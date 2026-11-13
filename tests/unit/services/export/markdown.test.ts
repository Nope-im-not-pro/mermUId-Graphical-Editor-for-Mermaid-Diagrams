import { describe, expect, it } from 'vitest';
import { initCounters } from '../../../../src/lib/model/ids';
import { findMermaidBlocks } from '../../../../src/lib/services/file/markdown';
import { copyAsMarkdown } from '../../../../src/lib/services/export/markdown';
import { doc, node } from './fixtures';

const META = '%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[40,60,100,40]}}';
const d = doc({
	nodes: [node('A')],
	layout: {
		mode: 'manual',
		engine: 'dagre',
		positions: { A: [40, 60, 100, 40] },
		gridSize: 10,
		snap: false
	}
});
const counters = initCounters(d);

describe('copyAsMarkdown', () => {
	it('mit "Layout einbetten": Mermaid-Block mit Metadaten-Zeile', () => {
		const result = copyAsMarkdown({
			code: `flowchart LR\n  A\n${META}\n`,
			doc: d,
			counters,
			embed: true
		});
		expect(result).toEqual({
			markdown: '```mermaid\nflowchart LR\n  A\n' + META + '\n```\n',
			warnings: []
		});
	});

	it('ohne Einbetten: Metadaten-Zeile entfällt', () => {
		const result = copyAsMarkdown({
			code: `flowchart LR\n  A\n${META}\n`,
			doc: d,
			counters,
			embed: false
		});
		expect(result.markdown).toBe('```mermaid\nflowchart LR\n  A\n```\n');
	});

	it('Einbetten ohne gelesene Zeile schreibt eine neue, CRLF wird LF', () => {
		const result = copyAsMarkdown({ code: 'flowchart LR\r\n  A', doc: d, counters, embed: true });
		expect(result.markdown).toBe(
			'```mermaid\nflowchart LR\n  A\n%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[40,60,100,40]}}\n```\n'
		);
	});

	it('Code mit Fence wird über längere Fence eingeschlossen, Block liest exakt zurück', () => {
		const code = 'flowchart LR\n  A["```"]\n';
		const result = copyAsMarkdown({ code, doc: doc(), counters, embed: false });
		const blocks = findMermaidBlocks(result.markdown);
		expect(blocks).toHaveLength(1);
		expect(blocks[0].code).toBe('flowchart LR\n  A["```"]');
	});

	it('defekte Zeile: Warnung durchgereicht', () => {
		const result = copyAsMarkdown({
			code: 'flowchart LR\n%% @mermuid: {kaputt\n',
			doc: doc(),
			counters,
			embed: true
		});
		expect(result.warnings.length).toBeGreaterThan(0);
	});
});
