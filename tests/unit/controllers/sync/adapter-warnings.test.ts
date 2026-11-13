import { get } from 'svelte/store';
import { describe, expect, it } from 'vitest';
import { createSync } from '../../../../src/lib/controllers/sync';
import { msg } from '../../../../src/lib/services/i18n';
import { fakeAdapters } from './helpers';

// T111 C2 / O-83: Adapter-Warnungen (`DiagramAdapter.warnings`) erscheinen über `analyze()` in
// `warnings`; Zeilennummern beziehen sich auf den Editor-Text (Meta-Zeile abgetrennt, O-88).
const META = '%% @mermuid: {"v":1,"layout":"manual","pos":{"A":[1,2]}}';
const OPEN = 'flowchart TD\nA --> B\nC["offen\nD --> E\n';
const warning = (line: number) =>
	msg('services.flowchart.unclosedString', { line, text: 'C["offen' });

const open = (text: string) => createSync(text, { adapters: fakeAdapters });

describe('Adapter-Warnungen in analyze() (O-83)', () => {
	it('offener String erscheint beim Laden in warnings', async () => {
		const sync = await open(OPEN);
		expect(get(sync).errors).toEqual([]);
		expect(get(sync).warnings).toEqual([warning(3)]);
	});

	it('Zeile relativ zum Editor-Text: Meta-Zeile am Anfang oder am Ende', async () => {
		expect(get(await open(OPEN + META + '\n')).warnings).toEqual([warning(3)]);
		const first = await open(`${META}\n${OPEN}`);
		expect(get(first).warnings).toEqual([warning(4)]);
	});

	it('Code-Edit aktualisiert die Warnung; geschlossener String ohne Warnung', async () => {
		const sync = await open('flowchart TD\nA --> B\n');
		expect(get(sync).warnings).toEqual([]);
		sync.editCode(`flowchart TD\n\n${OPEN.slice('flowchart TD\n'.length)}`);
		await sync.flush();
		expect(get(sync).warnings).toEqual([warning(4)]);
		sync.editCode('flowchart TD\nA --> B\nC["zu"]\n');
		await sync.flush();
		expect(get(sync).warnings).toEqual([]);
		sync.dispose();
	});
});
