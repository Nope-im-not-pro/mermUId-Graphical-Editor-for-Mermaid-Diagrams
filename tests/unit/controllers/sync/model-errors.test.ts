import { afterEach, describe, expect, it } from 'vitest';
import { createSync } from '../../../../src/lib/controllers/sync';
import { describeError } from '../../../../src/lib/controllers/sync/errors';
import { ModelError, type ModelErrorCode } from '../../../../src/lib/model/errors';
import {
	addContainer,
	addEdge,
	addNode,
	moveToContainer,
	updateNode
} from '../../../../src/lib/model/operations';
import type { DiagramDocument } from '../../../../src/lib/model/types';
import { setLocale, type Locale } from '../../../../src/lib/services/i18n';
import { container, edge, node, sampleDoc } from '../../model/fixtures';
import { fakeAdapters } from './helpers';

/** Auslöser je Fehlercode der Model-Schicht. */
const CASES: Record<ModelErrorCode, () => unknown> = {
	unknownContainer: () => addNode(sampleDoc(), node('n9', { parentId: 'cX' })),
	unknownSection: () => addNode(sampleDoc(), node('n9', { parentId: 'c1' }), 3),
	idTaken: () => addNode(sampleDoc(), node('n1')),
	unknownId: () => updateNode(sampleDoc(), 'nX', { label: 'x' }),
	unknownEndpoint: () => addEdge(sampleDoc(), edge('e3', 'nX', 'n1')),
	cycle: () =>
		moveToContainer(addContainer(sampleDoc(), container('c2', { parentId: 'c1' })), 'c1', 'c2')
};

/**
 * Snapshot (T128 C3): Meldungen vor dem Umbau, erzeugt aus `e.message` der damals übersetzt
 * werfenden Model-Operationen. Fest, nicht neu erzeugen.
 */
const BEFORE: Record<Locale, Record<ModelErrorCode, string>> = {
	de: {
		unknownContainer: 'Unbekannter Container: cX',
		unknownSection: 'Unbekannte Section 3 in Container c1',
		idTaken: 'ID bereits vergeben: n1',
		unknownId: 'Unbekannte ID: nX',
		unknownEndpoint: 'Unbekannter Kanten-Endpunkt: nX',
		cycle: 'Zyklus: c1 kann nicht in c2'
	},
	en: {
		unknownContainer: 'Unknown container: cX',
		unknownSection: 'Unknown section 3 in container c1',
		idTaken: 'ID already in use: n1',
		unknownId: 'Unknown ID: nX',
		unknownEndpoint: 'Unknown edge endpoint: nX',
		cycle: 'Cycle: c1 cannot be placed in c2'
	}
};

function caught(run: () => unknown): unknown {
	try {
		run();
	} catch (e) {
		return e;
	}
	throw new Error('kein Fehler');
}

const rows = (['de', 'en'] as const).flatMap((locale) =>
	(Object.keys(CASES) as ModelErrorCode[]).map((code) => [locale, code] as const)
);

afterEach(() => setLocale('de'));

describe('Model-Fehler als Code, Übersetzung im Controller (T128 C3)', () => {
	it.each(rows)('%s %s: Model wirft ModelError mit Code', (_, code) => {
		const e = caught(CASES[code]);
		expect(e).toBeInstanceOf(ModelError);
		expect((e as ModelError).code).toBe(code);
	});

	it.each(rows)('%s %s: describeError textgleich zum Stand vorher', (locale, code) => {
		setLocale(locale);
		expect(describeError(caught(CASES[code]))).toBe(BEFORE[locale][code]);
	});

	it.each(['de', 'en'] as const)(
		'%s: sync.execute meldet die übersetzte Meldung nach außen',
		async (locale) => {
			setLocale(locale);
			const sync = await createSync('flowchart LR\n  A --> B\n', { adapters: fakeAdapters });
			const rename = {
				label: 'rename',
				do: (d: DiagramDocument) => updateNode(d, 'nX', { label: 'x' })
			};
			await expect(sync.execute(rename)).rejects.toThrow(new Error(BEFORE[locale].unknownId));
		}
	);

	it('fremde Fehler bleiben unverändert', () => {
		expect(describeError(new Error('kaputt'))).toBe('kaputt');
		expect(describeError('roh')).toBe('roh');
	});
});
