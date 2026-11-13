// @vitest-environment jsdom
import mermaid from 'mermaid';
import { describe, expect, it } from 'vitest';
import { flowchartAdapter, serialize } from '../../../../../src/lib/services/adapters/flowchart';
import { updateNode } from '../../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../../src/lib/model/types';

// T138 C2, Auflage Review C1 I3: Leerraum vor `;` entfällt nur nach einem `@{}`-Token.

function parseOk(text: string): DiagramDocument {
	const result = flowchartAdapter.parse(text);
	if (!result.ok) throw new Error(JSON.stringify(result.errors));
	return result.doc;
}

describe('Leerraum vor ; nach Token-Ersatz', () => {
	it.each([
		['A{x} ;', 'A{y} ;'],
		['A{{x}} ;', 'A{{y}} ;'],
		['A[x] ;', 'A[y] ;']
	])('%j bleibt mit Leerraum: %j', async (line, expected) => {
		const out = serialize(updateNode(parseOk(`flowchart LR\n${line}\n`), 'A', { label: 'y' }));
		expect(out).toBe(`flowchart LR\n${expected}\n`);
		await expect(mermaid.parse(out)).resolves.toBeTruthy();
	});

	it('Klammer -> @{}: Leerraum vor ; entfällt (mermaid: Parse-Fehler)', async () => {
		const out = serialize(updateNode(parseOk('flowchart LR\nA[x] ;\n'), 'A', { shape: 'doc' }));
		expect(out).toBe('flowchart LR\nA@{ shape: doc, label: "x" };\n');
		await expect(mermaid.parse(out)).resolves.toBeTruthy();
	});
});
