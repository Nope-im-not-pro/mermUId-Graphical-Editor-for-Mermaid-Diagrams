// @vitest-environment jsdom
import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createSync } from '../../../../src/lib/controllers/sync';

describe('Standard-Adapter mit mermaid-Validierung (O-15)', () => {
	it('gültiger flowchart wird übernommen', async () => {
		const sync = await createSync('flowchart LR\n  A --> B\n');
		expect(get(sync)).toMatchObject({ mode: 'flowchart', errors: [], conflict: false });
		expect(get(sync.commands).doc.nodes.map((n) => n.id)).toEqual(['A', 'B']);
	});

	it('vom Zeilen-Mapper akzeptierter, für mermaid ungültiger Text blockiert Code -> Grafik', async () => {
		const sync = await createSync('flowchart LR\n  A --> B\n');
		const text = 'flowchart TD\n    A --> B\n    C -->\n';
		sync.editCode(text);
		await sync.flush();
		expect(get(sync)).toMatchObject({ code: text, conflict: false });
		expect(get(sync).errors[0].line).toBeGreaterThanOrEqual(3);
		expect(get(sync.commands).doc.nodes.map((n) => n.id)).toEqual(['A', 'B']);
		sync.dispose();
	});

	it('sequence-Adapter validiert ebenfalls', async () => {
		const sync = await createSync('sequenceDiagram\n  A->>B: hallo\n');
		expect(get(sync)).toMatchObject({ mode: 'sequence', errors: [] });
	});
});
