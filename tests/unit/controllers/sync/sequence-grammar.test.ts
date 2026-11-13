/**
 * T128 C1 (V-25): Der Sync-Controller stellt die Sequenz-Erkennung des Adapters für die View
 * bereit (Naht C2: View importiert nur `controllers/sync`, nie `services/adapters`).
 */
import { describe, expect, it } from 'vitest';
import * as sync from '../../../../src/lib/controllers/sync';
import * as adapter from '../../../../src/lib/services/adapters/sequence';

describe('Bereitstellung der Sequenz-Erkennung (T128 C1)', () => {
	it('reicht genau die Adapter-Funktionen durch', () => {
		expect(sync.sequenceGrammar.messageLexes).toBe(adapter.messageLexes);
		expect(sync.sequenceGrammar.rawEvents).toBe(adapter.rawEvents);
		expect(sync.sequenceGrammar.withoutAutonumber).toBe(adapter.withoutAutonumber);
		expect(sync.sequenceGrammar.autonumberText).toBe(adapter.autonumberText);
		expect(sync.sequenceGrammar.isBoxColor).toBe(adapter.isBoxColor);
		expect(sync.sequenceGrammar.boxColors).toBe(adapter.BOX_COLORS);
	});

	it('liefert die Erkennung über den Controller', () => {
		const ev = sync.sequenceGrammar.rawEvents('break b\nA->>+B: x\nend\n');
		expect(ev.uses).toEqual(['A', 'B']);
		expect(ev.act).toEqual([{ on: true, participant: 'B' }]);
		expect(sync.sequenceGrammar.messageLexes('A', '->>', '', 'B')).toBe(true);
	});
});
