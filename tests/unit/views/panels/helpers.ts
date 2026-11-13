import { flowchartAdapter } from '../../../../src/lib/services/adapters/flowchart';
import { sequenceAdapter } from '../../../../src/lib/services/adapters/sequence';
import type { DiagramDocument } from '../../../../src/lib/model/types';

export { fakeAdapters, BAD } from '../../controllers/sync/helpers';

const ctx = { newId: (p: string) => `${p}x` };

export function flow(text: string): DiagramDocument {
	const r = flowchartAdapter.parse(text);
	if (!r.ok) throw new Error(JSON.stringify(r.errors));
	return r.doc;
}

export function seq(text: string): DiagramDocument {
	const r = sequenceAdapter.parse(text);
	if (!r.ok) throw new Error(JSON.stringify(r.errors));
	return r.doc;
}

export const flowOut = (doc: DiagramDocument) => flowchartAdapter.serialize(doc);
export const seqOut = (doc: DiagramDocument) => sequenceAdapter.serialize(doc);
export { ctx };
