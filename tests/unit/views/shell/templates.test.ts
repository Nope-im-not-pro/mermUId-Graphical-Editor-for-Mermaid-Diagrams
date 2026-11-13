// @vitest-environment jsdom
// T105 C1 (V-14, F-14): Neu-Dialog bietet je Typ flowchart/sequence drei Startvorlagen; jede
// Vorlage parst über den Sync-Controller (Standard-Adapter) fehlerfrei in DE und EN.
import { get } from 'svelte/store';
import { afterEach, describe, expect, it } from 'vitest';
import { createSync } from '../../../../src/lib/controllers/sync';
import { applyLocale } from '../../../../src/lib/views/shell/i18n.svelte';
import {
	DEFAULT_TEMPLATE,
	NEW_TYPES,
	templatesFor
} from '../../../../src/lib/views/shell/templates';

afterEach(() => applyLocale('de'));

describe('T105 C1: Vorlagen', () => {
	it('zwei Typen mit je drei Vorlagen, eindeutige IDs', () => {
		expect(NEW_TYPES).toEqual(['flowchart', 'sequence']);
		for (const type of NEW_TYPES) {
			const list = templatesFor(type);
			expect(list).toHaveLength(3);
			expect(new Set(list.map((tpl) => tpl.id)).size).toBe(3);
		}
	});

	it('Standard: leeres flowchart (wie bisher "Neu")', () => {
		expect(DEFAULT_TEMPLATE).toEqual({ type: 'flowchart', id: templatesFor('flowchart')[0].id });
		expect(templatesFor('flowchart')[0].code()).toBe('flowchart TD\n');
	});

	for (const locale of ['de', 'en'] as const) {
		for (const type of NEW_TYPES) {
			for (const index of [0, 1, 2]) {
				it(`${locale}: ${type} Vorlage ${index + 1} parst fehlerfrei, grafisch editierbar`, async () => {
					applyLocale(locale);
					const tpl = templatesFor(type)[index];
					const code = tpl.code();
					const sync = await createSync(code);
					expect(get(sync)).toMatchObject({
						code,
						mode: type,
						errors: [],
						warnings: [],
						conflict: false
					});
					const doc = get(sync.commands).doc;
					if (index > 0) expect(doc.nodes.length).toBeGreaterThan(1);
					expect(doc.nodes.filter((n) => n.props.base !== undefined)).toEqual([]);
					sync.dispose();
				});
			}
		}
	}
});
