import type { Command } from '../../../../src/lib/controllers/commands/history';
import type { AdapterEntry } from '../../../../src/lib/controllers/sync';
import { updateNode } from '../../../../src/lib/model/operations';
import type { DiagramAdapter, ParseError, Position } from '../../../../src/lib/model/types';
import { flowchartAdapter } from '../../../../src/lib/services/adapters/flowchart';
import { sequenceAdapter } from '../../../../src/lib/services/adapters/sequence';

/** Marker für Syntaxfehler der Validierungs-Attrappe (statt mermaid). */
export const BAD = '%%FEHLER';

export function fakeValidate(text: string): Promise<ParseError[]> {
	const line = text.split('\n').findIndex((l) => l.includes(BAD));
	return Promise.resolve(line < 0 ? [] : [{ line: line + 1, column: 1, message: 'Syntaxfehler' }]);
}

function entry(adapter: DiagramAdapter): AdapterEntry {
	return { adapter, validate: fakeValidate };
}

export const fakeAdapters = {
	flowchart: entry(flowchartAdapter),
	sequence: entry(sequenceAdapter)
};

export const rename = (id: string, label: string): Command => ({
	label: 'rename',
	do: (d) => updateNode(d, id, { label })
});

export const noop: Command = { label: 'noop', do: (d) => d };

export const place = (id: string, pos: Position): Command => ({
	label: 'place',
	do: (d) => ({
		...d,
		layout: { ...d.layout, mode: 'manual', positions: { ...d.layout.positions, [id]: pos } },
		modelVersion: d.modelVersion + 1
	})
});
